# StreamZ Phase 1 — Firebase Account, Subscription & Analytics

Status: approved design, awaiting implementation plan
Date: 2026-10-03
Base: Flickv4 `v2.x.x` @ `87cb036`, cloned to `C:\Users\HP\Desktop\StreamZ`
Target platform: Android phones and tablets

---

## 1. What Phase 1 is

Add a Firebase account, subscription-key access gate, device binding, and analytics
layer to the Flickv4 codebase, rebrand the result as StreamZ, and migrate the Android
package to `stream.z`.

Phase 1 is split into two milestones because the access gate must be verifiable on its
own before content work starts:

- **Phase 1A** — package migration, branding, Firebase auth, subscription keys,
  installation binding, gate/navigation, analytics, security rules, cleanup, legal
  screens. Ships with a placeholder content provider so playback and watch analytics
  can be tested end to end.
- **Phase 1B** — Jellyfin content provider: library browse, search, playback
  resolution, subtitles, downloads.

1A and 1B are sequential and independently shippable: 1A must reach its definition of
done before 1B starts. **Each milestone gets its own implementation plan** — 1A alone is
too large for one, and 1B depends on facts the §13 pre-flight has not yet produced.

| # | Decision |
|---|---|
| 1 | Content backend is **Jellyfin**, not Flick's scraper/embed hosts. Monetising or restoring unlicensed stream sources is out of scope for this project. |
| 2 | **You host one Jellyfin server**; all activated users connect to it. |
| 3 | Subscription authority runs in **Cloud Functions** (requires Blaze plan). |
| 4 | App name is **StreamZ**; Android `applicationId` / `namespace` is **`stream.z`**. |
| 5 | Accent colour stays `#E50914`, centralised in `src/config/brand.ts`. Wordmark changes; colour does not. |
| 6 | `watchSessions` are self-reported by the client and therefore **indicative, not billable**. |
| 7 | `DetailScreen`'s TMDB metadata path stays untouched; `MediaItem` is frozen at the seam. |
| 8 | Watch party and Android TV are **deferred, not deleted**. Live TV is **hidden by config**, code retained. |
| 9 | Update-checker row is removed (it currently pushes the upstream author's APK). |
| 10 | GPL author attribution is kept in About. |
| 11 | Keys are stored **hashed only**; plaintext is returned once at generation and never recoverable. |

Amendments added at design review:

| # | Amendment |
|---|---|
| A1 | Do **not** hand a Jellyfin API key to the client. Function holds a server-side credential, calls `AuthenticateByName` on the user's behalf, returns a revocable per-user **session token**. Verify against the actual server version first (§13). |
| A2 | The rollup trigger fires **only** on the `open → finalized` transition. |
| A3 | Add a **scheduled Function** that finalises stale open sessions. |
| A4 | Disable advertising-ID collection in Analytics; mention GA4 in the privacy draft. |
| A5 | Add **Sintel / Blender CC-BY attribution** in About (the 1A sample clip). |
| A6 | Log installation rotations in `devices/{uid__installationId}` and `adminAudit/`, with the rotation ceiling read from `config/app`. |

## 3. Non-goals for Phase 1

No admin panel UI. No device self-service rebind. No cross-device resume sync. No
App Check. No iOS or macOS builds (the owner works on Windows; `ios/` and `macos/` are
left in the tree untouched and unbuilt). No billing or payment integration of any kind.
No new content providers beyond the one interface in §14.

## 4. Legal and policy constraints

**GPL-3.0 plus attribution clause.** Derivatives must stay GPL-3.0, credit *Wendale
Franz Dy* with a link to `https://github.com/sheeshcake/Flickv4`, document changes with
dates, and provide source to anyone the APK is distributed to. Consequences:

- `LICENSE` stays byte-for-byte.
- An author-credit block stays user-visible in About. It is *attribution*, not a
  "Flick Credits" promo, which is what §10 of the branding brief asked for.
- This repository must not be made private or closed-source while the app is distributed.
- `src/services/UpdateService.ts:20` carries an upstream-source URL in a comment. Keep it.

**Google Play.** Digital-content subscriptions must use Play Billing; external key codes
are a policy violation. Phase 1 therefore assumes **sideloaded APK distribution**, like
upstream. If a Play Store release is ever intended, the key system has to be replaced
with Play Billing before that, and the content licensing question reopens.

**Credentials in the inherited CI.** `.github/workflows/build-ios.yml:27-30` contains a
live TMDB API key and a GitHub read token committed by the upstream author. They are not
ours to rotate. Handling: delete the workflow, never use those values, provision a
separate TMDB v4 key owned by us. If the token turns out to be the account's own, revoke
it in GitHub settings.

## 5. STEP 1 implementation map (audit findings)

Verified 2026-10-03 by read-only audit of the clone. These are the integration points.

### Boot and navigation

| Fact | Location |
|---|---|
| Entry registers root only | `index.ts:1-8` |
| Startup side effects (portrait lock, download perms) | `App.tsx:28-35` |
| 13 nested providers, `AppNavigator` at | `App.tsx:38-73`, `:55` |
| Root stack, `initialRouteName="Splash"` | `src/navigation/AppNavigator.tsx:71` |
| Root route list and param map | `AppNavigator.tsx:78-124`, `src/navigation/types.ts:9-42` |
| Phone tab set (Home/Search/Live/Downloads/Settings) | `TabNavigator.tsx:20-26`, Live gated at `:66` |
| Existing gate screen | `src/screens/SplashScreen.tsx` — `regionLoaded` `:127-128`, `Promise.all([...])` `:134-138`, `replace('Main')` `:68` |
| **Deep-link bypass hole** | `src/components/party/PartyLinkHandler.tsx:23-31` resets straight to `Main` |
| No signed-in user concept anywhere | confirmed: no auth/session in providers or storage |
| No `expo-splash-screen` dependency | native splash unmanaged |

### Content, player, history

| Fact | Location |
|---|---|
| TMDB client, 22 methods, singleton | `src/services/TMDBService.ts:37-276`, `:276` |
| Scraper client to delete | `src/services/FlixQuestService.ts:29-33,120-136,184-208,210-215` |
| WebView scraping to delete | `src/components/player/WebViewScraper.tsx:11-14` |
| Streamflix client to delete | `src/services/StreamflixService.ts:56-75` |
| Remote pirate server-list fetch | `src/hooks/useServers.tsx:95-96` |
| Resolver discriminator | `src/services/playbackHeaders.ts:6,8,13,21` |
| Resolution call sites | `PlayerScreen.tsx:443-455,469-554`, `DetailScreen.tsx:334-497`, `DownloadResolverHost.tsx:38-88` |
| **Real plug: `setResolver`** | `src/services/DownloadService.ts:344` (see `:114,353,658-677`) |
| HLS download pipeline (reusable) | `DownloadService.ts:851` → local manifest `:1021` |
| Player is **react-native-video v6**, not expo-video | `package.json:46`, `src/components/player/PlayerCore.tsx:1160-1228` |
| **Watch-session seam (no player rewrite)** | `PlayerCore.tsx:936-941` save, `:943-947` throttle, `:949-959` unmount |
| Continue-watching, local only | `src/hooks/useContinueWatching.tsx:14,16-23,122-168` |
| Frozen internal model | `src/types/index.ts` `MediaItem:27`, `MovieDetails:73`, `Episode:80` |
| Route params carry `MediaItem` | `src/navigation/types.ts:12,29-41` |
| Subtitle merge to replace | `src/hooks/useSubtitles.ts:92-93` (Wyzie + `VdrkSubtitleService.ts:43-91`) |
| Unused CC sample already present | `src/config/env.ts:33-35` (Sintel trailer) |

### Settings, debug UI, branding

| Fact | Location |
|---|---|
| Settings rows, `MenuRow`/`SwitchRow` pattern | `src/screens/SettingsScreen.tsx:91-184`, `196-225`, `227-268` |
| Debug player toggle to remove | `SettingsScreen.tsx:178-184` → `usePlayerDebugSettings` |
| Debug consumers (1B only) | `PlayerScreen.tsx:101,887-940`, `ServerLoadingSideNav.tsx:30` |
| Credits list; entry 7 = GPL attribution | `src/screens/CreditsScreen.tsx:23-65`, attribution `:59-64` |
| False-when-self-hosted disclaimer | `src/screens/DisclaimerScreen.tsx:36-77` |
| Toast / inline-error patterns to reuse | `components/ui/toast/index.tsx`, `JoinPartyScreen.tsx:263-318`, `:307-311` |
| Accent duplication to collapse | `global.css` `--primary`, `AppNavigator.tsx:42-52`, `FlickLogo.tsx` |

### Storage and build

| Fact | Location |
|---|---|
| AsyncStorage used raw in 16 files, flat `flick.*` keys | e.g. `useServers.tsx:20,104` |
| No `expo-secure-store` today | 0 hits in `package.json` / lock |
| Prebuild already run; native dirs committed | `.gitignore:43-45` deliberately commented |
| CI builds native gradle directly | `.github/workflows/build.yml`, Node 20, JDK 17, Gradle 9.3.1 |
| Env read centrally | `src/config/env.ts:16-67`; Expo loads `.env`, no dotenv |
| `.env` already ignored | `.gitignore:35-38` |
| `strict: true`, alias `@ → ./` | `tsconfig.json`, `babel.config.js:8-17` |
| **No lint, no tests, no runner** | no jest/eslint config, no test scripts |

## 6. Package migration: `com.flickv4` → `stream.z`

This is a migration, not a find-and-replace. No `com.flickv4` reference may survive.

**Must change**

- `android/app/build.gradle:118` `namespace`, `:120` `applicationId` → `stream.z`
- `android/app/src/main/java/com/flickv4/MainActivity.kt:1` and `MainApplication.kt:1`
  package declarations, then move both files to `android/app/src/main/java/stream/z/`
- `app.json:42` `android.package` → `stream.z`; `:5` `name` → `StreamZ`; `:6` `slug`
- Deep-link schemes `AndroidManifest.xml:45-46` (`flick`, `com.wfrdee.flick`),
  `app.json` `scheme`, and `src/party/protocol.ts:21` `PARTY_SCHEME` — these move
  together, to `streamz` / `stream.z`
- Launcher label `android/app/src/main/res/values/strings.xml:2`
- Icons `res/mipmap-*/ic_launcher*`, and the easily-missed Android TV banner
  `res/drawable/tv_banner`
- Firebase: `android/app/google-services.json` currently declares `stream.z`, matching
  project `streamz-c98b9`; nothing in the repo references Google Services today

**Must not touch**

- `patches/**` — `postinstall` runs `patch-package`, and the patch bodies contain the
  author's absolute build paths inside hunk context. Editing them breaks `npm ci`.
- `LICENSE`, `README.md` upstream references, and GPL attribution URLs
  (`CreditsScreen.tsx:63`, `UpdateService.ts:20`).
- The ~15 `flick.*` AsyncStorage keys, `flick-downloads`, `flick-update.apk`
  (`DownloadNotifier.ts:35`, `UpdateService.ts:122`), `FlickMacRtc`, and
  `UPDATE_CONFIG` in `env.ts:66-67` — which is being deleted in §16 anyway.
- `ios/`, `macos/` — unbuilt, left alone.

**Verification after migration** (all must pass before any Firebase feature work):
clean Android build (`cd android && ./gradlew clean assembleDebug`), fresh install on the
test device, Firebase initialises, Google Sign-In succeeds, deep links resolve, existing
native modules load (webrtc, background-downloader, notifee), app reaches Home.
`expo run:android` must be used with a **development build**; Expo Go cannot host native
Firebase.

## 7. Architecture: one trust boundary

```
client ──read───▶ users/{uid}                     owner-read, one-field patch allowed
client ──write──▶ watchSessions/{id}              own, open→finalized once, then immutable
client ──call───▶ validateAccess | activateKey | generateKeys | revokeKey
client ──never──▶ subscriptionKeys/**  userDailyStats/**  contentStats/**  adminAudit/**
```

The client is untrusted for every authorization decision (§8–§9, §24 of the brief).
Nothing that grants, extends, or revokes access is decided on-device.

## 8. Firestore data model

### `users/{uid}`
`uid, email, displayName, photoURL, status(active|suspended|disabled), subscriptionId,
installationId, activatedAt, expiresAt, lastLoginAt, lastActiveAt, appVersion, createdAt`

Written only by Functions. `expiresAt` here is a server-pushed mirror, never a client
input. Document is created by `validateAccess` on first call — that is how first login
bootstraps a profile without client write access. `status` defaults to `active`; a
`suspended` or `disabled` value blocks access at the gate.

### `subscriptionKeys/{keyId}`
`keyId, keyHash, status(UNUSED|ACTIVE|EXPIRED|REVOKED), durationDays, createdAt, createdBy,
activatedAt, expiresAt, uid, installationId, lastValidatedAt`

`keyHash = SHA-256(normalizedKey)`, where `normalizedKey` is the trimmed, upper-cased,
`FLK-`-stripped, hyphen-stripped form. Plaintext is never stored. Lookup is an equality
query on `keyHash`, covered by the automatic single-field index.

Consequence of decision 11: `generateKeys` returns plaintext once, at creation. An admin
who loses a key cannot recover it — they revoke and reissue.

### `watchSessions/{sessionId}`
`sessionId, uid, state(open|finalized), contentId, providerId, contentTitle,
contentType(movie|episode|clip|live), tmdbId?, season?, episode?, startedAt, endedAt?,
positionMs, durationMs, watchDurationMs, completionPercentage, completed,
installationId, appVersion`

One document per session. `sessionId` is client-generated as
`{uid}__{startedAtEpochMs}`. Progress updates at most once per 60 seconds from the
`PlayerCore.tsx:943-947` autosave seam. `endedAt`, `completionPercentage` and `completed`
are written by the client at finalize and recomputed authoritatively by the trigger.

Accepted limitation: a client can open more than one `open` session (rules cannot
enforce a per-user singleton without a query). Rollups clamp what they ingest, and
overlapping `startedAt` ranges are detectable in `adminAudit` later. Analytics is
indicative per decision 6.

### `userDailyStats/{uid__yyyyMMdd}` and `contentStats/{contentId}`
Counters maintained with `FieldValue.increment` by the finalize trigger. No client
access. These are what make "most watched content", "total watch time", "active users"
and "session counts" cheap later instead of full-collection scans.

### `devices/{uid__installationId}`
`uid, installationId, firstSeenAt, lastSeenAt, rotations, revokedAt?, platformId?`
Rotation events append here per amendment A6.

### `config/app`
`offlineGraceMinutes` (default `1440` — one day of leeway before a device is forced back
to the server, short enough that a revoked subscription does not enjoy long life
offline), `keyDurationDays` (default `30`, overridable per batch at generation),
`maxInstallationRotations30d` (default `3`), `staleSessionMinutes` (default `10`, the
threshold the scheduled job in §10 finalizes against), `minAppVersion`.
Client-readable, Functions-only write. These are the configurable values the brief asked
for in §13; each starts at the stated default and is tuned from observed data, not
guessed again at implementation time.

### `adminAudit/{id}`
`actorUid, actorRole, action, targetId, metadata, at`
Append-only, written by privileged Functions from day one, so Phase 2 has history.

### Roles
Firebase **custom claims** (`admin | manager | support`), set only by a Function. There
is no client-writable role document. Ordinary authenticated users get no claim at all.

## 9. Security rules

Deny by default. Concretely:

- `users/{uid}` — read if `request.auth.uid == uid`. Update **only** when
  `request.resource.data.diff(resource.data).affectedKeys().hasOnly(['lastActiveAt'])`
  and the uid is unchanged. No create, no delete. A free presence heartbeat that costs no
  Function invocation, and nothing else writable.
- `subscriptionKeys/**` — `match /{all} { allow read, write: if false; }`
- `watchSessions/{id}` — create if `request.auth.uid == resource.data.uid` **and**
  `resource.data.state == 'open'`; update if uid matches **and** `resource.data.state ==
  'open'` (so finalized is immutable) **and** `request.resource.data.state in
  ['open','finalized']` **and** `uid`, `startedAt`, `sessionId` unchanged **and**
  `watchDurationMs` is no greater than elapsed wall time since `startedAt`; delete never.
- `userDailyStats/**`, `contentStats/**`, `adminAudit/**` — no client access.
- `devices/{id}` — read own only; write none.
- `config/app` — read if authenticated; write none.

## 10. Cloud Functions (v2, Node LTS)

- **`validateAccess()`** — the routine call. Confirms auth, creates `users/{uid}` if
  absent, evaluates server-time against `expiresAt`, transitions `ACTIVE → EXPIRED`,
  reconciles `installationId` under the §12 rotation policy, writes `lastValidatedAt`,
  and returns `{ status, expiresAt, jellyfin: { baseUrl, username, sessionToken } }`.
  Called at login, startup, and on resume from background past the §11 interval.
- **`activateKey(key, installationId)`** — normalizes and hashes, then runs **one
  Firestore transaction** across `subscriptionKeys` and `users`, which is what makes
  §9's simultaneous-activation race genuinely atomic. Verifies existence, `UNUSED`,
  expiry, revocation. Binds `uid` + `installationId`, sets `ACTIVE`, `activatedAt`,
  server `expiresAt`. Idempotent for the same `uid`+`installationId` pair so an app
  restart does not error. Provisions or re-enables the per-user Jellyfin account (§13).
- **`generateKeys(count, durationDays)`** — admin claim. Returns plaintext once.
- **`revokeKey(keyId)`** — admin claim. Also the mechanism for §32's revoked-key tests.
- **`setAdminRole(uid, role)`** — admin claim; only writer of custom claims.
- **`onWatchSessionFinalized`** trigger — **fires only on the `open → finalized`
  transition** (A2): guarded by `before.state === 'open' && after.state === 'finalized'`.
  Recomputes `completionPercentage`/`completed`, then writes **only** to
  `userDailyStats` and `contentStats`. It never writes back to `watchSessions`, which
  would re-trigger itself.
- **`finalizeStaleSessions` scheduled** (A3) — every 5 minutes, finalizes any `open`
  session whose `updatedAt` is older than `config/app.staleSessionMinutes`, deriving
  `watchDurationMs` from the last reported `positionMs` and writing the same rollups
  through one shared code path. Needs a composite index on
  `(uid, state, updatedAt)`; recorded in `firestore.indexes.json`.

Scheduled functions and Firestore triggers both require the Blaze plan already implied
by decision 3.

Deferred deliberately: Auth blocking function to hard-disable a Jellyfin account on
suspension, and App Check (see §22).

## 11. Gate and navigation

Uses the existing `SplashScreen` decision point rather than a new mechanism, which is
what prevents protected content flashing.

```
App launch → Firebase init → auth restore
  → validateAccess (with grace fallback)
      unauthenticated            → replace('Login')
      authed, no valid sub       → replace('Subscription')
      authed, valid              → prefetchHome → replace('Main')
```

Work required:

- Register `Login`, `Subscription`, `Account` in `AppNavigator.tsx:78-124` and
  `src/navigation/types.ts`.
- Rework `SplashScreen.tsx:127-138` into the three-way decision. `prefetchHome` moves
  behind the gate; that call is the current mechanism by which content loads pre-Main.
- **Close the deep-link bypass**: `PartyLinkHandler.tsx:23-31` must stop resetting to
  `Main`. It stashes the pending link and replays it only after the gate resolves. With
  watch party deferred the route target is inert, but the fix is what makes the gate
  total rather than decorative.
- Add `SessionProvider` immediately inside `GluestackUIProvider` (`App.tsx:40`) so all 13
  existing providers hydrate unchanged.
- `Login` and `Subscription` are phone-and-tablet only; no TV variants in Phase 1.
- Logout lives in the new `Account` screen, reachable from `SettingsScreen`.

## 12. Installation binding, and the reinstall trap

`installationId` is a UUID generated on first launch and persisted in
`expo-secure-store` — not a hardware identifier (§10 of the brief), and not
`AsyncStorage`, which is plain text.

**The trap:** Android wipes SecureStore on uninstall or storage clear, so a subscriber
who reinstalls gets a new `installationId`. A literal "key is bound to installation"
check locks out a legitimate paying user, and §11 of the brief defers rebind tooling to
Phase 2. Resolution:

- The **Firebase UID is the primary binding.** `installationId` is a rotatable attribute.
- `validateAccess` accepts a new installation for an existing UID and rotates the record
  server-side, appending to `devices/{uid__installationId}` and `adminAudit/` (A6).
- Rotation ceiling from `config/app.maxInstallationRotations30d`, starting at 3 per
  rolling 30 days — enough for a genuine reinstall or a phone upgrade, low enough that
  it cannot be used to launder a key from device to device. Tighten or loosen from
  observed `devices/**` rotation counts, not from argument.
- §9's "already activated on another account" error is unaffected: a second UID is still
  refused regardless of installation.

App restart therefore survives, and the brief's §32 cases hold.

## 13. Jellyfin integration — Phase 1B

**Hard pre-flight gate (amendment A1).** Do not write provider code from memory. First
confirm the actual server version and auth behaviour with a live probe, and record the
answers in this file before implementing:

```
GET  {baseUrl}/System/Info/Public        -> Version
POST {baseUrl}/Users/AuthenticateByName  -> X-Emby-Authorization header, AccessTokenType
GET  {baseUrl}/Users                     -> admin-policy availability
```

Version-sensitive and explicitly to be confirmed: whether `AuthenticateByName` from a
service account can mint a token scoped to a *different* user, the session-token
revocation route, subtitle stream URL format, and `PlaybackInfo`/HLS parameter names.

**Credential model.** Never ship a Jellyfin API key in the APK. Functions hold a
dedicated service-account password as a **Functions secret**
(`functions:secrets:set JELLYFIN_SERVICE_PASSWORD`), call `AuthenticateByName`
server-side, and hand the client a **per-user, revocable session token**. Signing in
re-issues it; the prior token is revoked in the same operation. Revoking a subscription
maps to disabling the Jellyfin user.

**Per-user accounts.** `activateKey` creates or re-enables one Jellyfin user per
Firebase UID via the admin policy API. This gives native per-user resume, Next Up and
favorites, and contains the blast radius of any leaked token to one library account.

**Interface, and why it is a simplification.** Today the discriminator is
`ServerResolver = 'webview'|'streamflix'|'flixquest'` (`playbackHeaders.ts:8`) with
`isFlixQuestServer`/`isStreamflixServer` guards repeated at every call site. Deleting two
of three branches collapses that scatter naturally:

```ts
interface ContentProvider {
  homeRows(): Promise<Row[]>
  search(term: string): Promise<MediaItem[]>
  resolveStream(item: MediaItem, season?: number, episode?: number): Promise<ResolvedStream>
  subtitles(item: MediaItem, source: MediaSource): Promise<SubtitleTrack[]>
}
```

Wired at `PlayerScreen.tsx:469-554` and `:443-455`, `DetailScreen.tsx:334-497`,
`DownloadResolverHost.tsx:38-88`, and `DownloadService.setResolver` (`:344`), which is
already a genuine plug.

**The internal model does not change.** `JellyfinProvider` maps `BaseItemDto →
MediaItem/MovieDetails/Episode` and adds `jellyfinId`. Screens, route params and
downloads keep speaking `src/types/index.ts`. Frozen per decision 7.

**Metadata.** Home rows and search become Jellyfin-backed, so the catalog reflects what
the server actually holds rather than TMDB trending. `TMDBService` and the
`DetailScreen` cast/trailer/artwork path stay untouched where `TmdbId` is present, and
fall back to Jellyfin metadata when it is missing (approved amendment to decision 7).
Artwork prefers Jellyfin `/Items/{id}/Images/Primary`.

**Playback and subtitles.** Direct play when the container suits the device, otherwise
HLS — which `DownloadService.downloadHls` (`:851`) already consumes and rewrites to a
local manifest (`:1021`), so downloads need the URL shape, not new logic. Subtitles move
from the Wyzie/Vdrk merge (`useSubtitles.ts:92-93`) to server subtitle streams; the
existing `SubtitleSettingsProvider` rendering controls are unaffected.

**Known cost:** React Native `<Image>` cannot send headers, so artwork URLs carry the
session token as a query parameter and it can appear in server/proxy logs. Contained by
per-user accounts; flagged as accepted in §22.

**Delete in 1B:** `FlixQuestService.ts`, `WebViewScraper.tsx`, `StreamflixService.ts`,
`VdrkSubtitleService.ts`, the remote list fetch at `useServers.tsx:95-96`, and the debug
consumers at `PlayerScreen.tsx:887-940` / `ServerLoadingSideNav.tsx:30` with
`usePlayerDebugSettings` and its provider at `App.tsx:48`. Sequence matters: in 1A the
debug row is only *hidden*, since those consumers still depend on the provider and
removing it early breaks the build.

## 14. Phase 1A content stand-in

1A needs playable media to verify the gate, the player path, and watch analytics against
reality instead of writing them blind. `SampleContentProvider` implements the same
`ContentProvider` interface over the CC-licensed Sintel trailer already present and
unused at `env.ts:33-35`, exposed as a couple of rows. `FlixQuestService` and
`WebViewScraper` stop being reachable in 1A, so 1A ships no scraper path. 1B replaces
one registration line and deletes the stand-in.

## 15. Analytics

Split so the same event is not built twice:

- **GA4 (ephemeral, no Firestore cost):** `content_open`, `search`, `watchlist_add`,
  `watchlist_remove`, `playback_start`, `playback_pause`, `playback_resume`,
  `playback_stop`, `subscription_activated`, `subscription_failed` (with a reason enum
  excluding key material). App open and session start/end come from GA4 automatically and
  are **not** duplicated.
- **Firestore (durable):** the single `watchSessions` document per session, plus
  rollups. No Firestore write during playback except the ≤60s progress update.

Amendment A4: `setAdvertisingIdCollectionEnabled(false)` at init, and no
`advertisingId`/`GAID` parameter on any custom event. Nothing collected from the brief's
do-not-collect list: no contacts, location, microphone, camera, screen content,
passwords, or auth tokens. The watch-party camera/mic permissions stay declared in
`app.json` only because the deferred feature needs them; they are not requested while
deferred.

Aggregates (`totalWatchTime`, `totalSessions`) are computed by triggers, never
incremented from the client (§18 of the brief).

## 16. Removals and rebrand

Removed: "Check for updates" row and `UpdateService` (targets the author's repo and
prompts installation of his APK — decision 9); the debug-player toggle row
(`SettingsScreen.tsx:178-184`); the Live TV tab via the existing
`LIVE_TV_CONFIG.enabled` flag; watch party via empty
`EXPO_PUBLIC_WATCH_PARTY_URL`; the TV layout via an `isTVLayout` flag; `CreditsScreen`
folded into About as an "Open source & licenses" section, keeping the attribution block
that is `CreditsScreen.tsx:59-64`; `DisclaimerScreen`, replaced rather than reused
because its "we host no content / we are a search engine" claims become false once you
self-host; `build-ios.yml` per §4.

Hidden but retained: TV navigator and `components/tv/**`, party code, Live TV services.

Branding in `src/config/brand.ts`: name, tagline, support contact, accent, radius, type
scale, legal strings. The duplicated `#E50914` in `AppNavigator.tsx:42-52` and
`FlickLogo.tsx` is deleted in favour of the token. New StreamZ wordmark plus adaptive
icon set and `tv_banner` replace Flick's art; colour unchanged per decision 5.

Completion test, per the brief's §9: search the repo for `Flick`, `Flickv4`,
`com.flickv4`, `flickv4`, review every hit, and confirm no user-facing "Flick" survives
while every protected reference from §6 remains.

## 17. About, privacy, and the sample clip

About holds: app name, version, description, developer/organisation line, support
contact, Privacy Policy, open-source licences with GPL-3.0 text and the upstream
attribution block, and the **Sintel attribution** (A5) — *Sintel © Blender Foundation,
CC-BY 3.0* — because it is shipped media in 1A.

Privacy must state what actually happens, per §23: Google sign-in identity, subscription
key state and binding, the installation identifier, in-app activity via Firebase
Analytics (GA4 named explicitly), watch-session records, and the fact that media is
served from a private Jellyfin server whose access token is stored in device secure
storage. No claim of collecting nothing, and no invented legal wording — the copy is
factual description and flagged for the owner's review, not a substitute for legal advice.

## 18. Configuration and secrets

- `.env` is already ignored (`.gitignore:35-38`). Add: release keystore path and
  passwords, `functions/.env`, emulator data dirs.
- `android/app/google-services.json` — committed by design (mobile config values are not
  secrets) **and** the contained API key restricted in Google Cloud console to package
  `stream.z` plus the registered SHA-1 fingerprints.
- Never committed, never in the APK: service-account JSON, Firebase Admin credentials,
  release keystore, Jellyfin service password (Functions secret), admin role grants
  (custom claims).
- `EXPO_PUBLIC_*` additions in `.env.example` with a real example for each; the dead
  `FLIXQUEST` entry and the now-unused update-repo vars are removed from the example so
  nobody configures a code path that no longer exists.

## 19. Build and toolchain

Node 20, Temurin JDK 17, Gradle wrapper 9.3.1, ABIs `armeabi-v7a`/`arm64-v8a` (per CI).
Google Sign-In authenticates against the **signing certificate's SHA-1**, and
`build.gradle:130-146` currently defines only a `debug` config that release also uses —
with the upstream comment at `:143` warning about exactly this. So: generate a real
release keystore, wire `signingConfigs.release` from environment variables, register
debug **and** release SHA-1s in Firebase, and use a development build (`expo run:android`
with a dev client); Expo Go cannot load native Firebase.

Dependencies added, all version-checked 2026-10-03:
`@react-native-firebase/{app,auth,firestore,functions,analytics}` v26.4.0 (peers
`expo>=47`, `react*`, `react-native*`); `@react-native-google-signin/google-signin`
v16.1.5 (`expo>=52.0.40`); `expo-secure-store` 57.0.4 (SDK 57 tag). Dev-only: `jest`,
`jest-expo`, `@firebase/rules-unit-testing`, `firebase-tools`.

## 20. Testing

The repo has no test infrastructure of any kind, and `tsc --noEmit` cannot run before
`npm ci`. Three added layers, no more:

1. **jest + jest-expo, pure logic** — key normalization and hashing, the gate state
   machine, grace-period arithmetic, `BaseItemDto → MediaItem` mapping. Native modules
   mocked at the boundary.
2. **`@firebase/rules-unit-testing` against the Firestore emulator** — this is what turns
   the brief's §32 security section from intent into assertion: client writes to `uid`,
   `expiresAt`, `status`, `installationId` and role must all be rejected; the
   `lastActiveAt`-only patch must be accepted; a write to `subscriptionKeys` must be
   rejected; a finalized session must be immutable.
3. **Functions emulator** — the proof that matters most: two concurrent `activateKey`
   calls against one unused key, exactly one must win. Plus the expiry transition,
   revoked key, wrong-account reuse, and the stale-session scheduled job.

Manual device matrix on the owner's physical Android over adb: the brief's §32 auth and
subscription cases, app restart, backgrounding, offline grace entry and exit, keyboard
not covering the key input (`adjustResize` at `AndroidManifest.xml:32` is assumed and
must be verified, not trusted), back navigation from Login and Subscription, phone and
tablet layouts.

CI: a workflow running `npm ci`, `tsc --noEmit`, jest, and the rules tests. Release APK
build keeps using the existing gradle path with signing from secrets.

## 21. Definitions of done

### Phase 1A
1. Builds and installs; package is `stream.z`; launcher shows StreamZ.
2. Firebase initialises; Google Sign-In works for new and returning users.
3. No content is visible before the gate resolves, including via deep link.
4. Unauthenticated → Login; authenticated without a subscription → Subscription.
5. Valid unused key activates; becomes `ACTIVE`; binds UID and installation.
6. Second UID is refused the same key, including under concurrent activation.
7. Expired and revoked keys block access; the client cannot extend either.
8. Reinstall does not lock out a legitimate user but does respect the rotation ceiling.
9. Offline grace admits, and eventually forces, successful server validation.
10. App restart preserves subscription and local continue-watching position.
11. Watch sessions and GA4 events are recorded against the correct UID.
12. Security rules tests all pass, including the five privilege-escalation attempts.
13. No user-facing Flick branding; §6 "must not touch" references intact.
14. About, privacy draft, GPL text and attribution, Sintel credit all present.
15. No service-account, keystore, or Admin credential inside the APK or the repo.
16. `tsc --noEmit`, jest, rules tests and the device matrix green.

### Phase 1B
17. `ContentProvider` backed by Jellyfin; browse and search reflect the real server
    catalog.
18. Direct-play and HLS playback work; subtitles come from the server; downloads work.
19. Client holds a per-user session token, never an API key; re-issued at login.
20. `FlixQuestService`, `WebViewScraper`, `StreamflixService` and the remote server list
    are gone, with their debug consumers — `PlayerDebugSettingsProvider` is `App.tsx:48`.
21. Revoking a subscription blocks playback, not just navigation.

### Deferred to Phase 2
Admin panel UI, self-service rebind, cross-device resume, App Check, suspension →
Jellyfin disable via auth blocking function, `content_complete` beyond session finalize.

## 22. Known limitations and risks

1. `watchSessions` is client-reported; treat as behaviour, not billing.
2. Client can open multiple concurrent sessions; rollups clamp, overlap is detectable.
3. Artwork URLs carry the session token in the query string (no headers on `<Image>`).
4. Rotation ceiling is a policy number, not device truth; the brief's §10 explicitly
   accepts this in exchange for not using a permanent hardware ID.
5. No App Check in Phase 1 — rules and Functions still hold, but endpoints are
   reachable from outside the real app. Deliberately deferred: enabling it will block
   dev builds until configured, and it must not be debugged at the same time as the gate.
6. Analytics data collected but **no dashboard** — the brief's §19/§25 boundary.
7. Blaze plan required before any Function deploys, and a card on the account.
8. The Firebase project currently has **no OAuth client**, which blocks Google Sign-In
   entirely until §23 is done.
9. Deferred watch party / TV / Live TV code stays compiled but unexercised; upstream
   drift is unmitigated while it sits in the tree.
10. GPL obligations bind any distribution: keep it open, keep attribution, ship source to
    recipients. Not optional, and not satisfiable alongside a closed-source release.

## 23. Firebase console and account setup checklist

Owner actions, required before Phase 1A feature work starts.

1. **Project** `streamz-c98b9` — confirm you own it and it is not shared with other work.
2. **Upgrade to Blaze** (pay-as-you-go). Functions, Firestore triggers and scheduled
   jobs do not deploy on Spark.
3. **Re-download `google-services.json`** after step 4, then place it at
   `android/app/google-services.json`.
4. **Android app registration**: package name exactly `stream.z`.
5. **SHA fingerprints**: add **debug** SHA-1 (`keytool -list -v
   -keystore android/app/debug.keystore -alias androiddebugkey -storepass android`) and
   **release** SHA-1 from the new keystore. This is what populates the currently empty
   `oauth_client` array in your config file.
6. **Authentication → Sign-in method**: enable **Google**. Note the OAuth **Web client
   ID** it creates — the RN Google Sign-In client needs it, not just `google-services.json`.
7. **OAuth consent screen**: external, app name StreamZ, support and developer emails,
   scope `email` + `profile` only.
8. **Firestore**: create in production mode, region nearest your users. Never enable
   test rules.
9. **Functions runtime**: Node LTS; set `JELLYFIN_BASE_URL` and
   `JELLYFIN_SERVICE_PASSWORD` as secrets, not plain env.
10. **Analytics**: enable; confirm no advertising-ID collection after A4 lands.
11. **API key restriction**: in Google Cloud console, restrict the mobile API key to
    `stream.z` and the registered SHA-1s.
12. **Own TMDB v4 key** (the inherited one in `build-ios.yml` is upstream's — see §4).
13. **Jellyfin**: server installed and reachable, version recorded for §13; create the
    dedicated low-privilege service account used only by Functions.
14. **Git remote**: the clone still points at `sheeshcake/Flickv4`. Repoint to your own
    fork before anything is pushed, and keep it public (decision: GPL).

## 24. Open items

No open product questions; every decision in §2 is settled.

One fact must be captured from the live server before Phase 1B is planned, and is
deliberately not guessed here: the Jellyfin version and its actual auth/session-token
behaviour, via the §13 pre-flight probe. All the `config/app` defaults in §8 ship as
stated starting values and are tuned from observed data afterwards.

Owner-side prerequisites in §23 block the start of Phase 1A feature work — chiefly the
Blaze upgrade and the missing OAuth client, since Google Sign-In cannot function until
both exist.
