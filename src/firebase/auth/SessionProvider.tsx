import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuth, onAuthStateChanged, type User } from '@react-native-firebase/auth';
import { decideGate, routeFor, shouldRevalidate, type GateFacts } from '@/src/firebase/subscriptions/gate';
import { readConfig, validate, TransportError } from '@/src/firebase/subscriptions/api';
import { startPresenceHeartbeat } from '@/src/firebase/analytics/appEvents';
import { disableAdvertisingId, ensureFirebase, setAnalyticsUser } from '@/src/firebase/init';
import {
  CONFIG_DEFAULTS,
  graceMsFrom,
  type AccessResult,
  type AppConfigDoc,
} from '@/src/firebase/models';
import type { GateDecision } from '@/src/firebase/models';

const CACHE_KEY = 'streamz.access.cache';
const REVALIDATE_MS = 15 * 60_000;

export interface SessionSnapshot {
  uid: string | null;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

interface SessionValue {
  decision: GateDecision;
  route: 'Login' | 'Subscription' | 'Main' | 'Blocked';
  user: SessionSnapshot | null;
  access: AccessResult | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

type CachedAccess = { lastGoodAuthorizedAt: number | null };

const readCache = async (): Promise<CachedAccess> => {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return { lastGoodAuthorizedAt: null };
    const parsed = JSON.parse(raw) as Partial<CachedAccess>;
    // Only the timestamp of the last server authorization is trusted, and only to bound
    // grace. Expiry itself always comes from a live server verdict.
    return { lastGoodAuthorizedAt: typeof parsed.lastGoodAuthorizedAt === 'number' ? parsed.lastGoodAuthorizedAt : null };
  } catch {
    return { lastGoodAuthorizedAt: null };
  }
};

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [uid, setUid] = useState<string | null>(null);
  const [user, setUser] = useState<SessionSnapshot | null>(null);
  const [liveUid, setLiveUid] = useState<string | null>(null);
  const [live, setLive] = useState<AccessResult | null>(null);
  const [transportFailed, setTransportFailed] = useState(false);
  const [lastGoodAuthorizedAt, setLastGood] = useState<number | null>(null);
  const [config, setConfig] = useState<AppConfigDoc>(CONFIG_DEFAULTS);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const inFlight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    void disableAdvertisingId();
    void readCache().then((c) => setLastGood(c.lastGoodAuthorizedAt));
    // Grace is configured, not hardcoded: the admin may shorten it, and a device that kept
    // using the compiled default would silently enforce a policy the project changed.
    void readConfig()
      .then(setConfig)
      .catch(() => setConfig(CONFIG_DEFAULTS));
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const work = (async () => {
      const target = uid;
      if (!target) {
        setLive(null);
        setLiveUid(null);
        return;
      }
      try {
        const result = await validate();
        setNowMs(Date.now());
        setLive(result);
        setLiveUid(target);
        setTransportFailed(false);
        if (result.status === 'authorized') {
          setLastGood(result.serverTimeMs);
          await AsyncStorage.setItem(
            CACHE_KEY,
            JSON.stringify({ lastGoodAuthorizedAt: result.serverTimeMs }),
          );
        }
      } catch (e) {
        setNowMs(Date.now());
        if (e instanceof TransportError) {
          setTransportFailed(true);
          return;
        }
        // A non-transport failure (e.g. a rejected custom claim) is a real answer that we
        // cannot turn into a subscription state. Record it as `error`, which blocks and is
        // never grace-eligible, rather than inventing a plausible status.
        setTransportFailed(false);
        setLive({ status: 'error', expiresAt: null, serverTimeMs: Date.now() });
        setLiveUid(target);
      }
    })();
    inFlight.current = work;
    try {
      await work;
    } finally {
      inFlight.current = null;
    }
  }, [uid]);

  useEffect(() => {
    if (!ensureFirebase()) return;
    const subscriber = onAuthStateChanged(getAuth(), (firebaseUser: User | null) => {
      const nextUid = firebaseUser?.uid ?? null;
      setUid(nextUid);
      setNowMs(Date.now());
      setUser(
        firebaseUser
          ? {
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              displayName: firebaseUser.displayName,
              photoURL: firebaseUser.photoURL,
            }
          : null,
      );
      void setAnalyticsUser(nextUid);
    });
    return subscriber;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && shouldRevalidate(live?.serverTimeMs ?? null, Date.now(), REVALIDATE_MS)) {
        void refresh();
      }
    });
    return () => sub.remove();
  }, [live, refresh]);

  const facts: GateFacts = useMemo(
    () => ({
      uid,
      liveUid,
      live,
      transportFailed,
      lastGoodAuthorizedAt,
      nowMs,
      graceMs: graceMsFrom(config),
    }),
    [uid, liveUid, live, transportFailed, lastGoodAuthorizedAt, nowMs, config],
  );

  const decision = decideGate(facts);

  // Presence is only meaningful for someone who is allowed in.
  useEffect(() => {
    if (decision !== 'ready' && decision !== 'offlineCached') return;
    return startPresenceHeartbeat();
  }, [decision]);

  const value: SessionValue = {
    decision,
    route: routeFor(decision),
    user,
    access: liveUid === uid ? live : null,
    refresh,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
