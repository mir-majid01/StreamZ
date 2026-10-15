import { useEffect, useState, type ReactNode } from 'react';
import { Children, Fragment } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import {
  Bookmark,
  Captions,
  CheckCircle2,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Gauge,
  Globe,
  Heart,
  Info,
  KeyRound,
  LogOut,
  MonitorPlay,
  Ratio,
  Server as ServerIcon,
  User as UserIcon,
  Users,
} from 'lucide-react-native';
import {
  Toast,
  ToastDescription,
  ToastTitle,
  useToast,
} from '@/components/ui/toast';
import {
  GoogleG,
  RiseIn,
  StreamZText,
  StreamZZMark,
  usePrefersReducedMotion,
} from '@/src/components/streamz';
import { ConfirmDialog } from '@/src/components/ConfirmDialog';
import { useServers } from '@/src/hooks/useServers';
import { UPDATE_CONFIG, WATCH_PARTY_CONFIG } from '@/src/config/env';
import { useSubtitleSettings } from '@/src/hooks/useSubtitleSettings';
import { getQualityLabel, useVideoQuality } from '@/src/hooks/useVideoQuality';
import { getAspectLabel, useVideoAspect } from '@/src/hooks/useVideoAspect';
import { getLanguageLabel } from '@/src/constants/languages';
import { getRegionName, useCatalogRegion } from '@/src/hooks/useCatalogRegion';
import { UpdateModal } from '@/src/components/UpdateModal';
import { updateService } from '@/src/services/UpdateService';
import { useFinishedMovies } from '@/src/hooks/useFinishedMovies';
import { useMyList } from '@/src/hooks/useMyList';
import { useDownloads } from '@/src/hooks/useDownloads';
import { useSession } from '@/src/firebase/auth/SessionProvider';
import { signOut } from '@/src/firebase/auth/googleAuth';
import { type AccessStatus } from '@/src/firebase/models';
import { expiryLabel, timeLeftLabel } from '@/src/utils/subscriptionTerms';
import { loadActivationKey, maskKey } from '@/src/firebase/subscriptions/savedKey';
import { usePlaybackSettings } from '@/src/hooks/usePlaybackSettings';
import { useWatchParty } from '@/src/hooks/useWatchParty';
import { PARTY_DISPLAY_NAME_MAX } from '@/src/party/displayName';
import { formatMemoryGb } from '@/src/utils/deviceRecommendations';
import { AUTH, FONT, MARK_RAMP, SETTINGS, SURFACE } from '@/src/theme/tokens';
import type { RootStackParamList } from '@/src/navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** The mockup's 20px, 1.8-weight stroke icon, centred in its 38px tile. */
type RowIcon = typeof ServerIcon;

/**
 * Settings, built against design/settings/Settings.dc.html: one ink page with a
 * red bloom off the top-right corner, a hero account card, then rows grouped
 * into PLAYBACK / LIBRARY / ABOUT cards. The grouping is the design's; every row
 * and every action it carries was already on the previous screen — including the
 * ones the mockup has no frame for: Downloads (moved here from the tab bar), the
 * watch-party controls, and the updater.
 *
 * Where the mockup and this app disagree, the mockup loses only on facts: its
 * "30 days left", "Google account" and "StreamZ v0.1.0" are placeholders for the
 * live server verdict, the signed-in identity, and the installed version.
 */
