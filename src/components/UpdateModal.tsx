import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, ScrollView } from 'react-native';
import { X } from 'lucide-react-native';
import type { File } from 'expo-file-system';
import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { VStack } from '@/components/ui/vstack';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { Pressable } from '@/components/ui/pressable';
import { ChangelogSection } from '@/src/components/ChangelogMarkdown';
import { Focusable } from '@/src/components/Focusable';
import {
  updateService,
  type UpdateInfo,
} from '@/src/services/UpdateService';
import { verifyDownloadedApk } from '@/src/firebase/release/policy';
import { canInstallFromUnknownSources } from '@/src/utils/apkIntegrity';
import type {
  IntegrityReason,
  ReleasePolicy,
} from '@/src/utils/releasePolicy';
import { TV_FOCUS_BORDER_CLASSNAME } from '@/src/utils/tv';

interface UpdateModalProps {
  visible: boolean;
  onClose: () => void;
  /** Pre-fetched update info (from the background checker). */
  initialUpdateInfo?: UpdateInfo | null;
  /** Optional "Skip this version" callback. */
  onSkipVersion?: () => void;
  /**
   * The published release policy whose digest, package name and signing
   * certificate the downloaded file is checked against. Without it there is
   * nothing to verify against, so the in-app install is not offered.
   */
  policy?: ReleasePolicy | null;
  /** Mandatory updates cannot be dismissed, skipped, or backed out of. */
  mandatory?: boolean;
  /** Used by the Exit action on a mandatory update. */
  onExit?: () => void;
}

type UpdateState =
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'error'
  | 'needsPermission'
  | 'downloading'
  | 'verifying'
  | 'refused'
  | 'installing'
  | 'downloaded';

const REFUSAL_COPY: Record<IntegrityReason, string> = {
  ok: '',
  not_measured:
    'This build cannot verify downloads, so it will not install one. Install manually from the release page.',
  no_expected_digest:
    'The published release does not name a checksum, so this file cannot be trusted.',
  digest_mismatch:
    'The downloaded file does not match the published checksum. It may be corrupt or not our release.',
  package_mismatch:
    'The downloaded file is not a StreamZ package.',
  signature_mismatch:
    'The downloaded file was not signed by StreamZ.',
  size_mismatch:
    'The downloaded file is a different size than the published release.',
};

