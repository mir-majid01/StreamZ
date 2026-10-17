import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type Ref,
} from 'react';
import { FlatList, RefreshControl, useWindowDimensions } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Calendar,
  CloudOff,
  History,
  Radio,
  Search as SearchIcon,
  SearchX,
  Star,
  X,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { VStack } from '@/components/ui/vstack';
import { Input, InputField, InputSlot, InputIcon } from '@/components/ui/input';
import { Icon } from '@/components/ui/icon';
import { StreamZErrorState } from '@/src/components/streamz/StreamZStateViews';
import { StreamZText } from '@/src/components/streamz/StreamZText';
import {
  EMPTY_ACTION_LABELS,
  LiveChannelRow,
  LiveChipRail,
  LiveScheduleEventRow,
  LiveTvIdentityBar,
  LiveTvNotice,
  LiveTvPressable,
  LiveTvRefreshAction,
  LiveTvSectionHeader,
  LiveTvSegmented,
  LiveTvSkeleton,
  LiveTvStateBlock,
  MODE_OPTIONS,
  SCOPE_OPTIONS,
  flattenScheduleRows,
  getCatalogueSummary,
  getMatchSummary,
  resolveEmptyState,
  type LiveTvEmptyState,
  type LiveTvMode,
  type LiveTvScope,
  type RailItem,
  type ScheduleRow,
} from '@/src/components/liveTv';
import { useDeviceKind } from '@/src/hooks/useDeviceKind';
import { getHorizontalPadding } from '@/src/utils/responsive';
import { releaseFieldFocusRef, type FieldHandle } from '@/src/utils/fieldFocus';
import {
  DaddyLiveService,
  formatEventTime,
  friendlyLiveTvError,
  type LiveChannel,
  type LiveEpgChannel,
  type LiveEpgDay,
} from '@/src/services/DaddyLiveService';
import type { RootStackParamList } from '@/src/navigation/types';
import {
  buildChannelIndex,
  resolveScheduleChannel,
} from '@/src/services/liveTv/channelIndex';
import {
  BRAND_COLOR,
  HEADER,
  LIVE_TV,
  RADIUS,
  SPACE,
} from '@/src/theme/tokens';
import { TV_FOCUS_BORDER_CLASSNAME } from '@/src/utils/tv';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * The glyph each designed empty state carries. Kept next to the screen rather than
 * in the layout module, because the module decides what a dead end *says* and stays
 * free of React Native so it can be unit-tested.
 */
const EMPTY_ICONS: Record<LiveTvEmptyState['icon'], LucideIcon> = {
  favorites: Star,
  recent: History,
  search: SearchX,
  category: Radio,
  schedule: Calendar,
  catalogue: CloudOff,
};

/** The one list windowing for both modes: 12.5k rows must never be realized at once. */
const LIST_WINDOW = {
  initialNumToRender: LIVE_TV.listInitial,
  maxToRenderPerBatch: LIVE_TV.listBatch,
  windowSize: LIVE_TV.listWindowSize,
} as const;