export const SettingsScreen = () => {
  const insets = useSafeAreaInsets();
  const reduced = usePrefersReducedMotion();
  const navigation = useNavigation<Nav>();
  const { activeServer } = useServers();
  const { entries: finishedMovies } = useFinishedMovies();
  const { items: myList } = useMyList();
  const { jobs: downloadJobs } = useDownloads();
  const { forwardBufferSeconds, effectiveForwardBufferSeconds, deviceTotalMemory } =
    usePlaybackSettings();
  const { settings: subtitleSettings } = useSubtitleSettings();
  const { preference: videoQuality } = useVideoQuality();
  const { aspect: videoAspect } = useVideoAspect();
  const subtitleLangLabel = getLanguageLabel(subtitleSettings.defaultLanguage);
  const videoQualityLabel = getQualityLabel(videoQuality);
  const videoAspectLabel = getAspectLabel(videoAspect);
  const { region } = useCatalogRegion();
  const regionName = getRegionName(region);
  const [updaterOpen, setUpdaterOpen] = useState(false);
  const toast = useToast();
  const [signOutPrompt, setSignOutPrompt] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { displayName, setDisplayName } = useWatchParty();
  const [nameDraft, setNameDraft] = useState(displayName);

  // Account panel — the signed-in Google identity and, when the key was
  // cached at activation, the (masked) key itself. `access.expiresAt` and
  // `access.serverTimeMs` come from the live server verdict, so "days left"
  // is real, not a device-clock guess.
  const { user, access } = useSession();
  const [activationKey, setActivationKey] = useState<string | null>(null);
  const [keyRevealed, setKeyRevealed] = useState(false);
  const uid = user?.uid ?? null;
  useEffect(() => {
    let active = true;
    setKeyRevealed(false);
    if (!uid) {
      setActivationKey(null);
      return;
    }
    void loadActivationKey(uid).then((k) => {
      if (active) setActivationKey(k);
    });
    return () => {
      active = false;
    };
  }, [uid]);
  const expiresAt = access?.expiresAt ?? null;
  const serverNow = access?.serverTimeMs ?? Date.now();
  const remainingMs = expiresAt != null ? expiresAt - serverNow : null;
  // A term is named in the unit it is actually measured in. `daysLeft` rounded a
  // four-minute key up to "1 day left", which is the one case a short key exists to show.
  const timeLeft = remainingMs != null ? timeLeftLabel(remainingMs) : null;
  const endsLabel = expiresAt != null ? expiryLabel(expiresAt, serverNow) : null;

  useEffect(() => {
    setNameDraft(displayName);
  }, [displayName]);

  // The mockup's one status line, driven by the verdict instead of its sample
  // string. `quiet` is any state that is not currently granted; `none` is the
  // gap before the first verdict arrives — a blinking green dot there would
  // claim an authorization the server has not confirmed.
  const status: { line: string; dot: 'live' | 'quiet' | 'none' } = (() => {
    if (!access) return { line: 'Checking subscription…', dot: 'none' };
    if (access.status === 'authorized') {
      return {
        line: timeLeft != null ? `Subscription active · ${timeLeft}` : 'Subscription active',
        dot: 'live',
      };
    }
    const words: Record<AccessStatus, string> = {
      authorized: 'Subscription active',
      needsKey: 'No key activated on this account',
      expired: endsLabel ? `Expired · ${endsLabel}` : 'Expired',
      revoked: 'Key revoked by the issuer',
      suspended: 'Key suspended',
      disabled: 'Key disabled',
      installationCeiling: 'Key limit reached on this installation',
      error: 'Subscription status unavailable',
    };
    return { line: words[access.status] ?? 'Subscription unavailable', dot: 'quiet' };
  })();
  const finePrint = [user?.email, expiresAt != null ? `Ends ${endsLabel}` : null]
    .filter(Boolean)
    .join(' · ');

  const completedDownloads = downloadJobs.filter((job) => job.status === 'completed').length;

  // Sign-out ends the session only. The subscription record, the activation
  // key, My List, and any finished downloads all stay on the device — they are
  // keyed to this account and are needed again the next time it signs in, so
  // this is deliberately not a "clear my data" action.
  const confirmSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      setSignOutPrompt(false);
    } catch {
      // Say so rather than going quiet: the user is still signed in, and a
      // silent failure reads exactly like a successful one.
      setSignOutPrompt(false);
      toast.show({
        placement: 'top',
        duration: 5000,
        render: ({ id }) => (
          <Toast nativeID={id} action="error" variant="solid">
            <ToastTitle>Couldn&apos;t sign out</ToastTitle>
            <ToastDescription>
              You are still signed in. Nothing was deleted — try again, or
              close the app and repeat.
            </ToastDescription>
          </Toast>
        ),
      });
    } finally {
      setSigningOut(false);
    }
  };

  // The mockup staggers group reveals 80ms apart. With the extra groups this app
  // has, the sequence is counted rather than hardcoded per group.
  let step = 0;
  const nextDelay = () => 160 + step++ * 80;

  return (
    <View style={styles.root}>
      <PageGlow />

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
      >
        <RiseIn reduced={reduced} distance={14} duration={600}>
          <StreamZText style={styles.title} accessibilityRole="header">
            Settings
          </StreamZText>
        </RiseIn>

        {/* ── Account ───────────────────────────────────────────────
            Identity + subscription lead, so the user sees who they are signed
            in as, how much of the term remains, and the key that granted it —
            then can sign out from here. The mockup draws this card as a link to
            an account screen; there is no such screen, so the card is not
            pressable and its two real actions — reveal the key, sign out — sit
            inside it. */}
        <RiseIn delay={80} reduced={reduced} distance={14} duration={600}>
          <AccountCard>
            <View style={styles.accountHead}>
              {user?.photoURL ? (
                // The mockup's white Google tile is the fallback: a real avatar
                // is better evidence of who is signed in than a brand logo.
                <Image
                  source={{ uri: user.photoURL }}
                  style={styles.avatar}
                  resizeMode="cover"
                  accessibilityLabel={user.displayName ?? 'Account photo'}
                />
              ) : (
                <View style={styles.gTile}>
                  <GoogleG size={22} />
                </View>
              )}
              <View style={styles.accountIdentity}>
                <StreamZText style={styles.accountName} numberOfLines={1}>
                  {user?.displayName ?? 'Signed in'}
                </StreamZText>
                <View style={styles.statusLine}>
                  {status.dot !== 'none' ? (
                    <LiveDot
                      reduced={reduced}
                      color={status.dot === 'live' ? AUTH.success : AUTH.faint}
                      steady={status.dot === 'quiet'}
                    />
                  ) : null}
                  <StreamZText style={styles.statusLabel} numberOfLines={1}>
                    {status.line}
                  </StreamZText>
                </View>
                {finePrint ? (
                  <StreamZText style={styles.finePrint} numberOfLines={1}>
                    {finePrint}
                  </StreamZText>
                ) : null}
              </View>
            </View>

            {activationKey ? (
              <>
                <View style={styles.divider} />
                <View style={styles.keyRow}>
                  <Tile>
                    <KeyRound size={20} color={SETTINGS.iconStroke} strokeWidth={1.8} />
                  </Tile>
                  <View style={styles.rowText}>
                    <StreamZText style={styles.rowTitle}>Activation key</StreamZText>
                    <StreamZText
                      style={styles.keyValue}
                      numberOfLines={1}
                      selectable
                      accessibilityLabel="Activation key"
                    >
                      {keyRevealed ? activationKey : maskKey(activationKey)}
                    </StreamZText>
                  </View>
                  <RevealButton
                    revealed={keyRevealed}
                    onPress={() => setKeyRevealed((r) => !r)}
                    label={keyRevealed ? 'Hide activation key' : 'Reveal activation key'}
                  />
                </View>
              </>
            ) : null}

            <View style={styles.divider} />
            <Row
              icon={LogOut}
              title="Sign out"
              value={signingOut ? 'Signing out…' : 'End this session on this device'}
              chevron={false}
              onPress={() => setSignOutPrompt(true)}
            />
          </AccountCard>
        </RiseIn>

        {WATCH_PARTY_CONFIG.enabled ? (
          <Group title="WATCH PARTY" delay={nextDelay()} reduced={reduced}>
            <Row
              icon={Users}
              title="Join watch party"
              value="Live rooms or a code"
              onPress={() => navigation.navigate('JoinParty', {})}
            />
            <View style={styles.fieldRow}>
              <Tile>
                <UserIcon size={20} color={SETTINGS.iconStroke} strokeWidth={1.8} />
              </Tile>
              <View style={styles.rowText}>
                <StreamZText style={styles.rowTitle}>Watch party name</StreamZText>
                <TextInput
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  placeholder="Shown in chat and reactions"
                  placeholderTextColor={AUTH.faint}
                  maxLength={PARTY_DISPLAY_NAME_MAX}
                  autoCorrect={false}
                  style={styles.nameField}
                  accessibilityLabel="Watch party name"
                  onBlur={() => {
                    void setDisplayName(nameDraft).then(setNameDraft);
                  }}
                  onSubmitEditing={() => {
                    void setDisplayName(nameDraft).then(setNameDraft);
                  }}
                />
              </View>
            </View>
          </Group>
        ) : null}

        <Group title="PLAYBACK" delay={nextDelay()} reduced={reduced}>
          <Row
            icon={ServerIcon}
            title="Playback server"
            value={activeServer.name}
            onPress={() => navigation.navigate('ServerSettings')}
          />
          <Row
            icon={MonitorPlay}
            title="Video quality"
            value={`Preferred: ${videoQualityLabel}`}
            onPress={() => navigation.navigate('VideoQualitySettings')}
          />
          <Row
            icon={Ratio}
            title="Video aspect"
            value={videoAspectLabel}
            onPress={() => navigation.navigate('VideoAspectSettings')}
          />
          <Row
            icon={Captions}
            title="Subtitles"
            value={`Default: ${subtitleLangLabel}`}
            onPress={() => navigation.navigate('SubtitleSettings')}
          />
          <Row
            icon={Gauge}
            title="Buffering"
            value={`${effectiveForwardBufferSeconds}s${forwardBufferSeconds == null ? ' · Auto' : ''} · ${formatMemoryGb(deviceTotalMemory)} RAM`}
            onPress={() => navigation.navigate('PlaybackPerformance')}
          />
        </Group>

        <Group title="LIBRARY" delay={nextDelay()} reduced={reduced}>
          <Row
            icon={Globe}
            title="Catalog region"
            value={regionName}
            onPress={() => navigation.navigate('RegionSettings')}
          />
          <Row
            icon={Bookmark}
            title="My List"
            value={`${myList.length} saved`}
            onPress={() => navigation.navigate('MyList')}
          />
          <Row
            icon={Download}
            title="Downloads"
            value={`${completedDownloads} available offline`}
            onPress={() => navigation.navigate('Downloads')}
          />
          <Row
            icon={CheckCircle2}
            title="Finished movies"
            value={`${finishedMovies.length} completed`}
            onPress={() => navigation.navigate('FinishedMovies')}
          />
        </Group>

        <Group title="ABOUT" delay={nextDelay()} reduced={reduced}>
          {UPDATE_CONFIG.enabled ? (
            <Row
              icon={Download}
              title="Check for updates"
              value={`Current version: v${updateService.getCurrentVersion()}`}
              onPress={() => setUpdaterOpen(true)}
            />
          ) : null}
          <Row
            icon={Info}
            title="Disclaimer"
            value="About content sources & third-party servers"
            onPress={() => navigation.navigate('Disclaimer')}
          />
          <Row
            icon={Heart}
            title="About"
            value="Credits, licence, privacy and support"
            onPress={() => navigation.navigate('Credits')}
          />
        </Group>

        <RiseIn delay={nextDelay()} reduced={reduced} distance={14} duration={600}>
          <View style={styles.footer}>
            <View style={styles.footerMark}>
              <StreamZZMark size={26} />
            </View>
            <StreamZText style={styles.version}>
              StreamZ v{updateService.getCurrentVersion()}
            </StreamZText>
          </View>
        </RiseIn>
      </ScrollView>

      {UPDATE_CONFIG.enabled ? (
        <UpdateModal visible={updaterOpen} onClose={() => setUpdaterOpen(false)} />
      ) : null}

      <ConfirmDialog
        visible={signOutPrompt}
        title="Sign out?"
        message={
          signingOut
            ? 'Signing out…'
            : 'You will need to sign in with Google and re-enter your key to ' +
              'use the app again. Your subscription, My List, and downloaded ' +
              'titles are not deleted.'
        }
        confirmLabel={signingOut ? 'Signing out…' : 'Log out'}
        cancelLabel="Cancel"
        destructive
        onConfirm={() => {
          if (signingOut) return;
          void confirmSignOut();
        }}
        onCancel={() => {
          if (!signingOut) setSignOutPrompt(false);
        }}
      />
    </View>
  );
};

