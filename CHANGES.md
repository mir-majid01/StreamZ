# StreamZ — changes from the upstream project

**Upstream:** [Flickv4](https://github.com/sheeshcake/Flickv4) by Wendale Franz Dy, licensed
under GNU GPL-3.0 (with an attribution clause). This project is a derivative work of it and is
distributed under the same licence. The licence text is unchanged and lives in [`LICENSE`](LICENSE).

This file exists to satisfy the GPL's requirement to **state your changes** and to carry the
attribution obligation. Dates below are the date the change was made in this repository.

---

## 2026-10-03 → 2026-10-05 — StreamZ Phase 1A

### Rebrand and distribution identity
- Renamed the app from Flick to **StreamZ** throughout user-visible surfaces: `app.json`
  name/slug, `android/app/src/main/res/values/strings.xml` `app_name`, the header wordmark,
  the splash ident, the disclaimer, permission prompts, share text and support copy.
- Changed the Android `applicationId` and Gradle `namespace` from the upstream package to
  **`stream.z`**, moved the Kotlin sources accordingly, and changed the deep-link scheme to
  **`streamz`** (party invites now build links from that constant instead of a hardcoded
  `flick://`, which no longer resolved).
- Support contacts (email and Telegram) are read from a single `src/config/brand.ts`; the
  accent colour is likewise defined once and referenced, not repeated as literals.
- Deferred surfaces are hidden by feature flags in `src/config/features.ts`, not deleted:
  Live TV, watch party, the Android TV shell, and the in-app update checker.

### Firebase account, subscription and analytics layer (new)
- Added Google Sign-In and a Firebase session; the app will not enter its library until a
  device is signed in **and** holds an active subscription.
- Added a subscription-key system: keys are 20 characters (four groups of five, no confusable
  `0/O/1/I/L`), stored **only** as a lowercase-hex SHA-256 of the exact plaintext, and the key's
  document id is that hash so a device can address only the key it already knows.
- Added activation (one key binds to one Firebase account, with a bounded installation
  rotation), an access gate with offline grace, and a blocked screen that distinguishes
  "your subscription ended" from "this app could not reach the server".
- Added analytics that the account owner can act on: per-title watch sessions that open and
  finalize, daily per-user totals, a presence heartbeat, and a small set of Firebase
  Analytics events. **The advertising identifier is explicitly denied.**
- Added `firestore.rules` and `firestore.indexes.json`. Security rules are the enforcement
  layer: the project runs on the free Spark plan, so there are **no Cloud Functions** and the
  rules decide what any client — including the admin console — is permitted to write. Raw
  Firebase errors are never surfaced to a user.

### Administrative console (separate application)
- `stream.z.admin` ("StreamZ Admin") is a companion Android app in the same Firebase project
  that mints, revokes, expires and rebinds keys, suspends accounts, resets device bindings
  and reads analytics. Its access is gated by a `role` custom claim that can only be set from
  the Firebase console, so no client can grant itself privileges.

### Security fixes found while auditing the inherited code
- The startup path pre-fetched catalogue data and could be redirected past the access gate by
  a party deep link before the gate had decided; both now run only after the gate grants entry.
- The in-app updater polls **upstream's** GitHub releases and hands the found APK directly to
  the package installer. Left enabled, it would offer a StreamZ user somebody else's build, so
  it is disabled at the configuration layer and at each of its three call sites until it is
  pointed at this project's own releases.

### Removals and hidden developer UI
- Removed the "Debug video player" switch from Settings: it renders the stream-finder webpage
  in place of the player and is a developer affordance, not an end-user setting.
- Hid Live TV, watch-party and update-checker entry points behind the flags above. No
  feature code was deleted, so each can be restored by flipping its flag.

### Testing and build
- Added a Jest harness (`jest.config.js` for device-side logic, `jest.emulator.config.js` for
  rules), a fixture of canonical key vectors shared by the client, the admin app and the
  dormant functions project, and a GitHub Actions workflow that runs the unit suite, the
  Firestore emulator rules suite, a Functions typecheck, and an Android debug build.
- Reduced the Gradle JVM heap and disabled the daemon/parallel workers so the Android build
  fits on low-memory development machines; heavy builds are delegated to CI.

### Legal and attribution
- `LICENSE` is unchanged. The original developer is credited in **Settings → About**, naming
  Wendale Franz Dy, the upstream repository and GPL-3.0.
- The bundled sample clip is **Sintel (c) Blender Foundation, CC-BY 3.0**, credited in About.
- `patches/**` is untouched; `flick.*` local-storage keys are deliberately preserved so
  existing installs keep their Continue-Watching list, server choices and preferences.

### What was deliberately **not** changed
- The content backend: no new scrapers, resolvers, hosts or content sources were added, and
  none were improved, repaired or debugged. The inherited streaming path is out of scope for
  this work and is left exactly as it was found.
- No DRM, authentication or paywall bypass; no torrent or download-of-protected-content
  functionality; no mechanism intended to evade copyright enforcement.

---

## Source availability

Anyone who receives a StreamZ APK receives the corresponding complete corresponding source,
including this file and the build instructions in [`README.md`](README.md). The source is
maintained at <https://github.com/editsu4k-coder/StreamZ>.

## How to rebuild this derivative

```bash
npm ci
npm test                                   # device-side logic
npx firebase-tools emulators:exec --only firestore \
  "npx jest -c jest.emulator.config.js --ci --forceExit"   # security rules
cd android && ./gradlew assembleDebug    # APK: android/app/build/outputs/apk/debug/
```

Requirements: Node 20+, JDK 17+ (Android Studio's embedded JBR works), Android SDK 36, and a
`google-services.json` for your own Firebase project in `android/app/`.
