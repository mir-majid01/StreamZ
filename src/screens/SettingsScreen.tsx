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
  Gauge,
  Info,
  Globe,
  Heart,
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
import { Text } from '@/components/ui/text';
import { Input, InputField } from '@/components/ui/input';
import { ScrollView } from '@/components/ui/scroll-view';
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
  const { displayName, setDisplayName } = useWatchParty();
  const [nameDraft, setNameDraft] = useState(displayName);

  useEffect(() => {
    setNameDraft(displayName);
  }, [displayName]);

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
            label="Buffering"
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