/** One red bloom at the mockup's top-right, 72% of the way faded at its edge. */
const PageGlow = () => (
  <View pointerEvents="none" style={styles.glow}>
    <Svg style={StyleSheet.absoluteFill} accessible={false}>
      <Defs>
        <RadialGradient id="settingsGlow" cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor={AUTH.ctaTop} stopOpacity={0.16} />
          <Stop offset="0.72" stopColor={AUTH.ctaTop} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width="100%" height="100%" fill="url(#settingsGlow)" />
    </Svg>
  </View>
);

/**
 * The mockup's `blink 2.4s ease-in-out infinite`: opacity 1 → .35 → 1, so each
 * leg is 1.2s. Reduced motion and the non-granted states hold it lit, which
 * states the same fact without the movement.
 */
const LiveDot = ({
  color,
  steady,
  reduced,
}: {
  color: string;
  steady: boolean;
  reduced: boolean;
}) => {
  const opacity = useSharedValue(reduced || steady ? 1 : 0.35);
  useEffect(() => {
    if (reduced || steady) {
      opacity.value = 1;
      return;
    }
    opacity.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [opacity, reduced, steady]);

  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.liveDot, { backgroundColor: color }, animated]} />;
};

/** The hero card face: two stops, one hairline, 22 radius, 16 padding. */
const AccountCard = ({ children }: { children: ReactNode }) => (
  <LinearGradient
    colors={[SETTINGS.accountTop, SETTINGS.accountBottom]}
    style={styles.accountCard}
  >
    {children}
  </LinearGradient>
);

