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
import { mark } from '@/src/utils/startupTiming';
import {
  AUTH_HYDRATION_BUDGET_MS,
  didAuthHydrationTimeOut,
} from '@/src/utils/startupSequence';

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
  // Two separate facts, because `uid === null` means two different things depending on
  // whether Firebase has reported yet. Collapsing them is what let the app answer
  // "signed out" for a returning user and flash Login before the real session landed.
  const [authHydrated, setAuthHydrated] = useState(false);
  const [authInitFailed, setAuthInitFailed] = useState(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const authMarkedRef = useRef(false);
  // Read from the watchdog callback and from `refresh`, both of which outlive the render that
  // scheduled them. Held in refs as well as state so neither has to depend on a state value
  // just to read it back — that would hand `refresh` a new identity on every auth change and
  // fire an extra subscription round-trip each time.
  const authHydratedRef = useRef(false);
  const authInitFailedRef = useRef(false);

  const failAuthInit = useCallback(
    (reason: string): void => {
      if (authHydratedRef.current) return;
      mark(`auth-init-failed:${reason}`);
      authInitFailedRef.current = true;
      setAuthInitFailed(true);
    },
    [],
  );

  /**
   * The single place the app learns whether a session exists. `source` distinguishes the
   * listener's own report from the retry that reads `currentUser` after the budget expired;
   * only the listener path feeds analytics, because a retry is a recovery, not a change.
   */
  const acceptAuthReport = useCallback(
    (firebaseUser: User | null, source: 'listener' | 'retry'): void => {
      if (!authMarkedRef.current) {
        const outcome = firebaseUser ? 'auth-restored' : 'auth-restored:signed-out';
        authMarkedRef.current = true;
        mark(source === 'retry' ? `${outcome}-by-retry` : outcome);
      }
      authHydratedRef.current = true;
      authInitFailedRef.current = false;
      setAuthHydrated(true);
      setAuthInitFailed(false);
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
      if (source === 'listener') void setAnalyticsUser(nextUid);
    },
    [],
  );

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
    // The dead end the gate reaches when auth never reports is retryable, because BlockedScreen's
    // retry button calls exactly this. Guarded on the budget already having expired: before that
    // point `currentUser` is not trustworthy on Android — FirebaseAuth restores persistence
    // asynchronously and can answer `null` for a signed-in device, which is precisely the guess
    // this whole change exists to stop. After twelve silent seconds it is the best answer
    // available, and a `null` there is an observed signed-out state rather than an assumption.
    if (authInitFailedRef.current && !authHydratedRef.current && ensureFirebase()) {
      acceptAuthReport(getAuth().currentUser, 'retry');
    }
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
        mark(`subscription-verdict:${result.status}`);
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
          mark('subscription-verdict:transport-error');
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
  }, [uid, acceptAuthReport]);

  useEffect(() => {
    if (!ensureFirebase()) {
      // No Firebase app means no auth state will ever be reported, so this is a named dead
      // end rather than a wait. Without it the gate would hold on `bootstrapping` forever.
      failAuthInit('firebase-unconfigured');
      return;
    }
    mark('firebase-ready');
    const subscribedAt = Date.now();
    const subscriber = onAuthStateChanged(getAuth(), (firebaseUser: User | null) => {
      acceptAuthReport(firebaseUser, 'listener');
    });
    // A ceiling on the wait, never the thing that ends it. The first callback reads persisted
    // state and needs no network, so silence past the budget means the listener is not coming;
    // the app then routes to the designed dead end instead of parking the user on Splash. The
    // elapsed time is measured rather than assumed, because a timer that fires late under load
    // must not declare a failure the app has already recovered from.
    const watchdog = setTimeout(() => {
      if (didAuthHydrationTimeOut(Date.now() - subscribedAt, authHydratedRef.current)) {
        failAuthInit('hydration-budget');
      }
    }, AUTH_HYDRATION_BUDGET_MS);
    return () => {
      clearTimeout(watchdog);
      subscriber();
    };
  }, [acceptAuthReport, failAuthInit]);

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
      authHydrated,
      authInitFailed,
      liveUid,
      live,
      transportFailed,
      lastGoodAuthorizedAt,
      nowMs,
      graceMs: graceMsFrom(config),
    }),
    [
      uid,
      authHydrated,
      authInitFailed,
      liveUid,
      live,
      transportFailed,
      lastGoodAuthorizedAt,
      nowMs,
      config,
    ],
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
