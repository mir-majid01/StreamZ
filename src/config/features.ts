// Spec §2 and §16: these surfaces are hidden in Phase 1A by flag, not deleted.
// Flip a flag back to true to restore the corresponding code path.
export const FEATURES = {
  // Live TV is fully ported from upstream (LiveTvScreen, LivePlayerScreen,
  // DaddyLiveService, LivePlayerChannelDrawer) and its only data source is the
  // remote M3U playlist (LIVE_TV_M3U_CONFIG), which is always enabled. Flip on.
  // Note: without EXPO_PUBLIC_FLIXQUEST_API_URL the guide/EPG and DLHD paths in
  // DaddyLiveService have no host, so the tab shows real channels + playback but
  // no programme schedule. That limitation is reported, not papered over.
  liveTv: true,
  watchParty: false,
  tvLayout: false,
  updateChecker: false,
} as const;
