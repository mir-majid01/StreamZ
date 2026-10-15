# StreamZ CI 33 Regression Audit — Handoff for Qoder

**Branch:** `fix/ci33-regression-audit`  
**Base:** `fix/restoration-phase-2` at the repository state inspected on 2026-10-14  
**Purpose:** diagnose and repair the regressions observed after installing the CI run 33 APK. Do not merge or publish a production update until CI and the owner's device test pass.

## User-observed release-blocking issues

1. **Home feed and posters do not load.** The app displays “Network request failed. Check your connection.” and retries on a black Home screen (owner-provided screenshot). This is an observed error message, not proof that the physical internet connection is the cause.
2. **Live TV channel count did not increase.** Two prepared playlist repositories were expected to expand the channel catalogue, but the tested APK displayed approximately the previous number of channels.
3. **Subtitles fail on most tested movies.** This may involve subtitle lookup, subtitle URL fetching, conversion, sidecar/native track attachment, or the player's selected text-track state. Do not assume the parser alone is responsible.
4. **Audio track/language selection appears ineffective.** The owner could not find Hindi or other alternate-language audio on the movies tested. Distinguish (a) the stream truly has only one audio track from (b) track discovery, labels, selection indices, or native player wiring failing.
5. **Short-duration activation keys fail.** Keys configured for about four minutes and 30 minutes returned a generic “You cannot do this / try again” style failure, while a 30-day key activated successfully. Exact UI error/code was not captured, so this is a reproducible report to investigate, not yet a diagnosed root cause.

## Confirmed source-level findings from the current branch

### A. Live TV catalogue expansion exists but is not integrated

Commit `26eeda6d3b1546a98e6d9ca7b66813bab95c949e` added playlist parsing/merging and per-source cache support. Its own commit message explicitly states: **“Not wired in yet — DaddyLiveService still reads the single legacy playlist, so the app's Live TV behaviour is unchanged by this commit.”** The current `src/services/DaddyLiveService.ts` still defines the legacy `LIVE_TV_M3U_CONFIG` flow and old catalog cache key. Therefore, adding the parser alone cannot increase channels.

**Required fix:** locate the exact new loader/parser module(s) and wire them into the production Live TV load path. Merge both configured repositories plus the existing source; preserve source attribution, logo/country/categories and safe per-stream headers; deduplicate; use each source's last-known-good cache on empty/malformed/unavailable responses; never let an empty source erase existing working channels. Keep the legacy source as a fallback. Add integration tests against the real service boundary and assert the combined channel count is greater than either input alone. Do not invent repository URLs: use the two URLs already configured/prepared in this repository and verify them before changing them.

### B. Home loading currently makes the first screen depend on both popular endpoints succeeding

In `src/hooks/useHomeData.tsx`, `loadWave1` awaits `Promise.all([TMDBService.getPopularMovies(...), TMDBService.getPopularTVShows(...)])`. If either request rejects, neither result is committed; `prefetch` sets the error and stops loading. This is a concrete all-or-nothing failure mode that can turn one failed endpoint into an entirely blank Home screen. It does **not** prove this was the only cause of the CI 33 screenshot.

`src/services/TMDBService.ts` also throws an explicit configuration error if `EXPO_PUBLIC_TMDB_API_KEY` is absent, but maps native fetch errors to the generic “Network request failed” message. Inspect the exact CI workflow/environment used to build CI 33 and confirm the TMDB key is available at **bundle/build time**. Never print or commit the secret. Check the HTTP status separately from image CDN failures.

**Required fix:** make Home loading resilient per endpoint: commit whichever popular result succeeds, keep the rest of the screen usable, and surface a retryable diagnostic when both fail. Do not silently label an authentication/configuration error as a bad user connection. Verify the CI workflow passes the existing TMDB key securely; do not add a fake key or commit any secret. Ensure image paths are valid and image loading failures are isolated per poster.

### C. Player has real audio-track state and subtitle infrastructure, but end-to-end behavior is unproven

