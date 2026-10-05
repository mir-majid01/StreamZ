import { useCallback, type ReactNode } from 'react';
import { Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  AtSign,
  ExternalLink,
  Mail,
  Shield,
} from 'lucide-react-native';
import { Box } from '@/components/ui/box';
import { VStack } from '@/components/ui/vstack';
import { HStack } from '@/components/ui/hstack';
import { Heading } from '@/components/ui/heading';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { ScrollView } from '@/components/ui/scroll-view';
import { Focusable } from '@/src/components/Focusable';
import { BRAND, LEGAL } from '@/src/config/brand';
import { getAppVersion } from '@/src/utils/appVersion';
import { TV_FOCUS_BORDER_CLASSNAME } from '@/src/utils/tv';

interface Credit {
  name: string;
  description: string;
  url?: string;
}

const CREDITS: Credit[] = [
  {
    name: 'The Movie Database (TMDB)',
    description:
      'All movie & TV metadata, posters, and backdrops are provided by TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.',
    url: 'https://www.themoviedb.org',
  },
  {
    name: 'Wyzie Subs',
    description:
      'Subtitles are sourced from the Wyzie Subs public API. Track availability and language coverage vary per title.',
    url: 'https://sub.wyzie.ru',
  },
  {
    name: 'Expo',
    description:
      'Built with Expo SDK 57 on top of React Native. expo-navigation-bar keeps the player immersive, expo-keep-awake holds the wake lock during playback.',
    url: 'https://expo.dev',
  },
  {
    name: 'react-native-video',
    description:
      "Powers all video playback, including quality switching, Picture-in-Picture, and native subtitle tracks. Maintained by TheWidlarzGroup and the react-native-video community.",
    url: 'https://github.com/TheWidlarzGroup/react-native-video',
  },
  {
    name: 'gluestack-ui v5',
    description:
      'UI primitives, semantic tokens, and design system baseline. Styling is driven by NativeWind v5 / Tailwind CSS v4.',
    url: 'https://gluestack.io/ui/docs',
  },
  {
    name: 'lucide-react-native',
    description: 'Icon set used throughout the app.',
    url: 'https://lucide.dev',
  },
  {
    name: 'Original developer',
    description: `${LEGAL.upstreamAuthor} — created ${LEGAL.upstreamName}, the codebase this app was built from. ${LEGAL.license}.`,
    url: LEGAL.upstreamUrl,
  },
  {
    name: LEGAL.sampleTitle,
    description: `${LEGAL.sampleCredit}. The sample clip offered in the player so a new install can test playback without a stream source.`,
    url: 'https://www.blender.org/open-requires',
  },
];

export const CreditsScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const open = useCallback(async (url?: string) => {
    if (!url) return;
    const can = await Linking.canOpenURL(url);
    if (can) await Linking.openURL(url);
  }, []);

  return (
    <Box className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <HStack space="md" className="items-center px-4 py-3">
        <Focusable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          className="rounded-full"
          focusedClassName={TV_FOCUS_BORDER_CLASSNAME}
        >
          <Icon as={ArrowLeft} size="xl" className="text-foreground" />
        </Focusable>
        <Heading size="xl" bold className="text-foreground">
          About
        </Heading>
      </HStack>

      <ScrollView className="flex-1 px-4">
        <VStack space="lg" className="pb-10">
          <Text size="sm" className="text-muted-foreground">
            {BRAND.name} v{getAppVersion()} is built on the work of these
            projects and services.
          </Text>

          <VStack space="md">
            {CREDITS.map((credit) => (
              <Focusable
                key={credit.name}
                onPress={() => open(credit.url)}
                className="rounded-lg"
                focusedClassName={TV_FOCUS_BORDER_CLASSNAME}
              >
                <Box className="rounded-lg bg-card p-4">
                  <HStack className="items-center justify-between">
                    <Heading size="sm" className="text-foreground">
                      {credit.name}
                    </Heading>
                    {credit.url && (
                      <Icon
                        as={ExternalLink}
                        size="sm"
                        className="text-muted-foreground"
                      />
                    )}
                  </HStack>
                  <Text size="sm" className="mt-1 text-muted-foreground">
                    {credit.description}
                  </Text>
                </Box>
              </Focusable>
            ))}
          </VStack>

          <Panel
            icon={Shield}
            title="License and source"
            body={`${LEGAL.attributionLine} ${BRAND.name} is distributed under the same licence, and the complete source of the version you are running is available to anyone you give the app to.`}
            actionLabel="View the source"
            onAction={() => open(LEGAL.sourceUrl)}
          />

          <Panel
            icon={Shield}
            title="What this app stores"
            body="Signing in keeps your Google account name, email and photo in Firebase so your subscription can be tied to you. Activation stores a one-way hash of your key, never the key itself, plus an installation identifier this device generates at random. While you watch, the app records which title you played, for how long, and the app version, so the operator can see what is being watched. Google Analytics receives app usage events. No advertising identifier is collected, and no contacts, location, photos or microphone access are used for analytics."
          />

          <Panel
            icon={Mail}
            title="Get help"
            body={`Subscription problems, account requests and removal notices are handled here. Include the email you signed in with, and the app version above.`}
          >
            <LinkRow
              icon={Mail}
              label={BRAND.supportEmail}
              onPress={() => open(`mailto:${BRAND.supportEmail}`)}
            />
            <LinkRow
              icon={AtSign}
              label={BRAND.supportTelegram}
              onPress={() => open(BRAND.supportTelegramUrl)}
            />
          </Panel>
        </VStack>
      </ScrollView>
    </Box>
  );
};

const Panel = ({
  icon,
  title,
  body,
  actionLabel,
  onAction,
  children,
}: {
  icon: typeof Mail;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
}) => (
  <Box className="rounded-lg bg-card p-4">
    <HStack className="items-center space-x-2">
      <Icon as={icon} size="sm" className="text-foreground" />
      <Heading size="sm" className="text-foreground">
        {title}
      </Heading>
    </HStack>
    <Text size="sm" className="mt-2 text-muted-foreground">
      {body}
    </Text>
    {children}
    {actionLabel && onAction ? (
      <Focusable
        onPress={onAction}
        className="mt-2 self-start rounded"
        focusedClassName={TV_FOCUS_BORDER_CLASSNAME}
      >
        <HStack className="items-center space-x-1">
          <Text size="sm" className="text-primary">
            {actionLabel}
          </Text>
          <Icon as={ExternalLink} size="xs" className="text-primary" />
        </HStack>
      </Focusable>
    ) : null}
  </Box>
);

const LinkRow = ({
  icon,
  label,
  onPress,
}: {
  icon: typeof Mail;
  label: string;
  onPress: () => void;
}) => (
  <Focusable
    onPress={onPress}
    className="mt-2 rounded"
    focusedClassName={TV_FOCUS_BORDER_CLASSNAME}
  >
    <HStack className="items-center space-x-2">
      <Icon as={icon} size="sm" className="text-muted-foreground" />
      <Text size="sm" className="text-foreground">
        {label}
      </Text>
    </HStack>
  </Focusable>
);