export const LiveTvScreen = () => {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const deviceKind = useDeviceKind();
  const { width: screenWidth } = useWindowDimensions();
  const padding = getHorizontalPadding(deviceKind);

  const [mode, setMode] = useState<LiveTvMode>('channels');
  const [scope, setScope] = useState<LiveTvScope>('all');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [dayIndex, setDayIndex] = useState(0);
  const [channels, setChannels] = useState<LiveChannel[]>([]);
  const [days, setDays] = useState<LiveEpgDay[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [recents, setRecents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  /**
   * The same IME hazard the search screen had, on the same path shape: this field stays the
   * keyboard's target while the live player is pushed over it and rotates the window, because
   * react-native-screens deliberately does not clear focus from an invisible screen. Releasing it
   * when this screen loses focus and before opening a channel is what keeps a typed filter from
   * raising a keyboard nobody tapped for. See `src/utils/fieldFocus.ts`.
   */
  const fieldRef = useRef<FieldHandle | null>(null);
  const releaseField = useCallback(() => {
    releaseFieldFocusRef(fieldRef);
  }, []);
  useFocusEffect(
    useCallback(() => releaseField, [releaseField]),
  );

  const load = useCallback(async (refresh = false) => {
    try {
      setError(null);
      const [catalog, favIds, recentIds] = await Promise.all([
        DaddyLiveService.getCatalog({ refresh }),
        DaddyLiveService.getFavorites(),
        DaddyLiveService.getRecents(),
      ]);
      setChannels(catalog.channels);
      setDays(catalog.epg.days);
      setCategories(catalog.categories);
      setFavorites(new Set(favIds));
      setRecents(recentIds);
    } catch (e) {
      setError(friendlyLiveTvError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const filteredChannels = useMemo(() => {
    const q = query.trim().toLowerCase();
    return channels.filter((channel) => {
      if (scope === 'favorites' && !favorites.has(channel.id)) return false;
      if (scope === 'recent' && !recents.includes(channel.id)) return false;
      if (category && !channel.categories.includes(category)) return false;
      if (!q) return true;
      const haystack = [
        channel.name,
        ...channel.eventTitles,
        channel.nowPlaying ?? '',
        channel.nextUp ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [channels, scope, favorites, recents, category, query]);

  const orderedChannels = useMemo(() => {
    if (scope !== 'recent') return filteredChannels;
    const byId = new Map(filteredChannels.map((c) => [c.id, c]));
    return recents
      .map((id) => byId.get(id))
      .filter((c): c is LiveChannel => c != null);
  }, [filteredChannels, recents, scope]);

  const scheduleDay = days[dayIndex] ?? days[0];
  // The schedule resolves every listed channel back to its catalogue entry, and the
  // catalogue is twelve and a half thousand entries long. Scanning it per row, per render,
  // was the tab's whole cost; the ids the rows already carry index it instead.
  const channelIndex = useMemo(() => buildChannelIndex(channels), [channels]);
  const resolveChannel = useCallback(
    (reference: LiveEpgChannel) => resolveScheduleChannel(channelIndex, reference),
    [channelIndex],
  );
  const scheduleSections = useMemo(() => {
    if (!scheduleDay) return [];
    const q = query.trim().toLowerCase();
    return scheduleDay.categories
      .filter((section) => !category || section.name === category)
      .map((section) => ({
        ...section,
        events: section.events.filter((event) => {
          if (!q) return true;
          const hay = `${event.title} ${event.channels.map((c) => c.name).join(' ')}`.toLowerCase();
          return hay.includes(q);
        }),
      }))
      .filter((section) => section.events.length > 0);
  }, [scheduleDay, category, query]);

  // Header rows and listings on one virtualised plane. Rendering a whole category
  // inside a single list item is what let the schedule put hundreds of children under
  // one container; the time label is formatted here, once per listing, rather than by
  // a row on every render.
  const scheduleRows = useMemo(
    () => flattenScheduleRows(scheduleSections, formatEventTime),
    [scheduleSections],
  );

  const categoryItems = useMemo<RailItem[]>(
    () => [
      { key: '*', label: 'All categories' },
      ...categories.map((name) => ({ key: name, label: name })),
    ],
    [categories],
  );

  const dayItems = useMemo<RailItem[]>(
    () => days.map((day, index) => ({
      key: String(index),
      label: day.label || `Day ${index + 1}`,
    })),
    [days],
  );

  const emptyState = useMemo(
    () =>
      resolveEmptyState({
        mode,
        scope,
        query,
        category,
        favoritesCount: favorites.size,
        recentsCount: recents.length,
      }),
    [mode, scope, query, category, favorites.size, recents.length],
  );

  // Stable identity on purpose: the row is memoised, and a fresh lambda per render
  // would undo that for all twelve and a half thousand of them.
  const toggleFavorite = useCallback((channelId: string) => {
    DaddyLiveService.toggleFavorite(channelId)
      .then((next) => setFavorites(new Set(next)))
      // A star that would not save is worth one line in the notice band, not a dialog;
      // the list itself is untouched and the row simply stays as it was.
      .catch((e: unknown) => setError(friendlyLiveTvError(e)));
  }, []);

  const playChannel = useCallback(
    async (channel: LiveChannel) => {
      if (resolvingId) return;
      // Before the await: the tap that started this is the last thing that should leave the
      // keyboard up while a stream is being resolved.
      releaseField();
      setResolvingId(channel.id);
      setError(null);
      try {
        const stream = await DaddyLiveService.getStream(channel.id);
        const recentIds = await DaddyLiveService.pushRecent(channel.id);
        setRecents(recentIds);
        navigation.navigate('LivePlayer', {
          channel,
          stream,
        });
      } catch (e) {
        setError(friendlyLiveTvError(e));
      } finally {
        setResolvingId(null);
      }
    },
    [navigation, releaseField, resolvingId],
  );

  const openChannel = useCallback(
    (channel: LiveChannel) => {
      void playChannel(channel);
    },
    [playChannel],
  );

  const clearQuery = useCallback(() => setQuery(''), []);
  const runEmptyAction = useCallback(() => {
    if (emptyState.action === 'clearSearch') setQuery('');
    else if (emptyState.action === 'clearCategory') setCategory(null);
    else if (emptyState.action === 'showAll') {
      setScope('all');
      setCategory(null);
    }
  }, [emptyState.action]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load(true);
  }, [load]);

  const renderChannel = useCallback(
    ({ item }: { item: LiveChannel }) => (
      <LiveChannelRow
        channel={item}
        starred={favorites.has(item.id)}
        resolving={item.id === resolvingId}
        onOpen={openChannel}
        onToggleFavorite={toggleFavorite}
      />
    ),
    [favorites, openChannel, resolvingId, toggleFavorite],
  );

  const renderScheduleRow = useCallback(
    ({ item }: { item: ScheduleRow }) =>
      item.kind === 'header' ? (
        <LiveTvSectionHeader name={item.name} eventCount={item.eventCount} />
      ) : (
        <LiveScheduleEventRow
          row={item}
          resolveChannel={resolveChannel}
          resolvingId={resolvingId}
          onOpen={openChannel}
        />
      ),
    [openChannel, resolveChannel, resolvingId],
  );

  const emptyList = useMemo(
    () => (
      <Box style={{ paddingHorizontal: padding, paddingTop: SPACE.xxxl }}>
        <LiveTvStateBlock
          icon={EMPTY_ICONS[emptyState.icon]}
          title={emptyState.title}
          message={emptyState.message}
          actionLabel={
            emptyState.action ? EMPTY_ACTION_LABELS[emptyState.action] : undefined
          }
          onAction={emptyState.action ? runEmptyAction : undefined}
        />
      </Box>
    ),
    [emptyState, padding, runEmptyAction],
  );

  if (loading) {
    return (
      <Box className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <Box style={{ paddingHorizontal: padding }} className="pt-1">
          <LiveTvIdentityBar title="Live TV" />
        </Box>
        <LiveTvSkeleton horizontalPadding={padding} />
      </Box>
    );
  }

  if (error && !channels.length) {
    return (
      <Box className="flex-1 bg-background px-8" style={{ paddingTop: insets.top }}>
        <StreamZErrorState
          title="Live TV is not available"
          message={error}
          actionLabel={refreshing ? 'Retrying…' : 'Try again'}
          onAction={refresh}
        />
      </Box>
    );
  }

  return (
    <Box className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {/* Five bands, one gap between each: identity, what you are looking at, the way
          to find a channel, which list of channels, and which kind of channel. */}
      <VStack
        className="pb-1 pt-1"
        style={{ paddingHorizontal: padding, gap: LIVE_TV.bandGap }}
      >
        <LiveTvIdentityBar
          title="Live TV"
          summary={getCatalogueSummary(channels.length, days.length)}
          right={
            <LiveTvRefreshAction refreshing={refreshing} onPress={refresh} />
          }
        />

        <LiveTvSegmented
          options={MODE_OPTIONS}
          value={mode}
          onChange={setMode}
          role="tab"
          fill
          accessibilityLabel="Live TV view"
        />

        <Box className="relative">
          <Input className="h-12 rounded-full bg-card">
            <InputSlot className="pl-3">
              <InputIcon as={SearchIcon} className="text-muted-foreground" />
            </InputSlot>
            <InputField
              // Short on purpose: the focus handle has to be the first prop on the field.
              ref={fieldRef as unknown as Ref<ComponentRef<typeof InputField>>}
              placeholder={
                mode === 'channels' ? 'Search channels or events' : 'Search the guide'
              }
              accessibilityLabel={
                mode === 'channels' ? 'Search channels or events' : 'Search the programme guide'
              }
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={releaseField}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
              className="pr-10"
            />
          </Input>
          {query.length > 0 ? (
            <Box className="absolute right-1 top-0 h-full items-center justify-center">
              <LiveTvPressable
                onPress={clearQuery}
                accessibilityLabel="Clear the search"
                className="items-center justify-center rounded-full"
                focusedClassName={TV_FOCUS_BORDER_CLASSNAME}
                style={{
                  width: HEADER.actionTarget,
                  height: HEADER.actionTarget,
                  borderRadius: RADIUS.pill,
                }}
              >
                <Icon as={X} size="lg" className="text-muted-foreground" />
              </LiveTvPressable>
            </Box>
          ) : null}
        </Box>

        {mode === 'channels' ? (
          <HStack className="items-center justify-between">
            {/* Same track as the mode control above it, sized to its labels instead of
                to the row: which list you are in outranks which list you are looking at. */}
            <LiveTvSegmented
              options={SCOPE_OPTIONS}
              value={scope}
              onChange={setScope}
              fill={false}
              accessibilityLabel="Channel list"
            />
            <StreamZText variant="metadata" numberOfLines={1} className="ml-2">
              {getMatchSummary(orderedChannels.length, query.trim().length > 0)}
            </StreamZText>
          </HStack>
        ) : null}
      </VStack>

      {/* The rails carry the screen's inset as real scroll-content padding, so the last
          chip stops at the edge. Fixed height: switching mode cannot move the list. */}
      {mode === 'schedule' && dayItems.length > 0 ? (
        <Box className="mt-3">
          <LiveChipRail
            items={dayItems}
            activeKey={String(dayIndex)}
            onSelect={(key) => setDayIndex(Number(key))}
            accessibilityLabel="Guide day"
            horizontalPadding={padding}
            screenWidth={screenWidth}
          />
        </Box>
      ) : null}

      <Box className="mt-3">
        <LiveChipRail
          items={categoryItems}
          activeKey={category ?? '*'}
          onSelect={(key) => setCategory(key === '*' ? null : key)}
          accessibilityLabel="Channel category"
          horizontalPadding={padding}
          screenWidth={screenWidth}
        />
      </Box>

      {error ? (
        <Box style={{ paddingHorizontal: padding }} className="mt-3">
          <LiveTvNotice icon={CloudOff} message={error} onRetry={refresh} />
        </Box>
      ) : null}

      {mode === 'channels' ? (
        <FlatList
          data={orderedChannels}
          keyExtractor={(item) => item.id}
          renderItem={renderChannel}
          contentContainerStyle={{
            paddingHorizontal: padding,
            paddingBottom: insets.bottom + SPACE.xxl,
            paddingTop: SPACE.sm,
            gap: LIVE_TV.rowGap,
          }}
          {...LIST_WINDOW}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={BRAND_COLOR.primary}
            />
          }
          ListEmptyComponent={emptyList}
        />
      ) : (
        <FlatList
          data={scheduleRows}
          keyExtractor={(row) => row.key}
          renderItem={renderScheduleRow}
          contentContainerStyle={{
            paddingHorizontal: padding,
            paddingBottom: insets.bottom + SPACE.xxl,
            paddingTop: SPACE.sm,
            gap: LIVE_TV.rowGap,
          }}
          {...LIST_WINDOW}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={BRAND_COLOR.primary}
            />
          }
          ListEmptyComponent={emptyList}
        />
      )}
    </Box>
  );
};