export const UpdateModal = ({
  visible,
  onClose,
  initialUpdateInfo,
  onSkipVersion,
  policy = null,
  mandatory = false,
  onExit,
}: UpdateModalProps) => {
  const [state, setState] = useState<UpdateState>('checking');
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [refusal, setRefusal] = useState<IntegrityReason>('not_measured');

  // In-app download/install flow state (Android only — see `downloadUrl`).
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [downloadedFile, setDownloadedFile] = useState<File | null>(null);
  const [installOutcome, setInstallOutcome] = useState('');

  // Tracked so the unmount/close cleanup only cancels a download that's
  // actually still in flight, not one that already finished.
  const stateRef = useRef(state);
  stateRef.current = state;

  const runCheck = useCallback(async () => {
    setState('checking');
    setErrorMessage('');
    try {
      const result = await updateService.checkForUpdates();
      setInfo(result);
      setState(result.hasUpdate ? 'available' : 'up-to-date');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to check for updates',
      );
      setState('error');
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    setDownloadProgress(0);
    setDownloadedBytes(0);
    setTotalBytes(0);
    setDownloadedFile(null);
    if (initialUpdateInfo) {
      setInfo(initialUpdateInfo);
      setState(initialUpdateInfo.hasUpdate ? 'available' : 'up-to-date');
    } else {
      void runCheck();
    }
  }, [visible, initialUpdateInfo, runCheck]);

  // If the modal is closed/unmounted mid-download, don't leave an orphaned
  // download silently running forever in the background.
  useEffect(() => {
    return () => {
      if (stateRef.current === 'downloading') updateService.cancelDownload();
    };
  }, []);

  const openReleasePage = useCallback(async () => {
    if (!info?.releaseUrl) return;
    await updateService.openReleasePage(info.releaseUrl);
  }, [info]);

  // Hands a downloaded file to the system installer and reacts to the
  // result. A successful install typically kills/replaces this process
  // before the promise below even resolves — if we DO see it resolve, the
  // user most likely backed out of the installer, so offer a retry using
  // the file we already have (no need to re-download).
  const runInstall = useCallback(async (file: File) => {
    setState('installing');
    try {
      // Android's own codes. The installer reports CANCELED when the user backs out and OK when it
      // accepted the package; anything else is the system refusing. Reading the code is the
      // difference between "install cancelled" and a silent lie: without it a refusal, a
      // cancellation and an accepted install all rendered the same sentence.
      const { resultCode } = await updateService.installApk(file);
      if (resultCode === 0) {
        setInstallOutcome(
          'Install was cancelled. The downloaded file is kept, so you can retry without re-downloading.',
        );
      } else if (resultCode === -1) {
        setInstallOutcome(
          'Android accepted the update. Finish the on-screen prompt to complete it.',
        );
      } else {
        setErrorMessage(
          `Android would not install this update (result code ${resultCode}).`,
        );
        setState('error');
        return;
      }
      setState('downloaded');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to open the installer.',
      );
      setState('error');
    }
  }, []);

  // Primary "Update" action: downloads the APK in-app with progress, proves it is the
  // release the policy describes, and only then hands it to the installer. A finished
  // download is not evidence of authenticity, so nothing installs on an unverified
  // file — not even when the user is stuck behind a mandatory gate.
  const startUpdate = useCallback(async () => {
    if (Platform.OS !== 'android' || !info?.downloadUrl) {
      await openReleasePage();
      return;
    }
    // Asked before the download starts: spending the user's data on an APK the
    // OS will refuse to install is the worse failure.
    if (!(await canInstallFromUnknownSources())) {
      setState('needsPermission');
      return;
    }
    setState('downloading');
    setDownloadProgress(0);
    setDownloadedBytes(0);
    setTotalBytes(info.assetSize ?? 0);
    try {
      const file = await updateService.downloadApk(
        info.downloadUrl,
        ({ bytesWritten, totalBytes: total }) => {
          setDownloadedBytes(bytesWritten);
          if (total > 0) {
            setTotalBytes(total);
            setDownloadProgress(Math.min(100, (bytesWritten / total) * 100));
          }
        },
        // The policy's own byte count, so a truncated transfer is named as one
        // instead of surfacing later as a digest mismatch on a half-file.
        { expectedBytes: policy?.sizeBytes ?? info.assetSize ?? null },
      );
      setDownloadedFile(file);
      setState('verifying');
      const verdict = await verifyDownloadedApk(file.uri, policy);
      if (!verdict.allowed) {
        setRefusal(verdict.reason);
        setState('refused');
        return;
      }
      await runInstall(file);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to download the update.',
      );
      setState('error');
    }
  }, [info, openReleasePage, policy, runInstall]);

  const cancelDownloadFlow = useCallback(() => {
    updateService.cancelDownload();
    setState('available');
  }, []);

  const openInstallSettings = useCallback(async () => {
    try {
      await updateService.openUnknownSourcesSettings();
    } catch {
      setErrorMessage(
        'Android did not open the install permission screen. Allow "install unknown apps" for StreamZ in System settings, then try again.',
      );
      setState('error');
    }
  }, []);

  const retryInstall = useCallback(() => {
    if (downloadedFile) void runInstall(downloadedFile);
  }, [downloadedFile, runInstall]);

  const canDownload =
    Platform.OS === 'android' &&
    Boolean(info?.downloadUrl) &&
    Boolean(policy);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // A mandatory gate has no dismissal gesture: hardware back stays with the
      // screen so the only ways out are updating or exiting.
      onRequestClose={() => {
        if (!mandatory) onClose();
      }}
    >
      <Box className="flex-1 bg-background/90">
        <Box className="flex-1 items-center justify-center px-6">
          <Box className="h-[90vh] w-full max-w-md overflow-hidden rounded-2xl bg-card p-6">
            <HStack className="mb-4 items-center justify-between">
              <Heading size="lg" bold className="text-foreground">
                {mandatory ? 'Update required' : 'App Update'}
              </Heading>
              {!mandatory && (
                <Focusable
                  onPress={onClose}
                  className="rounded-full bg-background/40 p-2"
                  focusedClassName={`bg-primary ${TV_FOCUS_BORDER_CLASSNAME}`}
                >
                  <Icon as={X} size="lg" className="text-foreground" />
                </Focusable>
              )}
            </HStack>

            <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
              {state === 'checking' && (
                <VStack space="md" className="items-center py-8">
                  <Spinner size="large" color="#E50914" />
                  <Text className="text-foreground">
                    Checking for updates…
                  </Text>
                  <Text size="xs" className="text-muted-foreground">
                    Current version: {updateService.getCurrentVersion()}
                  </Text>
                </VStack>
              )}

              {state === 'up-to-date' && (
                <VStack space="md">
                  <VStack space="sm" className="items-center py-4">
                    <Text size="3xl" className="text-primary">
                      ✓
                    </Text>
                    <Heading size="md" className="text-foreground">
                      You&apos;re up to date
                    </Heading>
                    <Text
                      size="sm"
                      className="text-center text-muted-foreground"
                    >
                      Version {info?.currentVersion ?? info?.latestVersion} is
                      the latest.
                    </Text>
                    {!!info?.releaseDate && (
                      <Text size="xs" className="text-muted-foreground">
                        Released: {updateService.formatDate(info.releaseDate)}
                      </Text>
                    )}
                  </VStack>
                  <ChangelogSection
                    title="Changelog"
                    notes={info?.releaseNotes || 'No release notes available.'}
                  />
                </VStack>
              )}

              {state === 'available' && info && (
                <VersionSummary info={info} showDownloadSize={canDownload} />
              )}

              {state === 'downloading' && info && (
                <VersionSummary info={info} showDownloadSize />
              )}

              {state === 'needsPermission' && (
                <VStack space="md" className="items-center py-6">
                  <Text size="3xl" className="text-primary">
                    !
                  </Text>
                  <Heading size="md" className="text-foreground">
                    StreamZ may not install apps yet
                  </Heading>
                  <Text size="sm" className="text-center text-muted-foreground">
                    Android keeps this as a per-app switch that only you can
                    turn on. Nothing has been downloaded. Open the setting,
                    allow installs for StreamZ, then come back and try again.
                  </Text>
                </VStack>
              )}

              {state === 'verifying' && (
                <VStack space="md" className="items-center py-8">
                  <Spinner size="large" color="#E50914" />
                  <Text className="text-foreground">Verifying the download…</Text>
                  <Text size="xs" className="text-center text-muted-foreground">
                    Checking the fingerprint, package, and signature before
                    installing anything.
                  </Text>
                </VStack>
              )}

              {state === 'refused' && info && (
                <VStack space="md" className="items-center py-6">
                  <Text size="3xl" className="text-primary">
                    !
                  </Text>
                  <Heading size="md" className="text-foreground">
                    This file was not installed
                  </Heading>
                  <Text size="sm" className="text-center text-muted-foreground">
                    {REFUSAL_COPY[refusal]}
                  </Text>
                </VStack>
              )}

              {state === 'installing' && (
                <VStack space="md" className="items-center py-8">
                  <Spinner size="large" color="#E50914" />
                  <Text className="text-foreground">Opening installer…</Text>
                  <Text size="xs" className="text-center text-muted-foreground">
                    Confirm the install prompt to finish updating.
                  </Text>
                </VStack>
              )}

              {state === 'downloaded' && info && (
                <VStack space="md">
                  <VersionSummary info={info} />
                  <Text size="xs" className="text-center text-muted-foreground">
                    {installOutcome ||
                      'Downloaded — install was cancelled or dismissed. You can try again without re-downloading.'}
                  </Text>
                </VStack>
              )}

              {state === 'error' && (
                <VStack space="md" className="items-center py-8">
                  <Text size="3xl" className="text-primary">
                    !
                  </Text>
                  <Heading size="md" className="text-foreground">
                    Something went wrong
                  </Heading>
                  <Text size="sm" className="text-center text-muted-foreground">
                    {errorMessage || 'Please try again in a moment.'}
                  </Text>
                </VStack>
              )}
            </ScrollView>

            {state === 'up-to-date' && (
              <Focusable
                onPress={runCheck}
                className="mt-4 items-center rounded-md border border-border px-4 py-3"
                focusedClassName={`bg-primary/10 ${TV_FOCUS_BORDER_CLASSNAME}`}
              >
                <Text className="text-foreground">Check again</Text>
              </Focusable>
            )}

            {state === 'available' && info && (
              <VStack space="sm" className="mt-4">
                {canDownload ? (
                  <>
                    <Focusable
                      onPress={startUpdate}
                      hasTVPreferredFocus
                      className="items-center rounded-md bg-primary px-4 py-3"
                      focusedClassName="border-2 border-foreground"
                    >
                      <Text className="font-semibold text-primary-foreground">
                        Download & install
                      </Text>
                    </Focusable>
                    {info.releaseUrl && (
                      <Focusable
                        onPress={openReleasePage}
                        className="items-center rounded-md border border-border px-4 py-3"
                        focusedClassName={`bg-primary/10 ${TV_FOCUS_BORDER_CLASSNAME}`}
                      >
                        <Text className="text-foreground">Release page</Text>
                      </Focusable>
                    )}
                  </>
                ) : (
                  // No in-app install on this platform or no digest to verify
                  // against — the only honest link left is the release page,
                  // and a policy-driven update has none of those.
                  !!info.releaseUrl && (
                    <Focusable
                      onPress={openReleasePage}
                      hasTVPreferredFocus
                      className="items-center rounded-md bg-primary px-4 py-3"
                      focusedClassName="border-2 border-foreground"
                    >
                      <Text className="font-semibold text-primary-foreground">
                        View on GitHub
                      </Text>
                    </Focusable>
                  )
                )}
                {mandatory ? (
                  <Focusable
                    onPress={() => onExit?.()}
                    className="items-center rounded-md border border-border px-4 py-3"
                    focusedClassName={`bg-primary/10 ${TV_FOCUS_BORDER_CLASSNAME}`}
                  >
                    <Text className="text-foreground">Exit</Text>
                  </Focusable>
                ) : (
                  onSkipVersion && (
                    <Pressable onPress={onSkipVersion}>
                      <Box className="items-center py-2">
                        <Text size="sm" className="text-muted-foreground">
                          Skip this version
                        </Text>
                      </Box>
                    </Pressable>
                  )
                )}
              </VStack>
            )}

            {state === 'needsPermission' && (
              <VStack space="sm" className="mt-4">
                <Focusable
                  onPress={openInstallSettings}
                  hasTVPreferredFocus
                  className="items-center rounded-md bg-primary px-4 py-3"
                  focusedClassName="border-2 border-foreground"
                >
                  <Text className="font-semibold text-primary-foreground">
                    Open system settings
                  </Text>
                </Focusable>
                <Focusable
                  onPress={startUpdate}
                  className="items-center rounded-md border border-border px-4 py-3"
                  focusedClassName={`bg-primary/10 ${TV_FOCUS_BORDER_CLASSNAME}`}
                >
                  <Text className="text-foreground">I&apos;ve allowed it — try again</Text>
                </Focusable>
                {!mandatory && (
                  <Focusable
                    onPress={onClose}
                    className="items-center rounded-md border border-border px-4 py-3"
                    focusedClassName={`bg-primary/10 ${TV_FOCUS_BORDER_CLASSNAME}`}
                  >
                    <Text className="text-foreground">Later</Text>
                  </Focusable>
                )}
                {mandatory && (
                  <Focusable
                    onPress={() => onExit?.()}
                    className="items-center rounded-md border border-border px-4 py-3"
                    focusedClassName={`bg-primary/10 ${TV_FOCUS_BORDER_CLASSNAME}`}
                  >
                    <Text className="text-foreground">Exit</Text>
                  </Focusable>
                )}
              </VStack>
            )}

            {state === 'refused' && (
              <VStack space="sm" className="mt-4">
                <Focusable
                  onPress={startUpdate}
                  hasTVPreferredFocus
                  className="items-center rounded-md bg-primary px-4 py-3"
                  focusedClassName="border-2 border-foreground"
                >
                  <Text className="font-semibold text-primary-foreground">
                    Download again
                  </Text>
                </Focusable>
                {mandatory ? (
                  <Focusable
                    onPress={() => onExit?.()}
                    className="items-center rounded-md border border-border px-4 py-3"
                    focusedClassName={`bg-primary/10 ${TV_FOCUS_BORDER_CLASSNAME}`}
                  >
                    <Text className="text-foreground">Exit</Text>
                  </Focusable>
                ) : (
                  <Focusable
                    onPress={onClose}
                    className="items-center rounded-md border border-border px-4 py-3"
                    focusedClassName={`bg-primary/10 ${TV_FOCUS_BORDER_CLASSNAME}`}
                  >
                    <Text className="text-foreground">Later</Text>
                  </Focusable>
                )}
              </VStack>
            )}

            {state === 'downloading' && (
              <VStack space="sm" className="mt-4">
                <VStack space="sm">
                  <HStack className="items-center justify-between">
                    <Text size="sm" className="text-foreground">
                      Downloading…
                    </Text>
                    <Text size="sm" className="text-muted-foreground">
                      {Math.round(downloadProgress)}%
                    </Text>
                  </HStack>
                  <Box className="h-2 w-full overflow-hidden rounded-full bg-background/60">
                    <Box
                      className="h-2 rounded-full bg-primary"
                      style={{
                        width: `${Math.min(100, Math.max(0, downloadProgress))}%`,
                      }}
                    />
                  </Box>
                  <Text size="xs" className="text-muted-foreground">
                    {updateService.formatFileSize(downloadedBytes)}
                    {totalBytes > 0
                      ? ` / ${updateService.formatFileSize(totalBytes)}`
                      : ''}
                  </Text>
                </VStack>
                <Focusable
                  onPress={cancelDownloadFlow}
                  className="items-center rounded-md border border-border px-4 py-3"
                  focusedClassName={`bg-primary/10 ${TV_FOCUS_BORDER_CLASSNAME}`}
                >
                  <Text className="text-foreground">Cancel</Text>
                </Focusable>
              </VStack>
            )}

            {state === 'downloaded' && (
              <Focusable
                onPress={retryInstall}
                hasTVPreferredFocus
                className="mt-4 items-center rounded-md bg-primary px-4 py-3"
                focusedClassName="border-2 border-foreground"
              >
                <Text className="font-semibold text-primary-foreground">
                  Install
                </Text>
              </Focusable>
            )}

            {state === 'error' && (
              <VStack space="sm" className="mt-4">
                <Focusable
                  onPress={
                    info
                      ? canDownload
                        ? startUpdate
                        : openReleasePage
                      : runCheck
                  }
                  className="items-center rounded-md bg-primary px-4 py-3"
                  focusedClassName="border-2 border-foreground"
                >
                  <Text className="font-semibold text-primary-foreground">
                    {info && !canDownload ? 'View on GitHub' : 'Try again'}
                  </Text>
                </Focusable>
                {info?.releaseUrl && canDownload && (
                  <Focusable
                    onPress={openReleasePage}
                    className="items-center rounded-md border border-border px-4 py-3"
                    focusedClassName={`bg-primary/10 ${TV_FOCUS_BORDER_CLASSNAME}`}
                  >
                    <Text className="text-foreground">
                      Open in browser instead
                    </Text>
                  </Focusable>
                )}
                {mandatory && (
                  <Focusable
                    onPress={() => onExit?.()}
                    className="items-center rounded-md border border-border px-4 py-3"
                    focusedClassName={`bg-primary/10 ${TV_FOCUS_BORDER_CLASSNAME}`}
                  >
                    <Text className="text-foreground">Exit</Text>
                  </Focusable>
                )}
              </VStack>
            )}
          </Box>
        </Box>
      </Box>
    </Modal>
  );
};

/** Current → new version comparison + release notes, shared across states. */
const VersionSummary = ({
  info,
  showDownloadSize = false,
}: {
  info: UpdateInfo;
  showDownloadSize?: boolean;
}) => (
  <>
    <VStack className="rounded-lg bg-background/40 p-4">
      <HStack className="items-center justify-between">
        <Text size="sm" className="text-muted-foreground">
          Current
        </Text>
        <Text className="font-semibold text-foreground">
          {info.currentVersion}
        </Text>
      </HStack>
      <HStack className="mt-2 items-center justify-between">
        <Text size="sm" className="text-muted-foreground">
          New
        </Text>
        <Text className="font-semibold text-primary">
          {info.latestVersion}
        </Text>
      </HStack>
    </VStack>

    {!!info.releaseDate && (
      <Text size="xs" className="text-muted-foreground">
        Released: {updateService.formatDate(info.releaseDate)}
      </Text>
    )}
    {showDownloadSize && !!info.assetSize && (
      <Text size="xs" className="text-muted-foreground">
        Download size: {updateService.formatFileSize(info.assetSize)}
      </Text>
    )}

    <ChangelogSection notes={info.releaseNotes} />
  </>
);
