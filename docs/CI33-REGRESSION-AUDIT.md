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

**Checks that actually ran** (against `705d8a0`, the last commit that touches code — `bfc711e` and this document change only prose):

| Command | Result |
| --- | --- |
| `npx jest` | 16 suites, **293 passed**, 0 failed |
| `npx firebase-tools emulators:exec --only firestore "npx jest -c jest.emulator.config.js --ci --forceExit"` | 1 suite, **63 passed** |
| `npx tsc --noEmit` | clean except the pre-existing `src/hooks/useWatchNextRecommendation.ts(66,15) TS2322`, which predates this work and was not touched |

This repository has **no lint script**; typecheck plus the two Jest configs above are the whole gate, and CI runs exactly those.

Re-run for section 6 (commit `1bcd207` plus the rules clause): `npx jest` — 16 suites, **293 passed**; rules emulator — **65 passed**; `npx tsc --noEmit` — reported here as "0 errors" **through a filter that was itself the flaw.** See section 7.

### CI run 35 — the APK carrying all five fixes

**Run 35, commit `bfc711e`, completed `success`** (https://github.com/mir-majid01/StreamZ/actions/runs/38719940884). Dispatched manually; `android-ci.yml` only auto-runs on `feat/streamz-phase-1a` and `v2.x.x`, so pushing this branch builds nothing by itself.

| Job | Result | Finished |
| --- | --- | --- |
| Tests and typecheck | success | 2026-10-15T10:25:22Z |
| Build APK | success | 2026-10-15T10:52:49Z |

Artifacts: `streamz-release-35` (43,596,494 bytes) and `streamz-release-35-sha256`. The digest published by the run that built the file is

```
36d9dadaf4350aa6f68a38f7783efc9acba221577b7f3f21249d730f3e75ed7e  app-release.apk
```

Both jobs ran every step green, including "Digest the APK this run built" and "Verify the digest file this run produced". **No release was published and no Firestore rules were deployed** — CI only builds and digests; the updater remains off.

**Gap this surfaced, and it is not cosmetic:** the job is named "Tests and typecheck" but typechecks only `functions/` (`.github/workflows/android-ci.yml:173`). There is no app-wide `npx tsc --noEmit` anywhere in CI, and the Expo build strips types without checking them — so the pre-existing `useWatchNextRecommendation.ts(66,15) TS2322` passes CI today. Adding the step would fail the build until that error is fixed, so it was reported first. **Now closed:** the error was real, not cosmetic — a single ternary over the union of the two TMDB response shapes let a `name`-shaped TV row be stamped `media_type: 'movie'`. Stamping inside each branch fixes it, `npx tsc --noEmit` is clean across `src`, `components`, `modules`, `scripts` and `__tests__`, and the step now runs in CI.

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

### 6. Rules: the self-granted-expiry hole (released to production 2026-10-16)

The rules notes recorded a hole left open by the sub-day key work. Verified against the file rather than taken on trust, and it was exactly as described, with one important correction about what it was worth.

`users/{uid}` has two write paths. `update` capped the claimed expiry against the key (`expiresAt <= keyDocAfter(subscriptionId).expiresAt`). `create` asked only `expiresAt > activatedAt` — no cap, and no tie to `request.time` either, since `createdAt` was never compared against the server clock. So the **first** activation on a fresh account was the one entitlement write a modified client could state any term it liked on, and the later cap would never undo it.

**What it was actually worth, measured rather than assumed:** less than it looks, and that is not a reason to leave it. `validate()` returns `Math.min(userExpiry, keyExpiry)`, and the key document is the one write the rules already police to the second (`expiresAt == activatedAt + keyDurationMs`, `activatedAt` pinned within five minutes of `request.time`). So an inflated user document changed nothing on the main path. The exception is `api.ts:161-168`, which trusts `userExpiry` alone when the key document is missing — reachable only after a privileged delete, since `subscriptionKeys` has `allow delete: if false`. A rule cannot be secured by a client remembering to double-check it, and the admin app is a second client of this same document.

- `firestore.rules:121-129` — the create branch now carries the same cap as the update branch. Placed after `boundToMe` so the `getAfter` it reads is known to resolve.
- `__tests__/rules/firestore.rules.test.ts` — `activationFields` took a **day count** and multiplied by `DAY`, while `activate()` writes `activatedAt + durationMs`. The helper's own comment claims it is "the exact shape of the client transaction"; for any sub-day key it was not, which is why nothing noticed the missing cap. It now takes the granted milliseconds, and `activateIn` passes `durationMs`.
- Two new refusal tests (first activation granting 3650 days on a 30-day key; 90-minute key whose user row rounds up to a day) and one new positive assertion at the boundary — a 90-minute activation must be accepted when both documents say the same 90 minutes, so the cap is proven to refuse from above only.

**Proven to catch the hole, not just to pass:** with the clause swapped for `&& true`, the suite reports `2 failed, 63 passed` — the two new refusal tests fail. Restored, it reports `65 passed`. Both new tests read each document before writing it; without those reads the client rejects the transaction on its own precondition and the test passes while proving nothing, which is how the first draft of them behaved.

Checks after this change: `npx tsc --noEmit` — 0 errors in `src|modules|__tests__|components|scripts`; `npx jest` — 16 suites, 293 tests; rules emulator — 65 tests.

**Deployed on the owner's instruction (2026-10-16), after run 38 was green.** `npx firebase-tools deploy --only firestore:rules --project streamz-c98b9` → `cloud.firestore: rules file firestore.rules compiled successfully`, `firestore: released rules firestore.rules to cloud.firestore`, `Deploy complete!`, exit 0. A `--dry-run` against the same project was checked first.

| Item | Value |
| --- | --- |
| Released file | `firestore.rules`, SHA-256 `6ebdbe8714774c6d38e964d6982dd229618c1933c94cf9f7a0a86c79147a1ac2` |
| Equivalence | `git diff 6dfb550 -- firestore.rules` empty — the released bytes are exactly the file the 65-test emulator suite validated, locally and in run 38 |
| Rollback | `C:\Users\HP\firestore.rollback-pre-expiry-cap.rules`, SHA-256 `0ffa296cb0e43f6b871236685eee8eb4fcc9cb8d42d0f8dc7ec83561318a20dc` |
| Rollback fidelity | 21,175 bytes, exported by `git show 1bcd207:firestore.rules`, which `git diff fd55b8e 1bcd207 -- firestore.rules` proves identical to the previously released version — so this is an **exact** capture of what was live, not the lower-bound approximation the earlier rollback file was |
| Clause count check | pre-cap file contains the cap once (update branch); released file contains it twice (create + update) |

**Read back from Google's API, independently of the CLI's own message.** `GET https://firebaserules.googleapis.com/v1/projects/streamz-c98b9/releases` returns release `cloud.firestore` → ruleset `a595be5e-3df9-4bd1-9f55-dd75018e4bd3`, and that ruleset's `createTime` is `2026-10-16T09:18:15.764399Z` — the second this deploy ran. The list also shows the previous release's ruleset, `580a5d53-…` at `2026-10-15T15:30:34Z`, which is the earlier short-key deploy, then `867e0ada-…` (2026-10-12) and `d5e53e19-…` (2026-10-11). So the release pointer moving onto a ruleset created by this deploy is confirmed server-side, not just by `Deploy complete!`.

**What could not be read back, and why it is not a gap in this deploy.** `rulesets.get` does return `source.files[0]`, but the `content` field is a 9-byte stub — and the *same* 9 bytes with the *same* sha256 for the ruleset deployed today and the one deployed the day before. Rule text is not retrievable through this API at all, so no text-level comparison against production is possible from any client. The chain supporting "production now enforces the cap" is therefore: the CLI uploaded `firestore.rules` from a working tree proven byte-identical to `6dfb550`, that file's own SHA-256 is `6ebdbe87…`, and it is the exact content the 65-test emulator suite validated both locally and in CI run 38.

**What this does not prove.** No activation has been attempted against production since the release, and the emulator is the same rules language but not the same service. The argument that this cannot refuse a legitimate activation is read from code, not measured: `activate()` writes one `expiresAt` value to both documents, so the new `<=` is equality on every real path, and the boundary case is asserted in the suite. A legacy 30-day key on an old build behaves the same way. A device activation on run 38's APK is still what would settle it.

### 7. CI run 36 failed, and the reason was the check I added

**Run 36** (commit `1bcd207`, https://github.com/mir-majid01/StreamZ/actions/runs/38860805332) finished **failure**: step `Typecheck the app` failed with 234 `error TS` lines, and `Unit tests`, `Firestore security rules tests` and `Typecheck Cloud Functions` were all skipped behind it. `Build APK` succeeded, because it is a separate job — so run 36 does have an artifact, but it is **not** a run whose verification passed, and it should not be treated as one.

**Root cause, read from the log rather than guessed.** Every one of the 234 errors was in `party-server/web/**`: mostly TS2307 (`Cannot find module 'react-router-dom'`, `'lucide-react'`, `'@/components/...'`), plus TS2322 and TS7006 that are not missing-dependency noise. `party-server/web` is a separate Vite project — its own `package.json`, lockfile, `tsconfig.json`, and its own typecheck gate (`tsc -p tsconfig.app.json --noEmit` in its build script). The **root** `tsconfig.json` declares no `include`/`exclude`, so TypeScript's default of "every TypeScript file under the project root" swept that nested app into the Expo program, under `customConditions: ["react-native"]` and Expo's module resolution. CI installs the app's dependencies and never the web app's, so its imports cannot resolve there.

**The part worth recording about the process.** I added the step in `1bcd207` and reported it green, because locally I ran `npx tsc --noEmit` and grepped for `^(src|modules|__tests__|components|scripts)/`. That filter was chosen to describe the app's sources, and it worked — it also removed all 234 of these errors from view. The new step therefore failed in CI on the first run precisely because CI did not have my filter. Same class of mistake as the `expiryLabel` assertion earlier in this audit, in mirror image: then I asserted something false about the output; here I hid true output.

**Fix at the root cause, not in the command.** `tsconfig.json` now declares `exclude`, naming both nested projects (`party-server`, `functions` — the latter already has its own CI step). Because `exclude` *replaces* rather than extends the list inherited from `expo/tsconfig.base`, the base's own entries (`node_modules`, `babel.config.js`, `metro.config.js`, `jest.config.js`, `android`, `ios`) are repeated so nothing silently widens back.

**Proved to still be checking the app, not just to be quiet.** The verification that matters for a change like this is coverage, because an `exclude` that dropped everything would also report zero errors:

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` (bare, exactly what CI runs) | exit **0**, 0 error lines |
| `npx tsc --noEmit --listFiles` | `src/` 386, `components/` 146, `modules/` 4, `__tests__/` 17, `scripts/` 2 files still in the program |
| same | `functions/` 1 (`functions/src/keys.ts`, still pulled in through `__tests__/phase1a-keys.test.ts`'s import — `exclude` removes ambient inclusion, not imports) |
| same | `party-server/` 0 — excluded as intended |
| `npx jest` | 16 suites, 293 passed |

**No claim is made that `party-server/web` typechecks.** It did not before this change and still does not; its 234 errors are untouched and are its own gate's problem, in a project outside the five reported areas. Nothing there was edited — the working tree already carried changes to it from outside this session, and those remain uncommitted and excluded from every commit here.

### 8. CI run 37 — the verification job is green, the build job failed elsewhere

**Run 37** (commit `a2a0bbf`, https://github.com/mir-majid01/StreamZ/actions/runs/38869928884) split:

| Job | Result | What it proves |
| --- | --- | --- |
| Tests and typecheck | **success** | `Typecheck the app`, `Unit tests`, `Firestore security rules tests` and `Typecheck Cloud Functions` all passed on CI for the first time. Section 7's fix is confirmed, and the rules clause in `6dfb550` passes its own suite against the real emulator in CI, not just locally. |
| Build APK | **failure** | `Assemble release APK` died in Gradle before compiling anything: `Error resolving plugin [id: 'com.facebook.react.settings']` at `android/settings.gradle:21`, caused by `Could not resolve all artifacts for configuration 'classpath'` — `kotlin-stdlib:2.2.21`, `kotlin-gradle-plugin:2.1.20`, `java-diff-utils:4.15`, with `Could not parse POM https://plugins.gradle.org/m2/...`. |

**Assessment of the build failure, with the evidence that supports it.** This is dependency *resolution* against three public repositories, one of them reporting a POM it could not parse — a truncated fetch, not a missing artifact; `kotlin-stdlib:2.2.21` and `java-diff-utils:4.15` both exist upstream. `git diff 1bcd207 a2a0bbf -- android/` is empty, so the Android inputs are byte-identical to run 36, whose `Build APK` succeeded, and neither commit in between touches Gradle, Kotlin versions, or `android/`. Run 35 built the same tree twice as well. **A retry was dispatched (run 38); its outcome is not recorded here because it had not finished when this was written.** If a retry fails at the same coordinates, this assessment is wrong and it is a real pinning/repository problem.

**No APK existed for `a2a0bbf` when run 37 finished.** Run 35's was then the newest build, and it predated one user-visible change: the `useWatchNextRecommendation` fix, where a single ternary over the union of the two similar-response shapes could stamp a TV row with `media_type: 'movie'` — which is what the detail route and the poster URL are chosen from. Run 38, recorded above, supersedes that state.

**Resolved by run 38, on the same commit.** **Run 38** (`a2a0bbf`, https://github.com/mir-majid01/StreamZ/actions/runs/38871937353) completed **success** — every step of both jobs, including `Typecheck the app`, `Unit tests`, `Firestore security rules tests` and `Typecheck Cloud Functions`, then `Assemble release APK`, `Digest the APK this run built` and `Verify the digest file this run produced`. Because run 37 and run 38 built the identical tree and only the second one resolved its dependencies, the transient-fetch reading is now supported by evidence rather than argument, and the kotlin/java-diff-utils coordinates need no code change.

| Run 38 artifact | Value |
| --- | --- |
| `streamz-release-38` | 43,596,487 bytes |
| `streamz-release-38-sha256` | `db192d934eb1b2ebd766760e83771568d61647a4680529cdd06f7ded748d3150  app-release.apk` |

This is the first build that carries the `useWatchNextRecommendation` fix, and the first whose verification job actually typechecked the app. **The rules clause in `6dfb550` is not in this APK** — rules live server-side, and were released after this build (section 6), so an APK from run 38 runs against them without containing them.

### 9. Item 1 re-measured: what Home's failure actually is

The first reading of this was "ISP DNS poisoning", drawn from one comparison. That was overstated, so the host was tested layer by layer instead — resolution, then TCP, then TLS, then HTTP — from this machine on the same Wi-Fi the phone uses, on 2026-10-16. The resolver block, verbatim from the probe:

```
api.themoviedb.org
   getaddrinfo (app path) : 2405:200:1607:2820:41::36, 49.44.79.236
   UDP  to DHCP DNS       : 49.44.79.236
   UDP  to 1.1.1.1        : 13.224.245.63, 13.224.245.92, 13.224.245.44, 13.224.245.47
   DoH  1.1.1.1           : 3.175.86.103, 3.175.86.37, 3.175.86.50, 3.175.86.67
   DoH  8.8.8.8           : unparseable
```

| Layer | Measured |
| --- | --- |
| This network's own answer for `api.themoviedb.org` | `49.44.79.236` / `2405:200:1607:2820:41::36` — an Airtel India address, not TMDB's |
| Public resolvers for the same name | CloudFront ranges: `13.224.245.x` over UDP to 1.1.1.1, `3.175.86.x` via Cloudflare DoH. Google's DoH endpoint returned something the parser could not read. |
| TCP 443 to the network's answer | times out |
| TLS + HTTP to the CloudFront answer, with SNI `api.themoviedb.org` (`curl --resolve`) | **HTTP 401 with TMDB's own body** (`Invalid API key…`) — so TLS, the host, and the API are all healthy when reached at a correct address |
| `image.tmdb.org` | `84.17.38.232` from **both** the network resolver and 1.1.1.1; CNAME `tmdb-image-prod.b-cdn.net` (BunnyCDN); **HTTP 404 from origin** on a bare path. Not substituted. An earlier `http=000` timeout on this host was IPv6-first connection attempts, not a block. |
| Contrast on the same Wi-Fi | `www.google.com` → 200; `firestore.googleapis.com` → works. Not a general outage. |
| Missing/invalid key | ruled out by layer: a key problem is answered by HTTP 401 from the service (reproduced above) and by `missingKeyError` in the client, and Home's failure was a connection that never completed. |

**What this proves, and what it does not.** Proven: on this network path, on this date, the name is answered differently than every public resolver answers it, and the address that is handed out refuses port 443. Not proven, and deliberately not claimed: *who* is doing it. It could be the ISP's filtering, the router's own resolver, a CGNAT middlebox, or the IPv6 resolver `2405:201:…` the host was configured with; nothing probed `49.44.79.236` beyond the failed 443 and a 100 %-loss ICMP; the phone's cellular path was never tested. The wording in the app therefore says the host **can be blocked by your network's DNS** and names `api.themoviedb.org`, rather than accusing an ISP (`fe94e9f`), and it stopped saying "check your connection", which sent people to debug a radio that was fine.

**Resilience, which was already in place and is now covered by tests.** `fetchHomeWave1` awaits the two sections through `loadSection`, each of which catches its own failure and returns `{ items, failure }` ([homeFeedFetch.ts:75-93](file:///C:/Users/HP/Desktop/StreamZ/src/services/homeFeedFetch.ts#L75)); a dead movies endpoint therefore cannot discard fetched TV rows. `wave1IsBlocked` is only true when *both* sections produced nothing, so the blocked screen cannot appear over a populated feed, and `useHomeData` renders the surviving rows plus a `notice` naming the failed layer, with `canRetry` held back when the reason cannot retry itself (no key in the build). `__tests__/home-resilience.test.ts` asserts the one-dead-section case, the per-layer messages, and that no message ever quotes the request URL or the key.

### 10. Item 2: the three Live TV catalogues, measured

Parsed from the three configured playlists, and sampled over HTTPS:

| Source | Entries | `.m3u8` | no extension | `.mpd` | `.m3u` | `.ts` | other progressive |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ph.m3u` (legacy) | 20 | 20 | 0 | 0 | 0 | 0 | 0 |
| iptv-org `index.m3u` | 11,346 | 10,943 (96.45 %) | 274 | 123 | 1 | 4 | 1 |
| Free-TV `playlist.m3u8` | 2,023 | 1,743 (86.16 %) | 250 | 25 | 4 | 0 | 1 |
| **Total** | **13,389** | **12,706** | **524** | **148** | **5** | **4** | **2** |

Reachability of sampled stream URLs — 80 requested (15 / 45 / 20), **53 answered 2xx (66.25 %)**, 27 did not. The sample covered only the two classes the app actually relies on (`.m3u8` and extensionless); the 148 `.mpd`, 5 `.m3u`, 4 `.ts` and 2 other-progressive entries were **not** probed, so nothing here says whether those hosts are reachable.

| Outcome | Count | Note |
| --- | --- | --- |
| 200 | 53 | **One** extensionless sample reported an HLS content type — the single piece of evidence for the "extensionless means HLS" heuristic, which is why `liveSourceType` keeps that default and says so. The probe recorded only whether the type matched HLS; the actual `Content-Type` of the other 52 was not captured, so no claim is made about what those hosts served. |
| timeout | 9 | No response inside the 20 s budget. |
| 403 | 4 | Publisher refused this client. Not proven to be header-related — one sample (below) is the only evidence that any of them wanted a User-Agent. |
| 404 | 4 | Channel gone; the catalogue still lists it. |
| ECONNREFUSED | 4 | Host reachable, port closed. |
| ENOTFOUND | 3 | Host name no longer resolves — the failure mode a shared catalogue drifts into over time. |
| 502 | 1 | Upstream of the publisher. |
| TLS unverifiable | 2 | `UNABLE_TO_VERIFY_LEAF_SIGNATURE` — incomplete certificate chain at the publisher. |
| Required a User-Agent | 1 of 41 sampled iptv-org HLS URLs | The parser already carries `http-user-agent` / `http-referrer` from `#EXTINF` into `stream.headers`, and the player passes them through. |

**What this says about "some channels don't play".** Two thirds of a random sample was reachable from a machine; a third was not, and every failure category above is on the publisher's side of the line. No client change repairs a 404, a closed port, or an incomplete certificate chain, and the app does not claim otherwise. Redirect behaviour was not recorded, and per-player error codes could not have been — the payload was being thrown away, see below.

### 11. Item 2, the two defects that were fixable in code

**a) Every non-`.mpd` URL was declared HLS to the player.** `LivePlayerScreen` built `type: /\.mpd(\?|$)/i.test(url) ? 'mpd' : 'm3u8'`, and react-native-video maps that hint to ExoPlayer's media source with no content sniffing (`Source.kt:235` → `Util.inferContentType()`; only `CONTENT_TYPE_HLS` becomes `HlsMediaSource`). The 6 progressive/raw-container entries above therefore could not be reached by inference and failed as malformed playlists. Now `liveSourceType()` reads only the URL *path* — `.mpd` → `mpd`, `.mp4/.mkv/.webm/.mov/.ts` → no hint at all, everything else → `m3u8` — which also stops a host or query string that happens to contain an extension from choosing the reader ([sourceType.ts](file:///C:/Users/HP/Desktop/StreamZ/src/services/liveTv/sourceType.ts)).

Scoped honestly: this fixes **6 of 13,389** entries. The 148 `.mpd` entries were already typed correctly by the old test, and `.m3u` and extensionless were already answered as HLS. `__tests__/live-tv-source-type.test.ts` has 6 tests; run against the old one-line rule, exactly 1 fails — the progressive-container case — which is the true size of the change, not a claim of 6.

**b) The player's error code was discarded.** `onError={() => setError('This channel failed to play…')}` threw away the payload, so a publisher outage, a host that refuses the app, and a container the device cannot read produced one indistinguishable sentence — which is why the reports that started this arrived as "a channel does not work". `livePlaybackDetail()` now keeps `errorString` + `errorCode` (Android: `ReactExoplayerView.java:1994`, `ExoPlaybackException: <NAME>` / `"2"+code`; iOS: `localizedDescription` / `code`) and shows them under the message in `FONT.mono`. It deliberately never reads `errorException`: that is a Java stack trace, and ExoPlayer's IO failures quote the failing URL in it, tokens included — `__tests__/live-tv-playback-error.test.ts` asserts the absence twice, and the second case is proven to fail if the stack trace is added to the fallback chain.

**Left alone, on purpose:** the same mis-typing exists on the on-demand path — `kindOf()` in `FlixQuestService.ts:138-142` folds DASH into `'hls'`. As of section 12 the *player* no longer inherits that: `playResolvedSource` derives the type from the resolved URL. `kind` still reaches downloads and watch-party as `'hls' | 'file'`, so a `.mpd` link is still filed as a playlist there. Recorded, not patched blind.

**Device verification is blocked.** No Android device was attached when this was written (`adb devices` empty), so neither fix has been observed to change playback. The unit tests prove the branch logic; they do not prove a channel plays.

### 12. The stabilization pass: what the code now does, and what it still cannot prove

Eight items from the owner's directive landed on this branch after section 11. Each is stated with the evidence that made it a code defect rather than a network complaint.

**Live TV failure behaviour (item 2).** The source-type change in section 11a shipped in run 39 and the failures continued, so it was never the cause of what the owner sees. Two modules now stand between the player and the screen:

- `src/services/liveTv/streamProbe.ts` — one bounded (2.5 s) `HEAD`, `GET` only when `HEAD` is refused with 404/405/501, run **only on the retry path**, never on first playback. It reports `answered` / `host-did-not-resolve` / `socket-could-not-open` / `tls-handshake-failed` / `timed-out` / `not-observed`. React Native's `fetch` folds DNS, refused sockets, resets and an offline device into `TypeError: Network request failed`, so a DNS claim is made **only** when a DNS-specific string was actually observed; anything else is `socket-could-not-open` or `not-observed`. The URL is scrubbed out of the detail text because a resolved live URL carries its token.
- `src/services/liveTv/playbackFailure.ts` — maps media3's own constants to nine categories with one sentence each, and `transient` is true for exactly `connection-timeout`, `network-lost-mid-stream`, `stream-expired`. The number table was read with `javap -constants` out of `androidx.media3.common.PlaybackException` from the AAR this build resolves (media3-common 1.11.1), which is why `ERROR_CODE_IO_NETWORK_CONNECTION_FAILED` = 2001 prints as the **22001** in the owner's screenshot. Three names the brief asked for do not exist in that class and are deliberately unmapped rather than invented. Only `^2\d{4}$` is read as media3, because react-native-video also emits bare codes and **3003 collides** with media3's `PARSING_CONTAINER_UNSUPPORTED`.
- Bounded retry: `MAX_AUTOMATIC_LIVE_RETRIES = 2` at 900 ms / 1800 ms, counted as "Retrying (1 of 2)…" and reported on the failure screen as "Tried again on its own N times before stopping here." Two, not more, because ExoPlayer is built with `DefaultLoadErrorHandlingPolicy(source.minLoadRetryCount)` and that default is already **3** — the player re-issued the failing load before JS ever saw the error.
- The retry remounts `<Video>` (`key={channel.id:attemptToken}`). Reading `ReactExoplayerView.java` showed why: `onPlayerError` sets `playerNeedsSource` but calls `initializePlayer()` only for the five DRM codes, and re-passing the same `source` is a no-op because `Source.equals` compares uri/extension/positions/DRM structurally and **not** headers. So a same-URL retry used to reach a player that had gone idle. `onDropViewInstance → cleanUpResources → releasePlayer` is the only reliable reset.
- The failure screen has **Try again** and **Choose another channel**; the layer above it no longer swallows taps (`zIndex` raised over `PlayerControls`), and re-tapping the channel already on screen retunes instead of doing nothing.

**Provider list removed from the user's view, deterministic ranking (items 5 and 6).** `src/utils/sourceRanking.ts` is a pure, deterministic scorer over the metadata each provider really publishes — audio language dominant, then readiness, subtitles, container, then a prior keyed by extractor. The weights are set so the maximum off-language playable score (430) sits below the minimum preferred-language score (460): an undeclared source cannot outvote a declared one by arithmetic, not by hope. Ties break on extractor then id in **code-unit** order, so no device locale can reorder them, and no clock or randomness is read. Nothing is claimed about audio or text tracks that the provider did not state — Vidrock's `subtitles` is `[]`, Videasy states no language at all, and every source is subtitle-unknown before extraction. The `ServerLoadingSideNav` rail still exists but is mounted only when the resolver debug switch is on; provider names left the loading copy, the failure copy and the toasts. `listSources` is now bounded (`withinBudget(…, 30_000)`) because Vidrock issues 1 + N sequential 15 s-capped listing calls, and the recommendation effect can no longer cancel its own in-flight listing on failover bookkeeping — the re-fire cause was `triedServerIds` identity churn feeding back through callback deps.
  The on-demand mis-typing from section 11a is now closed at the player seam: `playResolvedSource` sets `type: onDemandSourceType(resolved.uri)` (URL shape, same rule as live) instead of trusting the extractor's `kind`. `FlixQuestService.kindOf` still folds DASH into `'hls'` — it now only affects the `'hls' | 'file'` consumers, i.e. downloads.

**Activation-key status (item 8).** `src/firebase/subscriptions/keyOutcome.ts` is the single mapping from an observed state to a sentence; the old tables in `errors.ts` and the inline literals in the screens are gone. Each of the four non-`ok` policy/key facts keeps its own wording: a transport failure can never read as "invalid", `permission-denied` reads as "the check could not be completed", and `NOT_FOUND` reads as "not recognised", never "does not exist" — proven by an emulator test that a signed-in read of a never-minted hash fails exactly like a hidden bound key. `EXPIRED` now says which document expired (`expiryOwner: key | account | both | unknown`) because the key and `users/{uid}` expire independently, and it prints a duration only when a real timestamp was read. `SUSPENDED`/`DISABLED` were relabelled from "Key …" to "Account …": `KeyStatus` has no such value and the rules refuse it (`firestore.rules:231`), so the old strings asserted a schema state that does not exist. `bootstrapping` no longer renders "Access Revoked". **No rule was changed** — widening a read to make "not found" truthful would hand every signed-in device a key-existence oracle over the whole keyspace.

**Keyboard (item 4).** Root-caused to a named view and named native code, not guessed: `SearchScreen`'s `InputField` is the only text input on Home → Search → Detail → Player; `ReactEditText` hides the IME only from `clearFocusAndMaybeRefocus()`, and `react-native-screens` overrides `clearFocus()` to do nothing while a screen is `INVISIBLE` and re-requests `lastFocusedChild` in `onStart()`. The fix blurs that field on focus loss and before pushing Detail (`src/utils/fieldFocus.ts`); no prop was added to any input, so `keyboardShouldPersistTaps` / `showSoftInputOnFocus` still behave normally. `LiveTvScreen` carries the same field on the same kind of path (filter → open channel → rotate to landscape) and got the same release. A sweep test now fails if any `.tsx` under `src/` sets `autoFocus`.

**Home header (item 7).** Measured, not styled by taste: the wordmark was pinned in a fixed 88 × 32 box while "StreamZ" at 19 px with the brand's tracking is wider than that, so the logo was being clipped; the search action was a 24 px icon with `p-1` = a **32 dp** target, under the 44 dp floor; the three children sat on three different lines; and an animated `paddingLeft` on the version label whose own comment claimed it matched `pl-2` while the value was `0`. The header is now one 56 dp row from `HEADER` in `src/theme/tokens.ts`, the lockup scales from `transformOrigin: left center` instead of a translate plus padding fake, and the action is a 44 × 44 control with an `accessibilityLabel`. `HeroBanner` opens its scrim at `transparent` at the top edge, so that control carries its own surface — the reason is in the test.

**Launcher icon (item 9).** `src/brand/zMarkGeometry.ts` is now the single source of the Z. The committed launcher art came from `scripts/generate-brand-assets.mjs`, whose comment claimed it drew the same mark as the logo while redrawing a different one (no play head, different ramp) — the icon and the splash were two copies. Both the `StreamZLogo` component and the generator import the geometry module; foreground is the mark centred on its **ink** bounds (the Z leans, so box-centring is off-centre in a round mask) at 60.7 dp diagonal inside the 66 dp safe circle, background is flat `BACKGROUND.base` = `app.json`'s `adaptiveIcon.backgroundColor`, monochrome is the white mark. Five densities × five layers regenerated as webp, plus `.svg` sidecars recording each layer's exact source. No new mark was invented and nothing was cropped.

**Updater (item 1).** Three defects closed beyond section 11b: the update gate now compares **version codes** as well as names (`compareVersionCodes` / `isNewerRelease`, with `installedVersionCode()` read natively and `null` — never `0` — when it cannot be read); `installApk`'s `resultCode` is no longer discarded, so a cancelled install, an accepted one and a system refusal are three different sentences; `downloadApk` retries a failed transfer at most twice with a fresh destination and deletes the partial, refuses a size mismatch when the platform reported a size, and does not retry a user's cancel. `findApkAsset` now requires `.apk`, rejects `debug`, and demands a `release`/`universal`/`app-release` **segment** rather than a substring, returning `null` instead of falling back to "some APK" — the mutation test (`filter(() => true)`) makes two tests fail, which is the proof the guard is load-bearing. The Settings row reads the same `releasePolicy/latest` document the boot gate reads and hands it to the modal: previously it opened the modal with no policy, so the verified in-app install was permanently unavailable there and a second, independent GitHub release lookup answered for the release. `installedReleaseVersion()` is now the one version the gate compares, the modal displays and the row reports. `FEATURES.updateChecker` is still `false`.

**Gates for this pass, run together at the end of it:**

```
node ./node_modules/typescript/bin/tsc --noEmit        → no output, exit 0
node ./node_modules/jest/bin/jest.js                   → 27 suites, 508 tests passed
firebase emulators:exec --only firestore "jest -c jest.emulator.config.js --ci --forceExit"
                                                       → 1 suite, 67 tests passed (baseline 65)
```

No CI workflow was started, triggered, rerun or requested during this pass. Nothing was merged and no release was published.

**What this pass does not prove.** Everything below needs the physical device and is listed as owner work, not as a claim:

- that a classified live failure is *correctly* classified on a real stream — the codes are read from the library's own source, the mapping is unit-tested, but no channel has been played since;
- that the `<Video>` key bump actually re-prepares at the live edge, and how it looks mid-transition;
- the retry cadence (900/1800 ms) against a real flaky CDN, and whether target CDNs answer `HEAD` at all;
- D-pad focus and hit-testing of the two new buttons against `PlayerControls` at z-20 and the drawer at z-50;
- the iOS branch, which carries no media3 names and therefore mostly lands in `unknown` plus whatever the probe saw;
- extensionless on-demand URLs now receive `type: 'm3u8'` where they previously received no hint — measured on the live catalogues, never play-tested for on-demand;
- whether any FlixQuest `.mpd` source plays on Android, now that the player can be handed an honest `mpd`;
- the 30 s listing bound against a genuinely slow provider;
- that the search field is the specific view the owner sees focused — the device was in another app's foreground during this pass, so `mFocusedView` for `stream.z` was never captured;
- every optical header and launcher-icon judgement, and whether the muted version label holds contrast over a bright poster;
- the entire updater, which is disabled and has never been exercised end to end on a device against a published policy.

## Still open after these fixes

- Production update checks remain **disabled**: `FEATURES.updateChecker` is `false` in `src/config/features.ts`. No release was published and this branch was not merged.
- **Deployed after the device test, on the owner's instruction:** `firestore.rules` was released to `streamz-c98b9` (`firestore: released rules firestore.rules to cloud.firestore`). Until that moment the short-key fix existed only in the repository, and activation of a four-minute key was still refused on device — the deployed ruleset predated `12972ca` and demanded `activatedAt + durationDays * 86400000`. Proven locally by running the pre-`12972ca` file against the client's exact write: four-minute grant refused, same key granted as a day accepted, thirty-day accepted. A rollback candidate is saved at `firestore.rollback-candidate.rules` outside the repo, with the caveat that it is a proven lower bound of what was live, not a capture of it — this CLI version has no rules-download command.
- `party-server/web/*` and `skills-lock.json` are modified in the working tree by something outside this session (mtimes predate the edits here). They were left untouched and are in no commit.
- **CI is green on `a2a0bbf` (run 38).** Run 36 failed the new typecheck step (section 7), run 37 passed verification and failed only in Gradle dependency resolution, and run 38 passed every step of both jobs — so the app's own typecheck now gates CI, which it did not before this branch. Newest APK: run 38, digest `db192d934eb1b2ebd766760e83771568d61647a4680529cdd06f7ded748d3150`.
- **`party-server/web` does not typecheck** — 234 errors of its own (missing `react-router-dom` / `lucide-react` types under Expo resolution, plus real type errors). It is now outside the app's gate and still inside its own (`tsc -p tsconfig.app.json` in its build script). Untouched here, and outside the five reported areas.
- `useWatchNextRecommendation` has **no runtime test**. Its defect surfaced as a type error, so the step added in `1bcd207` is the guard; the pick order (prefer a poster, skip the current id, skip coming-soon) is untested, and covering it needs `@testing-library/react-native` added as a devDependency — an owner decision, since it is not currently declared.
- **The self-granted-expiry cap is now live** (`6dfb550`'s ruleset released 2026-10-16, section 6). What remains unproven is not the release but the effect: no activation has been run against production since, and rule text cannot be read back from the API to compare. A device activation on run 38's APK settles it.
- **Home is still empty on this network.** Sections are independent, classified, and retryable (section 9), but none of that fetches TMDB through a resolver that answers `api.themoviedb.org` with an Airtel address. The measured cause is upstream of the app; a VPN or a different DNS answer is the only thing that makes the feed appear, and nothing here proves which component gave the wrong answer.
- **DASH on the on-demand path is fixed only where the player reads it.** `kindOf()` (`src/services/FlixQuestService.ts:138-142`) still folds DASH into `'hls'`, so `DownloadService` would still treat a `.mpd` as a playlist. The player now derives its type from the resolved URL instead (section 12), which is the case that had been reported.
- **Live TV playback after these fixes is unverified.** No device was attached when section 11 was written, and the device that is attached now was in another app's foreground throughout this pass. `liveSourceType`, the classifier, the probe and the retry are proven by unit tests and by reading the library's source; no channel has been played against them. Reachability of the catalogues themselves (section 10) is a publisher-side number no client change moves.
- Subtitles and audio tracks (task #35) stay **blocked**: every on-demand path is unreachable while the API host resolves wrongly, and the device that would show a real track list is not attached.
- The device-only checks in tasks #22-#24, #28, #29.

## Required output from Qoder

1. Implement fixes for the five reported areas, keeping each change small and reviewable.
2. Add regression tests; do not delete/skip existing tests to get green CI.
3. Update this document with **actual files changed**, root causes proven by code/tests, commands/checks run, CI run URL and artifact, and anything still unverified.
4. If any root cause cannot be established, explicitly mark it unresolved rather than claiming it is fixed.
5. Do not merge this branch. Return the diff and CI result for owner review and installation.
