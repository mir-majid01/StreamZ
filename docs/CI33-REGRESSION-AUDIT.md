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

## Fixes applied on `fix/restoration-phase-2`

Tested APK at the time of the owner's report was CI **run 34**, commit `43b2649`.
Everything below was implemented after that build, on this branch, in five commits.

**Checks that actually ran** (all against the final tree, commit `705d8a0`):

| Command | Result |
| --- | --- |
| `npx jest` | 16 suites, **293 passed**, 0 failed |
| `npx firebase-tools emulators:exec --only firestore "npx jest -c jest.emulator.config.js --ci --forceExit"` | 1 suite, **63 passed** |
| `npx tsc --noEmit` | clean except the pre-existing `src/hooks/useWatchNextRecommendation.ts(66,15) TS2322`, which predates this work and was not touched |

This repository has **no lint script**; typecheck plus the two Jest configs above are the whole gate, and CI runs exactly those.

### 1. Home — `41f104e`

**Root cause proven by code, and one premise of the report disproved.** `EXPO_PUBLIC_TMDB_API_KEY` is the only key-shaped secret the workflow supplies, and the key-presence guard (`c33f216`) is already inside run 34. So the screenshot was not an unconfigured build: it was a request that was attempted and failed, reduced by a catch-all to "Network request failed". The all-or-nothing `Promise.all` in `loadWave1` was real and is the reason one dead endpoint blanked the whole screen.

- `src/services/TMDBService.ts` — requests are now classified by layer (`config` / `auth` / `rateLimit` / `http` / `network` / `timeout`), retried only when the failure is transient (15 s first attempt, 6 s retries, two retries), and the API key is redacted from every message. No error message ever contains the request URL, because the URL carries `api_key`.
- `src/services/homeFeedFetch.ts` (new) — movies and TV are fetched and caught independently; one failing section degrades the screen instead of erasing it.
- `src/utils/imageHealth.ts` (new) + `src/components/ContentCard.tsx` — a poster that fails falls back to its title locally, and after 3 failures a single line says artwork did not load. A poster CDN failure is no longer reported as a data failure.
- `src/hooks/useHomeData.tsx`, `src/screens/HomeScreen.tsx` — a named sentence for what failed, and "Try again" only appears when something is actually retryable.
- `__tests__/home-resilience.test.ts` (new, 17 tests) — includes "never puts the request URL in an error message" and "an unclassified throw cannot leak its raw message".

### 2. Live TV — `11d7d2e`

**Finding A confirmed and fixed.** `26eeda6`'s own message said the parser was not wired; `src/services/DaddyLiveService.ts` was still reading only `LIVE_TV_M3U_CONFIG`. The multi-source engine is now the runtime path.

- `src/services/liveTv/channelMapper` (`liveChannelMapper.ts`, new) is shared by the service and the verifier; `DaddyLiveService` resolves the iptv-org and Free-TV catalogues plus the legacy source, merges and dedupes them, and keeps the large catalogue in app files rather than AsyncStorage (Android caps AsyncStorage at ~6 MB). Favourites and recents written as `m3u:` ids are migrated to the new `iptv:` ids, so the merge does not silently empty them.
- 124 merged categories would have produced an unusable chip row, so chips are ranked by channel count and capped at 40 (`rankCategories`).
- Measured twice from `scripts/verify-live-tv-playlists.ts`: **12,510 channels** from the three sources, with per-source and post-dedup counts logged by the service itself at runtime.
- Sampled five stream URLs with ranged GETs. Community playlists contain dead links — one returned `404 text/html`, one reset. That limits the claim to transport reachability, which is all the script asserts.

**Unresolved, reported not hidden:** the language filter is unusable as designed. 0 of 12,510 entries carry `tvg-language`, so filtering by language can only ever return an empty list. Country and category work.

### 3. Activation keys — `7e6ab30`

**Issue 5 narrowed from "short keys fail" to an exact, testable statement.** The rules and the admin app both enforced a **5-minute minimum**, and `durationDays` was an integer 1..3650 — so a 4-minute key could not be minted at all, and a 30-minute key was only ever expressible as `durationDays: 1`, i.e. a full day. `functions/` is unreachable from the app (no `httpsCallable` anywhere in `src/`) and is not deployed; the rules are the backend.

- `firestore.rules` — mint floor is now `durationMs >= 60000` (one minute), with `durationMs` authoritative and `durationDays` its whole-day ceiling. `keyDurationMs()` reads the legacy field for keys that predate `durationMs`, so old keys stay activatable.
- The activation write checks `expiresAt == activatedAt + keyDurationMs(resource.data)` in the database's own units — the client at `src/firebase/subscriptions/api.ts:219` uses the identical fallback, so the two sides cannot disagree.
- `src/utils/subscriptionTerms.ts` (new) + `SettingsScreen` / `SubscriptionScreen` — a term is named in the unit it lasts: "4 min left", "1 h 30 min left", "23 h left", "30 days left". The old label rounded a 90-minute key up to "1 day left", which is the one case a short key exists to show. Expiry shows a clock time when less than about 36 hours remain.
- Tests: 2 new rules cases (mint at the one-minute floor and at four minutes; bind a four-minute key to exactly four minutes; refuse a sub-day key activated as a full day), 2 new client cases, 6 label cases.
- **Admin app** (outside this repository, unversioned — `.bak-subday-keys` backups taken): `MIN_DURATION_MS` lowered to 60 000, the sheet's error text now names the real floor, and `backend/firestore.rules` was stale (old 5-minute floor, no release-policy section) and is now byte-identical to `StreamZ/firestore.rules`.

