import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MediaItem } from '@/src/types';
import { useSession } from '@/src/firebase/auth/SessionProvider';

/**
 * The list belongs to the signed-in user, so the storage key is namespaced by
 * uid (`flick.myList.<uid>`). `LEGACY_KEY` is what the app wrote before lists
 * were account-scoped — a single shared bucket every account read and wrote,
 * which is exactly the cross-account leak. On a user's first load we relocate
 * that bucket into their key (copy, then drop) so an existing list is never
 * silently lost, while a second account no longer inherits the first one's
 * saves.
 */
const LEGACY_KEY = 'flick.myList';
const keyForUser = (uid: string) => `${LEGACY_KEY}.${uid}`;

const keyFor = (item: Pick<MediaItem, 'id' | 'media_type'>) =>
  `${item.media_type ?? 'movie'}-${item.id}`;

interface MyListContextValue {
  items: MediaItem[];
  loaded: boolean;
  isInList: (item: Pick<MediaItem, 'id' | 'media_type'>) => boolean;
  toggle: (item: MediaItem) => void;
  remove: (item: Pick<MediaItem, 'id' | 'media_type'>) => void;
}

const MyListContext = createContext<MyListContextValue>({
  items: [],
  loaded: false,
  isInList: () => false,
  toggle: () => {},
  remove: () => {},
});

/**
 * Shared "My List" backed by AsyncStorage, scoped to the current uid. Exposed
 * via context so every screen (Home, Detail, Hero, My List) reads and mutates
 * the same reactive, persisted, per-account list.
 */
export const MyListProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useSession();
  const uid = user?.uid ?? null;
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const storageKey = uid ? keyForUser(uid) : null;

  useEffect(() => {
    // No session resolved yet. Keep `loaded` false so screens show a loader
    // rather than a premature (and possibly wrong) empty state.
    if (!storageKey) {
      setItems([]);
      setLoaded(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        let raw = await AsyncStorage.getItem(storageKey);
        if (raw == null) {
          const legacy = await AsyncStorage.getItem(LEGACY_KEY);
          if (legacy != null) {
            // Move, don't copy-and-leave: relocate into this account's key
            // first, and only drop the shared key once that write succeeded.
            await AsyncStorage.setItem(storageKey, legacy);
            await AsyncStorage.removeItem(LEGACY_KEY);
            raw = legacy;
          }
        }
        if (cancelled) return;
        setItems(raw ? (JSON.parse(raw) as MediaItem[]) : []);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  const isInList = useCallback(
    (item: Pick<MediaItem, 'id' | 'media_type'>) =>
      items.some((i) => keyFor(i) === keyFor(item)),
    [items],
  );

  const persist = useCallback(
    (next: MediaItem[]) => {
      if (!storageKey) return;
      AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => {});
    },
    [storageKey],
  );

  const toggle = useCallback(
    (item: MediaItem) => {
      if (!storageKey) return;
      setItems((prev) => {
        const exists = prev.some((i) => keyFor(i) === keyFor(item));
        const next = exists
          ? prev.filter((i) => keyFor(i) !== keyFor(item))
          : [item, ...prev];
        persist(next);
        return next;
      });
    },
    [storageKey, persist],
  );

  const remove = useCallback(
    (item: Pick<MediaItem, 'id' | 'media_type'>) => {
      if (!storageKey) return;
      setItems((prev) => {
        const next = prev.filter((i) => keyFor(i) !== keyFor(item));
        persist(next);
        return next;
      });
    },
    [storageKey, persist],
  );

  const value = useMemo(
    () => ({ items, loaded, isInList, toggle, remove }),
    [items, loaded, isInList, toggle, remove],
  );

  return <MyListContext.Provider value={value}>{children}</MyListContext.Provider>;
};

export const useMyList = () => useContext(MyListContext);