const Tile = ({ children }: { children: ReactNode }) => (
  <View style={styles.iconTile}>{children}</View>
);

/** A labelled card of rows. Dividers belong to the group, so rows stay unaware. */
const Group = ({
  title,
  delay,
  reduced,
  children,
}: {
  title: string;
  delay: number;
  reduced: boolean;
  children: ReactNode;
}) => {
  const rows = Children.toArray(children).filter(Boolean);
  if (rows.length === 0) return null;
  return (
    <RiseIn delay={delay} reduced={reduced} distance={14} duration={600}>
      <View style={styles.group}>
        <StreamZText style={styles.groupLabel}>{title}</StreamZText>
        <View style={styles.groupCard}>
          {rows.map((row, i) => (
            <Fragment key={`${title}:${i}`}>
              {i > 0 ? <View style={styles.divider} /> : null}
              {row}
            </Fragment>
          ))}
        </View>
      </View>
    </RiseIn>
  );
};

/**
 * Hover and D-pad focus for a pressable. RN's style callback only reports
 * `pressed` in this version, so the other two come from the hover/focus events
 * the same way `Focusable` reads them — which keeps one implementation for
 * touch, a pointer on an Android device, and the TV remote.
 */
const useInteractionState = () => {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return {
    hovered,
    focused,
    hoverProps: {
      onHoverIn: () => setHovered(true),
      onHoverOut: () => setHovered(false),
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
    },
  };
};