### 4. Subtitles — `26b268d`

**A premise of the report is wrong, and it matters.** Subtitle lookup does not need the Wyzie secret: `VdrkSubtitleService` is keyless and is searched in parallel. Verified from this machine against the live endpoints — `https://sub.vdrk.site/v1/movie/550` returns HTTP 200 with **43 tracks, all 43 with absolute `cache.vdrk.site` VTT URLs**, and `tv/1396/1/1` returns 200 as well; one returned `.vtt` downloads as valid `WEBVTT`. So "subtitles fail" cannot be blamed on a missing secret.

What was actually broken is the reporting. `fetchSubtitleText` had **no timeout at all**, and both callers swallowed the failure into an empty cue list, so a subtitle that never downloaded looked exactly like a title with no subtitles.

- `src/services/WyzieService.ts` — the cue file now aborts on the same 10 s clock as the search; status, unreachable host, timeout, and "the CDN answered a challenge page instead of cues" are four different messages. The missing-key message names `EXPO_PUBLIC_WYZIE_API_KEY` and says a rebuild is required, because `EXPO_PUBLIC_*` is inlined at build time.
- `src/hooks/useSubtitles.ts` — `cueError`, separate from `error`, plus a distinct message for a file that downloaded but yielded no cues.
- `src/components/player/PlayerCore.tsx` — the native sidecar path, which downloads the file itself, reports into the same drawer line; both render modes can now fail loudly.
- `__tests__/subtitle-fetch-states.test.ts` (new, 8 tests).

**Configuration the owner must set in GitHub Actions (nothing was invented or committed):** `android-ci.yml` writes `.env` from secrets and **omits any that are unset**, so a secret that does not exist produces no error. Currently only `EXPO_PUBLIC_TMDB_API_KEY` is configured. For the Wyzie half of the subtitle picker: `EXPO_PUBLIC_WYZIE_API_KEY` (and optionally `EXPO_PUBLIC_WYZIE_BASE_URL`, which defaults to `https://sub.wyzie.io` in the workflow). For watch party: `EXPO_PUBLIC_WATCH_PARTY_URL` — **and it will still stay hidden**, because `src/config/features.ts` sets `watchParty: false` and the flag deliberately wins over the environment.

**BLOCKED:** rendering of a chosen subtitle track on Android is not verified. It needs the device and, for the Wyzie source, the secret above.

### 5. Audio tracks — `705d8a0`

**Traced end to end, including into the installed native code (react-native-video 6.19.2), and the JS wiring was found correct — not assumed.** `onAudioTracks` populates state; the drawer lists `track.index`; the pick is handed to the player as `{type: SelectedTrackType.INDEX, value}`; and `PlayerScreen` remounts `PlayerCore` per source (`key` at `src/screens/PlayerScreen.tsx:981`), so a selection cannot survive into a stream that never had it. HLS quality is pinned on the **master** URI, which is what keeps demuxed audio groups enumerable at all.

- `src/utils/audioTracks.ts` — labels come only from what the stream named (`title`, then `language`, then a neutral position); nothing is called "English" without evidence.
- The one real gap was the empty case: no tracks reported, and a stream with no separable audio, both rendered as a lone "Default" row. `audioTracksNotice` now distinguishes them and says only what the app was told — it does not claim a muxed track or a language. 3 new tests.

**Named risk, unfixed on purpose.** `PlayerScreen.tsx:398` sets the ExoPlayer MIME hint only when the URL literally contains `.m3u8`; the direct-extractor path at line 531 gets it from `resolved.kind === 'hls'`. That distinction is load-bearing: in the installed library, `Source.kt:235` maps the JS `type` to `overrideExtension`, `ReactExoplayerView.java:1015` calls `Util.inferContentType()` on it, and only `CONTENT_TYPE_HLS` builds an `HlsMediaSource` (line 1092) — anything else gets `ProgressiveMediaSource` (lines 1096-1112) with no content sniffing. An extensionless HLS master from a WebView-scraped server therefore has no hint and may be built as progressive. Fixing it properly means the scraper reporting the response MIME — `ExtractedStream` carries only `videoUrl` and `isWebM` today — which is a change I cannot verify without a device, so it is recorded rather than guessed at.

**BLOCKED:** audible output after selecting a track, and whether the tested streams carry a second audio track at all, are unverified. **No claim is made that a Hindi audio track exists for any title.** For the subtitle source checked, TMDB 550 carries no Hindi, Urdu or Arabic label among its 43 tracks — availability is per title, and this app will not promise a language a stream does not carry.

## Still open after these fixes

- Production update checks remain **disabled**: `FEATURES.updateChecker` is `false` in `src/config/features.ts`. No Firestore rules or Functions were deployed, no release was published, and this branch was not merged.
- `party-server/web/*` and `skills-lock.json` are modified in the working tree by something outside this session (mtimes predate the edits here). They were left untouched and are in no commit.
- The self-granted-expiry hole recorded in the rules notes, and the device-only checks in tasks #22-#24, #28, #29.

## Required output from Qoder

1. Implement fixes for the five reported areas, keeping each change small and reviewable.
2. Add regression tests; do not delete/skip existing tests to get green CI.
3. Update this document with **actual files changed**, root causes proven by code/tests, commands/checks run, CI run URL and artifact, and anything still unverified.
4. If any root cause cannot be established, explicitly mark it unresolved rather than claiming it is fixed.
5. Do not merge this branch. Return the diff and CI result for owner review and installation.