`src/components/player/PlayerCore.tsx` imports `AudioTrack`, `OnAudioTracksData`, `SelectedTrackType`, `TextTrackType`, `useSubtitles`, `resolveActiveAudioIndex`, and `toAudioTrackOptions`. It stores the native `audioTracks` from the player's `onAudioTracks` callback. The repository also has `src/utils/audioTracks.ts`, `src/hooks/useSubtitles.ts`, `src/components/player/SubtitleOverlay.tsx`, and subtitle parsing/conversion utilities. Their existence does not prove the tracks are attached and selectable correctly on Android.

**Required audit and fix:**
- Trace a stream from resolver output into the final `ReactVideoSource`, including HTTP headers and HLS master-playlist URL preservation.
- Inspect `PlayerCore` props/handlers and `PlayerSettingsDrawer` to confirm the native audio track callback fires, the displayed option index matches the native track index, and selecting Hindi/another language actually updates `selectedAudioTrack` (not only local UI state).
- Do not promise Hindi audio when the selected provider stream has no Hindi track. Show honest track names/languages and a clear single-track state.
- Trace subtitle lookup (including Wyzie/extractor results), subtitle URL download, SRT/VTT conversion, native sidecar attachment/imperative `setSource`, and rendering/selection in `SubtitleOverlay`. Check language code normalization, CORS/headers where relevant, and errors swallowed by catch blocks.
- Add focused unit tests for track-index mapping and subtitle parsing/selection, plus the strongest integration tests the existing architecture supports.
- Run at least one real Android playback check for an asset known to have multiple audio tracks and one known to have subtitles. CI alone cannot prove provider availability or native playback works.

### D. Activation-key duration units are represented as fractional days on the backend

In `functions/src/activateKey.ts`, expiry is computed as:

```ts
now + (key.durationDays ?? config.keyDurationDays) * 86_400_000
```

In `functions/src/manageKeys.ts`, key generation reads `durationDays` as a number and stores it directly. That representation can mathematically support fractional days (e.g. four minutes = 4/1440 day), but the UI/admin generator, Firestore data, client validation, and activation callable must all agree on the unit and permitted minimum. The 30-day success does not establish that the fractional-duration path is correct.

**Required audit and fix:**
- Trace the exact admin form/request payload used to generate a short-duration key, the stored Firestore field and its runtime type, and the client-side activation/expiry validation.
- Search for integer parsing/rounding, `Math.floor`, `parseInt`, truthy fallbacks, min-duration constraints, and milliseconds-vs-days assumptions. Inspect the exact callable response/error that the UI reduces to the generic message.
- Pick one canonical unit at the API boundary (prefer explicit `durationMinutes` or an integer `durationSeconds` for test/short-lived keys; retain day-based compatibility for existing production records). Do not silently reinterpret existing stored `durationDays` values.
- Add emulator/unit tests for 4-minute, 30-minute and 30-day keys; verify expiry timestamps are within a small tolerance, first activation succeeds once, same-installation activation is idempotent, expired keys reject, and errors are mapped to useful non-secret UI messages.
- Do not deploy Functions or Firestore changes from this branch automatically.

## CI / release guardrails

- First run the repository's relevant tests and TypeScript check; then trigger the existing CI workflow on this branch.
- If tests fail, fix the cause and rerun. Record run URL, commit SHA, jobs, and artifact name.
- Never claim physical-device verification from CI. The owner will install the resulting APK and report the real-device results.
- Keep production update checks disabled until the release-policy and APK integrity chain is verified end-to-end. Do not publish a release, deploy Firestore rules, or deploy Functions as part of this audit without explicit approval.
- Do not change branding, navigation, unrelated design, package ID, signing configuration, or unrelated services.
- Do not pull code from the upstream `Flickv4` repository or introduce an upstream APK fallback. Work only in `mir-majid01/StreamZ`.

## Required output from Qoder

1. Implement fixes for the five reported areas, keeping each change small and reviewable.
2. Add regression tests; do not delete/skip existing tests to get green CI.
3. Update this document with **actual files changed**, root causes proven by code/tests, commands/checks run, CI run URL and artifact, and anything still unverified.
4. If any root cause cannot be established, explicitly mark it unresolved rather than claiming it is fixed.
5. Do not merge this branch. Return the diff and CI result for owner review and installation.
