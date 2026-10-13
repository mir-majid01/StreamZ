import { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronRight,
  Captions,
  CheckCircle2,
  Bookmark,
  Download,
  Eye,
  EyeOff,
  Gauge,
  Info,
  Globe,
  Heart,
  KeyRound,
  LogOut,
  MonitorPlay,
  Ratio,
  Server as ServerIcon,
  User,
  Users,
} from 'lucide-react-native';
import { Box } from '@/components/ui/box';
import { VStack } from '@/components/ui/vstack';
import { HStack } from '@/components/ui/hstack';
import { Heading } from '@/components/ui/heading';
import { Icon } from '@/components/ui/icon';
import { Image } from '@/components/ui/image';
import { Text } from '@/components/ui/text';
import { Input, InputField } from '@/components/ui/input';
import { ScrollView } from '@/components/ui/scroll-view';
import {
  Toast,
  ToastDescription,
  ToastTitle,
  useToast,
} from '@/components/ui/toast';
import { ConfirmDialog } from '@/src/components/ConfirmDialog';
import { Focusable } from '@/src/components/Focusable';
import { useServers } from '@/src/hooks/useServers';
import { UPDATE_CONFIG, WATCH_PARTY_CONFIG } from '@/src/config/env';

import { useSubtitleSettings } from '@/src/hooks/useSubtitleSettings';
import {
  getQualityLabel,
  useVideoQuality,
} from '@/src/hooks/useVideoQuality';
import {
  getAspectLabel,
  useVideoAspect,
} from '@/src/hooks/useVideoAspect';
import { getLanguageLabel } from '@/src/constants/languages';
import { getRegionName, useCatalogRegion } from '@/src/hooks/useCatalogRegion';
import { UpdateModal } from '@/src/components/UpdateModal';
import { updateService } from '@/src/services/UpdateService';
import { useFinishedMovies } from '@/src/hooks/useFinishedMovies';
import { useMyList } from '@/src/hooks/useMyList';
import { useSession } from '@/src/firebase/auth/SessionProvider';
import { signOut } from '@/src/firebase/auth/googleAuth';
import { DAY_MS } from '@/src/firebase/models';
import { loadActivationKey, maskKey } from '@/src/firebase/subscriptions/savedKey';
import { usePlaybackSettings } from '@/src/hooks/usePlaybackSettings';
import { useWatchParty } from '@/src/hooks/useWatchParty';
import { PARTY_DISPLAY_NAME_MAX } from '@/src/party/displayName';
import { formatMemoryGb } from '@/src/utils/deviceRecommendations';
import { TV_FOCUS_BORDER_CLASSNAME } from '@/src/utils/tv';
import type { RootStackParamList } from '@/src/navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export const SettingsScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { activeServer } = useServers();
  const { entries: finishedMovies } = useFinishedMovies();
  const { items: myList } = useMyList();
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
  const daysLeft =
    expiresAt != null
      ? Math.max(0, Math.ceil((expiresAt - (access?.serverTimeMs ?? Date.now())) / DAY_MS))
      : null;
  const expiryLabel = expiresAt != null
    ? new Date(expiresAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  useEffect(() => {
    setNameDraft(displayName);
  }, [displayName]);

  // Sign-out ends the session only. The subscription record, the activation
  // key, My List, and any finished downloads all stay on the device — they are
  // keyed to this account and are needed again the next time it signs in, so
  // this is deliberately not a "clear my data" action.
  const confirmSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      setSignOutPrompt(false);
    } catch (err) {
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

  return (
    <Box className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <Heading size="2xl" bold className="mb-6 mt-4 px-4 text-foreground">
        Settings
      </Heading>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      >
        <VStack space="sm" className="px-4">
          {/* ── Account ───────────────────────────────────────────────
              Identity + subscription live at the top so the user sees who
              they are signed in as, how much of the term remains, and the
              key that granted it — then can sign out from here. */}
          <Box className="rounded-xl bg-card p-4">
            <HStack space="md" className="items-center">
              {user?.photoURL ? (
                <Image
                  source={{ uri: user.photoURL }}
                  alt={user.displayName ?? 'Account'}
                  resizeMode="cover"
                  className="h-12 w-12 rounded-full bg-background"
                />
              ) : (
                <Box className="h-12 w-12 items-center justify-center rounded-full bg-primary/20">
                  <Text className="text-lg font-bold text-primary">
                    {(user?.displayName ?? user?.email ?? '?')
                      .trim()
                      .charAt(0)
                      .toUpperCase()}
                  </Text>
                </Box>
              )}
              <VStack className="flex-1">
                <Heading size="md" className="text-foreground" numberOfLines={1}>
                  {user?.displayName ?? 'Signed in'}
                </Heading>
                {user?.email ? (
                  <Text size="xs" className="text-muted-foreground" numberOfLines={1}>
                    {user.email}
                  </Text>
                ) : null}
              </VStack>
            </HStack>

            {expiresAt != null ? (
              <HStack className="mt-3 items-center justify-between">
                <Text size="sm" className="text-muted-foreground">
                  Subscription
                </Text>
                <Text size="sm" className="text-foreground">
                  {daysLeft != null && daysLeft > 0
                    ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left · ${expiryLabel}`
                    : `Expired · ${expiryLabel}`}
                </Text>
              </HStack>
            ) : null}

            {activationKey ? (
              <HStack className="mt-2 items-center justify-between">
                <HStack space="sm" className="flex-1 items-center">
                  <Icon as={KeyRound} size="sm" className="text-muted-foreground" />
                  <Text
                    size="sm"
                    className="text-foreground"
                    selectable
                  >
                    {keyRevealed ? activationKey : maskKey(activationKey)}
                  </Text>
                </HStack>
                <Focusable
                  onPress={() => setKeyRevealed((r) => !r)}
                  hitSlop={10}
                  className="rounded-full p-1.5"
                  focusedClassName={TV_FOCUS_BORDER_CLASSNAME}
                >
                  <Icon
                    as={keyRevealed ? EyeOff : Eye}
                    size="sm"
                    className="text-muted-foreground"
                  />
                </Focusable>
              </HStack>
            ) : null}

            <Focusable
              onPress={() => setSignOutPrompt(true)}
              className="mt-4 flex-row items-center justify-center gap-2 rounded-lg border border-border py-2.5"
              focusedClassName={TV_FOCUS_BORDER_CLASSNAME}
            >
              <Icon as={LogOut} size="sm" className="text-foreground" />
              <Text className="text-foreground">Sign out</Text>
            </Focusable>
          </Box>

          {WATCH_PARTY_CONFIG.enabled ? (
            <>
              <MenuRow
                icon={Users}
                label="Join watch party"
                value="Live rooms or a code"
                onPress={() => navigation.navigate('JoinParty', {})}
              />
              <HStack className="items-center rounded-lg bg-card px-4 py-4">
                <Icon as={User} className="text-foreground" />
                <VStack className="ml-3 flex-1">
                  <Text className="text-foreground">Watch party name</Text>
                  <Input className="mt-2">
                    <InputField
                      value={nameDraft}
                      onChangeText={setNameDraft}
                      placeholder="Shown in chat and reactions"
                      maxLength={PARTY_DISPLAY_NAME_MAX}
                      autoCorrect={false}
                      onBlur={() => {
                        void setDisplayName(nameDraft).then(setNameDraft);
                      }}
                      onSubmitEditing={() => {
                        void setDisplayName(nameDraft).then(setNameDraft);
                      }}
                    />
                  </Input>
                </VStack>
              </HStack>
            </>
          ) : null}
          <MenuRow
            icon={ServerIcon}
            label="Playback server"
            value={activeServer.name}
            onPress={() => navigation.navigate('ServerSettings')}
          />
          <MenuRow
            icon={Globe}
            label="Catalog region"
            value={regionName}
            onPress={() => navigation.navigate('RegionSettings')}
          />
          <MenuRow
            icon={MonitorPlay}
            label="Video quality"
            value={`Preferred: ${videoQualityLabel}`}
            onPress={() => navigation.navigate('VideoQualitySettings')}
          />
          <MenuRow
            icon={Ratio}
            label="Video aspect"
            value={videoAspectLabel}
            onPress={() => navigation.navigate('VideoAspectSettings')}
          />
          <MenuRow
            icon={Captions}
            label="Subtitles"
            value={`Default: ${subtitleLangLabel}`}
            onPress={() => navigation.navigate('SubtitleSettings')}
          />
          <MenuRow
            icon={Gauge}
            label="Playback"
            value={`${effectiveForwardBufferSeconds}s${forwardBufferSeconds == null ? ' · Auto' : ''} · ${formatMemoryGb(deviceTotalMemory)} RAM`}
            onPress={() => navigation.navigate('PlaybackPerformance')}
          />
          <MenuRow
            icon={Bookmark}
            label="My List"
            value={`${myList.length} saved`}
            onPress={() => navigation.navigate('MyList')}
          />
          <MenuRow
            icon={CheckCircle2}
            label="Finished movies"
            value={`${finishedMovies.length} completed`}
            onPress={() => navigation.navigate('FinishedMovies')}
          />
          {UPDATE_CONFIG.enabled ? (
            <MenuRow
              icon={Download}
              label="Check for updates"
              value={`Current version: v${updateService.getCurrentVersion()}`}
              onPress={() => setUpdaterOpen(true)}
            />
          ) : null}
          <MenuRow
            icon={Info}
            label="Disclaimer"
            value="About content sources & third-party servers"
            onPress={() => navigation.navigate('Disclaimer')}
          />
          <MenuRow
            icon={Heart}
            label="About"
            value="Credits, licence, privacy and support"
            onPress={() => navigation.navigate('Credits')}
          />
        </VStack>
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
    </Box>
  );
};

const MenuRow = ({
  icon,
  label,
  value,
  onPress,
}: {
  icon: typeof ServerIcon;
  label: string;
  value?: string;
  onPress: () => void;
}) => (
  <Focusable
    onPress={onPress}
    className="rounded-lg"
    focusedClassName={TV_FOCUS_BORDER_CLASSNAME}
  >
    <HStack className="items-center rounded-lg bg-card px-4 py-4">
      <Icon as={icon} className="text-foreground" />
      <VStack className="ml-3 flex-1">
        <Text className="text-foreground">{label}</Text>
        {value ? (
          <Text size="xs" className="text-muted-foreground">
            {value}
          </Text>
        ) : null}
      </VStack>
      <Icon as={ChevronRight} className="text-muted-foreground" />
    </HStack>
  </Focusable>
);
