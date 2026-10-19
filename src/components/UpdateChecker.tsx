import { useCallback, useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { UpdateModal } from '@/src/components/UpdateModal';
import { updateService, type UpdateInfo } from '@/src/services/UpdateService';
import {
  clearSkippedVersion,
  saveLastUpdateCheck,
  shouldCheckForUpdates,
} from '@/src/utils/updateCheckStorage';

interface UpdateCheckerProps {
  /** Also re-check when the app returns to the foreground. Default: false. */
  checkOnForeground?: boolean;
}

/**
 * Optional foreground update polling. Cold-start checks are owned by
 * `SplashScreen` so the modal can gate entry into Main without a second
 * prompt racing from this component.
 */
export const UpdateChecker = ({
  checkOnForeground = false,
}: UpdateCheckerProps) => {
  const [visible, setVisible] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  const runCheck = useCallback(async (force = false) => {
    try {
      if (!force && !(await shouldCheckForUpdates())) return;
      const info = await updateService.checkForUpdates();
      await saveLastUpdateCheck();

      if (!info.hasUpdate) return;

      // A version skipped by an older build must not keep hiding an update: the dialog can no
      // longer be dismissed, so anything still recorded would silently strand this device.
      await clearSkippedVersion();

      setUpdateInfo(info);
      setVisible(true);
    } catch {
      // Background check failures never disturb the user.
    }
  }, []);

  // Foreground listener (opt-in). Boot-time checks live on Splash.
  useEffect(() => {
    if (!checkOnForeground) return;
    const sub = AppState.addEventListener(
      'change',
      (state: AppStateStatus) => {
        if (state === 'active') void runCheck();
      },
    );
    return () => sub.remove();
  }, [checkOnForeground, runCheck]);

  if (!visible) return null;

  return (
    <UpdateModal
      visible={visible}
      onClose={() => setVisible(false)}
      initialUpdateInfo={updateInfo}
    />
  );
};