/** The key row's eye toggle. Revealing is local; nothing leaves the device. */
const RevealButton = ({
  revealed,
  onPress,
  label,
}: {
  revealed: boolean;
  onPress: () => void;
  label: string;
}) => {
  const { hovered, focused, hoverProps } = useInteractionState();
  return (
    <Pressable
      {...hoverProps}
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.iconButton,
        (hovered || focused) && styles.iconButtonHover,
        pressed && styles.iconButtonPressed,
      ]}
    >
      {revealed
        ? <EyeOff size={18} color={AUTH.faint} strokeWidth={1.8} />
        : <Eye size={18} color={AUTH.faint} strokeWidth={1.8} />}
      {focused ? <View pointerEvents="none" style={styles.focusRing} /> : null}
    </Pressable>
  );
};

/**
 * A grouped row. The mockup's hover fill, press fill, chevron tint and inset
 * focus ring all come from one interaction state, so touch, a pointer on an
 * Android device, and the D-pad share a single implementation.
 */
const Row = ({
  icon: Glyph,
  title,
  value,
  chevron = true,
  onPress,
}: {
  icon: RowIcon;
  title: string;
  value?: string;
  chevron?: boolean;
  onPress: () => void;
}) => {
  const { hovered, focused, hoverProps } = useInteractionState();
  return (
    <Pressable
      {...hoverProps}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${title}, ${value}` : title}
      style={({ pressed }) => [
        styles.row,
        (hovered || focused) && styles.rowHover,
        pressed && styles.rowPressed,
      ]}
    >
      <Tile>
        <Glyph size={20} color={SETTINGS.iconStroke} strokeWidth={1.8} />
      </Tile>
      <View style={styles.rowText}>
        <StreamZText style={styles.rowTitle}>{title}</StreamZText>
        {value ? (
          <StreamZText style={styles.rowValue} numberOfLines={1}>
            {value}
          </StreamZText>
        ) : null}
      </View>
      {chevron ? (
        <ChevronRight
          size={18}
          color={focused ? '#FFFFFF' : SETTINGS.chevron}
          strokeWidth={2.2}
        />
      ) : null}
      {focused ? <View pointerEvents="none" style={styles.focusRing} /> : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: AUTH.ink },
  content: { paddingHorizontal: 20, paddingBottom: 30 },
  glow: { position: 'absolute', right: -120, top: -160, width: 420, height: 420 },
  // The mockup's 34px Space Grotesk 600 at -.025em: larger than the app-wide
  // screen title, because on this screen the heading is the whole frame.
  title: {
    fontFamily: FONT.displayMedium,
    fontSize: 34,
    fontWeight: '600',
    letterSpacing: -0.85,
    lineHeight: 36,
    color: '#FFFFFF',
  },
  // The card itself carries no padding: its head block does, so the key row and
  // the sign-out row sit on the same 16px gutter and the same full-bleed
  // dividers as every grouped row on the page.
  accountCard: {
    marginTop: 22,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: AUTH.hairline,
    overflow: 'hidden',
  },
  accountHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
  },
  avatar: { width: 46, height: 46, borderRadius: 15, backgroundColor: SURFACE.low },
  gTile: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountIdentity: { flex: 1, minWidth: 0 },
  accountName: {
    fontFamily: FONT.sansSemiBold,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.16,
    color: '#FFFFFF',
  },
  statusLine: { marginTop: 5, flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  statusLabel: {
    flexShrink: 1,
    fontFamily: FONT.sans,
    fontSize: 13,
    lineHeight: 17,
    color: AUTH.muted,
  },
  finePrint: {
    marginTop: 3,
    fontFamily: FONT.sans,
    fontSize: 12,
    lineHeight: 16,
    color: AUTH.faint,
  },
  keyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  keyValue: {
    marginTop: 3,
    fontFamily: FONT.mono,
    fontSize: 13,
    lineHeight: 17,
    color: SETTINGS.iconStroke,
  },
  iconButton: { padding: 6, borderRadius: 10 },
  iconButtonHover: { backgroundColor: SETTINGS.hover },
  iconButtonPressed: { backgroundColor: SETTINGS.pressed },
  group: { marginTop: 26 },
  groupLabel: {
    paddingHorizontal: 6,
    paddingBottom: 10,
    fontFamily: FONT.sansSemiBold,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2.2,
    color: AUTH.faint,
  },
  groupCard: {
    borderRadius: 22,
    backgroundColor: SURFACE.low,
    borderWidth: 1,
    borderColor: SETTINGS.groupEdge,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowHover: { backgroundColor: SETTINGS.hover },
  rowPressed: { backgroundColor: SETTINGS.pressed },
  iconTile: {
    flexShrink: 0,
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: SETTINGS.iconTile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: {
    fontFamily: FONT.sansMedium,
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 20,
    letterSpacing: -0.16,
    color: '#FFFFFF',
  },
  rowValue: {
    marginTop: 3,
    fontFamily: FONT.sans,
    fontSize: 13,
    lineHeight: 17,
    color: AUTH.faint,
  },
  divider: { height: 1, backgroundColor: SETTINGS.rowDivider },
  // RN has no outline, so the mockup's `outline-offset:-2px` focus ring is an
  // absolutely positioned border — same drawing, and it costs no layout.
  focusRing: {
    position: 'absolute',
    top: 2,
    left: 2,
    right: 2,
    bottom: 2,
    borderWidth: 2,
    borderColor: MARK_RAMP.bright,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  // The mockup ships no text field. It takes the auth flow's field ink and this
  // screen's row radius so it reads as part of the card rather than a widget.
  nameField: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: SETTINGS.rowDivider,
    backgroundColor: AUTH.field,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: FONT.sans,
    fontSize: 15,
    lineHeight: 20,
    color: '#FFFFFF',
  },
  footer: { marginTop: 30, alignItems: 'center', gap: 8 },
  footerMark: { opacity: 0.55 },
  version: {
    fontFamily: FONT.sans,
    fontSize: 12,
    letterSpacing: 0.48,
    color: SETTINGS.chevron,
  },
});
