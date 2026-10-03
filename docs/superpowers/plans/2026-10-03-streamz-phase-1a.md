# StreamZ Phase 1A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Firebase account, subscription-key access gate, installation binding and analytics layer to the Flickv4 codebase, rebrand it as StreamZ, and migrate the Android package to `stream.z`, with playback driven by a placeholder content provider.

**Architecture:** One trust boundary — the client may read and append about itself and nothing else. All authorization decisions (activation, expiry, revocation, device rotation) run in Cloud Functions against Firestore; Firestore rules deny every privileged write. A pure gate reducer in the client decides which of Login / Subscription / Main renders, using the existing `SplashScreen` decision point.

**Tech Stack:** Expo SDK 57, React Native 0.86, React 19, TypeScript (strict), React Navigation 7, gluestack-ui v5 + NativeWind v5, `@react-native-firebase/*` v26.4.0, `@react-native-google-signin/google-signin` v16.1.5, `expo-secure-store` 57.0.4, Cloud Functions v2 (Node LTS), Firestore, jest + jest-expo, `@firebase/rules-unit-testing`, Firebase emulator suite.

**Spec:** `docs/superpowers/specs/2026-10-03-streamz-phase1-design.md` — read it alongside this plan. Section references (§N) below point into that spec.

---

## Global Constraints

Every task's requirements implicitly include this section.

- Platform: **Android phones and tablets only.** No iOS/macOS builds; leave `ios/` and `macos/` untouched.
- Android `applicationId` and `namespace`: **`stream.z`** exactly (matches `google-services.json` for project `streamz-c98b9`).
- Display name: **StreamZ**. Accent stays **`#E50914`**, frozen, referenced only from `src/config/brand.ts` and `global.css`.
- Support contacts: email **`Mirmajid@proton.me`**, Telegram **`@Mirmajid01`** / `https://t.me/Mirmajid01`. Both live only in `src/config/brand.ts`, so they change in one place.
- Distribution: **sideloaded APK only.** No Play Store work, no Play Billing.
- The mobile client is **untrusted** for every authorization decision. No admin, service-account or keystore credential may ever reach the APK or the repo.
- Never store a plaintext subscription key. Hash SHA-256 over a versioned prefix; only `keyHash` persists.
- No permanent hardware identifier. Binding uses a UUID `installationId` in `expo-secure-store`; the **Firebase UID is the primary binding**.
- GPL-3.0 is non-negotiable: `LICENSE` unchanged, author credit for **Wendale Franz Dy** with a link to `https://github.com/sheeshcake/Flickv4` visible in About, repo stays public while the APK is distributed.
- **Do not edit:** `patches/**` (breaks `patch-package` at `postinstall`), `LICENSE`, `README.md` upstream references, `CreditsScreen.tsx:59-64` attribution data, `UpdateService.ts:20` source comment, the ~15 `flick.*` AsyncStorage keys, `flick-downloads`, `flick-update.apk`, `FlickMacRtc`.
- Live TV, watch party and Android TV are **hidden by flag, not deleted** (§2).
- Import alias `@/…` maps to repo root (`tsconfig.json` paths, `babel.config.js:8-17`). Use `@/src/config/brand`.
- **Expo has changed** (AGENTS.md). Before any Expo config-plugin, prebuild or native-project step, read the v57 docs at `https://docs.expo.dev/versions/v57.0.0/` and follow them over this plan if they differ.
- Native Firebase needs a **development build**; Expo Go cannot run it.
- Windows host, Git Bash. adb is not on PATH: `A=/c/Users/HP/AppData/Local/Android/Sdk/platform-tools/adb`. Test device is a physical Infinix X6876.
- Before every commit: `npx tsc --noEmit` and `npm test` green, relative to the Task 1 baseline.

---

## File Structure

```
jest.config.js                                   T2
__tests__/smoke.test.ts                          T2
src/config/brand.ts                              T3   brand tokens, support contacts, legal strings
src/config/features.ts                           T3   liveTv / watchParty / tvLayout / updateChecker
src/firebase/models.ts                           T5   shared document + result types
fixtures/keyNormalization.json                   T5   vectors read by both runtimes
src/firebase/subscriptions/keyFormat.ts          T6   client display + plausibility pre-check
src/firebase/installation/installationId.ts      T6   UUID in secure-store
src/firebase/subscriptions/gate.ts               T7   pure gate decision + revalidation timing
src/firebase/errors.ts                           T8   SDK codes -> user-facing copy
src/firebase/init.ts                             T9   RNFirebase bootstrap, advertising id off
src/firebase/auth/googleAuth.ts                 T13   Google Sign-In -> Firebase credential
src/firebase/auth/SessionProvider.tsx           T13   auth state + gate orchestration
src/firebase/subscriptions/api.ts               T14   callable wrappers + local cache
src/firebase/analytics/appEvents.ts             T18   GA4 event wrappers
src/firebase/analytics/watchSession.ts          T19   session recorder, batched
src/services/content/types.ts                   T20   ContentProvider interface
src/services/content/SampleContentProvider.ts   T20   Sintel stand-in
src/services/content/useContentProvider.ts      T20   provider registration
src/screens/LoginScreen.tsx                     T15
src/screens/SubscriptionScreen.tsx              T16
src/screens/AccountScreen.tsx                   T17
src/screens/AboutScreen.tsx                     T21
android/app/google-services.json                T10
firestore.rules  firestore.indexes.json         T11
firebase.json                                   T11
functions/package.json  functions/tsconfig.json T11
functions/src/index.ts  admin.ts  keys.ts       T11
functions/src/validateAccess.ts                 T12
functions/src/activateKey.ts                    T13b
functions/src/manageKeys.ts                     T14b  generate / revoke / setAdminRole
functions/src/rollups.ts                        T15b  trigger + scheduled finalizer
functions/src/jellyfin.ts                       T16b  session token mint / revoke
__tests__/rules/*.test.ts                       T11-T12
__tests__/functions/*.test.ts                   T12-T16b
.github/workflows/ci.yml                        T22
```

**Modified in place:** `App.tsx`, `app.json`, `android/build.gradle`, `android/app/build.gradle`, `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/java/com/flickv4/{MainActivity,MainApplication}.kt` → `java/stream/z/`, `res/values/strings.xml`, `src/navigation/{AppNavigator.tsx,types.ts}`, `src/screens/SplashScreen.tsx`, `src/components/party/PartyLinkHandler.tsx`, `src/party/protocol.ts`, `src/screens/SettingsScreen.tsx`, `src/screens/{CreditsScreen,DisclaimerScreen}.tsx`, `src/components/player/PlayerCore.tsx`, `src/hooks/{useSubtitles,useServers}.tsx`, `src/services/playbackHeaders.ts`, `src/config/env.ts`, `global.css`, `package.json`, `.gitignore`, `.env.example`.

**Deleted:** `.github/workflows/build-ios.yml`, `src/services/UpdateService.ts`, `src/components/UpdateChecker.tsx`.

**Deferred to Phase 1B — do not start here:** `JellyfinProvider`, and deletion of `FlixQuestService.ts`, `WebViewScraper.tsx`, `StreamflixService.ts`, `VdrkSubtitleService.ts`, `usePlayerDebugSettings`.

---

## Stage 0 — Guardrails first

### Task 1: Establish a runnable baseline

**Files:** none created.

**Interfaces:**
- Produces: a verified-green starting point, plus the debug keystore SHA-1 recorded for Task 10.

- [ ] **Step 1: Install.** `npm ci`. Expected: completes with `patch-package` applying without error. If a patch fails, stop and report — never edit `patches/` to make it pass.
- [ ] **Step 2: Record the typecheck baseline.** `npx tsc --noEmit 2>&1 | tail -40`. Any pre-existing errors go into your report verbatim; every later "tsc clean" claim is relative to this list, not to zero.
- [ ] **Step 3: Verify toolchain.** `java -version` (expect 17.x), `node -v`, `npx expo --version`. Missing Java blocks the emulator suite in Task 11 — report it now, not in Task 11.
- [ ] **Step 4: Build and launch the untouched app.** `cd android && ./gradlew assembleDebug 2>&1 | tail -25`, then `$A install -r app/build/outputs/apk/debug/app-debug.apk`, then `$A shell monkey -p com.flickv4 -c android.intent.category.LAUNCHER 1`. Expected: launches to Splash → Home. This is the control experiment; nothing after this may break it.
- [ ] **Step 5: Read debug SHA-1.** `keytool -list -v -keystore android/app/debug.keystore -alias androiddebugkey -storepass android 2>&1 | grep -i SHA1`. Task 10 needs this in the Firebase console.
- [ ] **Step 6: Commit nothing.** This task produces no file changes.

### Task 2: Test harness

**Files:**
- Create: `jest.config.js`, `__tests__/smoke.test.ts`
- Modify: `package.json` (scripts + devDependencies)

**Interfaces:**
- Produces: `npm test` runs jest over `__tests__/**/*.test.ts`. Later tasks assume that location and `@/` imports.

- [ ] **Step 1: Create `jest.config.js`:**

```js
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@notifee/react-native|@react-native-firebase/.*|nativewind|react-native-css)/)',
  ],
};
```

- [ ] **Step 2: Create `__tests__/smoke.test.ts`:**

```ts
describe('harness', () => {
  it('runs and resolves the @ alias', () => {
    expect(1 + 1).toBe(2);
    expect(typeof require('@/src/config/brand')).toBe('object');
  });
});
```

- [ ] **Step 3: Add scripts:** `"test": "jest"`, `"test:watch": "jest --watch"`, `"typecheck": "tsc --noEmit"`.
- [ ] **Step 4: Install:** `npm i -D jest@^29 jest-expo@~57.0.0 @types/jest@^29`.
- [ ] **Step 5: Run `npx jest`.** Expected: FAIL on the missing `@/src/config/brand`. That failure is the proof alias resolution works. Do not stub `brand.ts` — Task 3 creates it. Commit with the known failure recorded in the report; the suite goes green at Task 3 Step 5.
- [ ] **Step 6: Commit** `chore: add jest test harness`.

### Task 3: Brand config and feature flags

**Files:**
- Create: `src/config/brand.ts`, `src/config/features.ts`
- Test: `__tests__/config/brand.test.ts`

**Interfaces:**
- Produces:
  - `BRAND = { name, tagline, supportEmail, supportTelegram, supportTelegramUrl, accentHex, scheme, applicationId }`
  - `LEGAL = { upstreamName, upstreamAuthor, upstreamUrl, license, sampleTitle, sampleCredit, sampleUrl }`
  - `FEATURES = { liveTv, watchParty, tvLayout, updateChecker }` — all four `false` in Phase 1A.

- [ ] **Step 1: Write the failing test.**

```ts
import { BRAND } from '@/src/config/brand';
import { FEATURES } from '@/src/config/features';

it('is the single source for identity and support', () => {
  expect(BRAND.name).toBe('StreamZ');
  expect(BRAND.supportEmail).toBe('Mirmajid@proton.me');
  expect(BRAND.supportTelegram).toBe('@Mirmajid01');
  expect(BRAND.applicationId).toBe('stream.z');
  expect(BRAND.accentHex).toBe('#E50914');
});

it('disables deferred features in Phase 1A', () => {
  expect(FEATURES).toEqual({ liveTv: false, watchParty: false, tvLayout: false, updateChecker: false });
});
```

- [ ] **Step 2: Run `npx jest __tests__/config` → FAIL, module not found.**
- [ ] **Step 3: Create `src/config/brand.ts`.**

```ts
export const BRAND = {
  name: 'StreamZ',
  tagline: 'Your private streaming library',
  supportEmail: 'Mirmajid@proton.me',
  supportTelegram: '@Mirmajid01',
  supportTelegramUrl: 'https://t.me/Mirmajid01',
  accentHex: '#E50914',
  scheme: 'streamz',
  applicationId: 'stream.z',
} as const;

export const LEGAL = {
  upstreamName: 'Flickv4',
  upstreamAuthor: 'Wendale Franz Dy',
  upstreamUrl: 'https://github.com/sheeshcake/Flickv4',
  license: 'GNU GPL-3.0 (see LICENSE)',
  sampleTitle: 'Sintel',
  sampleCredit: 'Sintel (c) Blender Foundation, CC-BY 3.0',
  sampleUrl: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
} as const;
```

- [ ] **Step 4: Create `src/config/features.ts`:**

```ts
// Spec §2/§16: deferred, hidden by flag, code retained for later phases.
export const FEATURES = {
  liveTv: false,
  watchParty: false,
  tvLayout: false,
  updateChecker: false,
} as const;
```

- [ ] **Step 5: Run `npm test`.** Expected: PASS, including Task 2's alias test.
- [ ] **Step 6: Commit** `feat: add StreamZ brand config and Phase 1A feature flags`.

---

## Stage 1 — Package migration (must land before Firebase)

### Task 4: Migrate `com.flickv4` → `stream.z`

**Files:**
- Modify: `android/app/build.gradle:118,120`; `app.json` (`name`, `slug`, `scheme`, `android.package`); `android/app/src/main/AndroidManifest.xml:45,46`; `src/party/protocol.ts:21`
- Move: `android/app/src/main/java/com/flickv4/{MainActivity,MainApplication}.kt` → `android/app/src/main/java/stream/z/`

**Interfaces:**
- Consumes: `BRAND.applicationId`, `BRAND.scheme`.
- Produces: an APK with `applicationId == 'stream.z'`. Task 10 cannot start until this holds — the Google Services plugin validates `package_name` against `applicationId` and fails the build otherwise.

- [ ] **Step 1: Map before editing.** `grep -rn "com\.flickv4" --include=*.kt --include=*.gradle --include=*.xml --include=*.json .` Expected: exactly `build.gradle:118`, `:120`, and the two `.kt` package lines. Any additional hit joins this task.
- [ ] **Step 2: Move sources.**

```bash
cd android/app/src/main/java && mkdir -p stream/z \
  && git mv com/flickv4/MainActivity.kt stream/z/MainActivity.kt \
  && git mv com/flickv4/MainApplication.kt stream/z/MainApplication.kt \
  && rmdir com/flickv4 com 2>/dev/null; cd /c/Users/HP/Desktop/StreamZ
```

Change line 1 of both files to `package stream.z`. Leave every other line byte-identical.
- [ ] **Step 3: Gradle.** `:118` → `namespace 'stream.z'`; `:120` → `applicationId 'stream.z'`. Do not touch `:145` signing in this task.
- [ ] **Step 4: Expo config.** `android.package` → `stream.z`, `name` → `StreamZ`, `slug` → `streamz`, `scheme` → `streamz`. Per AGENTS.md, confirm against the v57 docs whether `slug`/`scheme` changes affect asset or bundle paths before committing.
- [ ] **Step 5: Schemes move together.** `AndroidManifest.xml:45` → `android:scheme="streamz"`, `:46` → `android:scheme="stream.z"`, `protocol.ts:21` `PARTY_SCHEME` → `'streamz'`. All three in one commit, or deep links silently die.
- [ ] **Step 6: Clean build.** `cd android && ./gradlew clean assembleDebug 2>&1 | tail -30`. Expected: BUILD SUCCESSFUL. A missing class under `com.flickv4` means Step 1 missed a reference — find it, do not add a shim.
- [ ] **Step 7: Reinstall.** A different `applicationId` is a different app, so clear the old one first: `$A uninstall com.flickv4 || true`, install, then `$A shell monkey -p stream.z -c android.intent.category.LAUNCHER 1`. Expected: reaches Home exactly as Task 1 Step 4 did.
- [ ] **Step 8: Verify objectively.** `$A shell dumpsys window | grep -i mCurrentFocus` → `stream.z/stream.z.MainActivity`. Then `$A shell "am start -a android.intent.action.VIEW -d 'streamz://party/TEST123'"` → app opens without crashing (the join itself will fail; *reaching the app* is the assertion).
- [ ] **Step 9: Commit** `refactor: migrate android package from com.flickv4 to stream.z`, listing every file and both moves.

### Task 5: Domain models, shared key vectors, launcher label

**Files:**
- Create: `src/firebase/models.ts`, `fixtures/keyNormalization.json`
- Modify: `android/app/src/main/res/values/strings.xml:2`
- Test: `__tests__/models/models.test.ts`

**Interfaces:**
- Produces, exact names every later task imports:
  - `UserStatus = 'active' | 'suspended' | 'disabled'`
  - `KeyStatus = 'UNUSED' | 'ACTIVE' | 'EXPIRED' | 'REVOKED'`
  - `SessionState = 'open' | 'finalized'`
  - `AccessStatus = 'authorized' | 'needsKey' | 'expired' | 'revoked' | 'suspended' | 'disabled' | 'installationCeiling'`
  - `AccessResult = { status: AccessStatus; expiresAt: number | null; serverTimeMs: number }`
  - `ActivateCode = 'ACTIVATED' | 'ALREADY_OWNED' | 'NOT_FOUND' | 'EXPIRED' | 'REVOKED' | 'ALREADY_BOUND' | 'CEILING' | 'UNAUTHENTICATED'`
  - `ActivateResult = { code: ActivateCode; expiresAt: number | null }`
  - `GateDecision = 'bootstrapping' | 'signedOut' | 'needsSubscription' | 'ready' | 'offlineCached' | 'needsServerContact' | 'blocked'`
  - `JellyfinCredential = { baseUrl: string; username: string; sessionToken: string }`
  - `ValidatedAccess = AccessResult & { jellyfin?: JellyfinCredential }` — `validateAccess` returns this, so the Jellyfin credential is an optional addition to the verdict rather than a second shape the client must branch on.
  - `UserDoc`, `SubscriptionKeyDoc`, `WatchSessionDoc`, `DeviceDoc`, `AppConfigDoc` — field-for-field from spec §8.
  - `fixtures/keyNormalization.json = { valid: [{ raw, normalized }], invalid: [{ raw, reason }] }`

The fixture is read by the jest suite (Task 6) *and* the Functions suite (Task 13), which proves both normalizers agree without sharing source across runtimes.

- [ ] **Step 1: Label only.** `strings.xml:2` → `<string name="app_name">StreamZ</string>`. Icons wait for Task 17; the label makes every subsequent device check readable.
- [ ] **Step 2: Write the failing test.**

```ts
import type { AccessResult, UserDoc } from '@/src/firebase/models';

const doc: UserDoc = {
  uid: 'u1', email: 'a@b.c', displayName: 'A', photoURL: null, status: 'active',
  subscriptionId: null, installationId: null, activatedAt: null, expiresAt: null,
  lastLoginAt: 1, lastActiveAt: 1, appVersion: '1.0.0', createdAt: 1,
};
const ok: AccessResult = { status: 'authorized', expiresAt: 2, serverTimeMs: 1 };

it('models carry the spec field shapes', () => {
  expect(doc.uid).toBe('u1');
  expect(ok.status).toBe('authorized');
});
```

- [ ] **Step 3: Run it → FAIL, module not found.**
- [ ] **Step 4: Write `src/firebase/models.ts`** with every type above. Timestamps are epoch **milliseconds** (`number`), not Firestore `Timestamp`, so shared types need no SDK import and client and Functions agree. State that in one comment line.
- [ ] **Step 5: Create `fixtures/keyNormalization.json`.** Valid: `flk-7h3k-92pq-x8lm` → `7H3K92PQX8LM`; spaced lowercase; trailing whitespace. Invalid, each with `reason`: 11-char body; 13-char body; body containing `I`, `L`, `O` or `U` (Crockford base32 excludes them); empty string; `';DROP--` injection; 400 `A`s.
- [ ] **Step 6: Run `npm test` → PASS.**
- [ ] **Step 7: Commit** `feat: add streamz domain models, key vectors, StreamZ label`.

---

## Stage 2 — Pure client logic

### Task 6: Key formatting and installation ID

**Files:**
- Create: `src/firebase/subscriptions/keyFormat.ts`, `src/firebase/installation/installationId.ts`
- Test: `__tests__/subscriptions/keyFormat.test.ts`, `__tests__/installation/installationId.test.ts`
- Modify: `package.json` (add `expo-secure-store`)

**Interfaces:**
- Consumes: `fixtures/keyNormalization.json`.
- Produces: `normalizeKeyBody(raw: string): string | null`, `looksPlausible(raw: string): boolean`, `formatKeyForDisplay(raw: string): string`, `INSTALLATION_KEY = 'streamz.installationId'`, `getInstallationId(): Promise<string>`.

`looksPlausible` only gates the Activate button. It is never an authorization signal (§9); the server decides.

- [ ] **Step 1: Write the failing key test.**

```ts
import vectors from '../../../fixtures/keyNormalization.json';
import { formatKeyForDisplay, looksPlausible, normalizeKeyBody } from '@/src/firebase/subscriptions/keyFormat';

describe('keyFormat', () => {
  it.each(vectors.valid)('normalizes $raw', ({ raw, normalized }) => {
    expect(normalizeKeyBody(raw)).toBe(normalized);
    expect(looksPlausible(raw)).toBe(true);
    expect(formatKeyForDisplay(raw)).toBe(
      `FLK-${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8, 12)}`);
  });
  it.each(vectors.invalid)('rejects $raw', ({ raw }) => {
    expect(normalizeKeyBody(raw)).toBeNull();
    expect(looksPlausible(raw)).toBe(false);
  });
  it('never throws on hostile input', () => {
    for (const raw of ['', ' '.repeat(5000), 'FLK-';DROP--', '\u0000\u0000']) {
      expect(() => formatKeyForDisplay(raw)).not.toThrow();
      expect(looksPlausible(raw)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run `npx jest __tests__/subscriptions` → FAIL, module not found.**
- [ ] **Step 3: Implement `keyFormat.ts`.** Crockford base32 excludes `I L O U`, which is what makes the invalid vectors meaningful rather than arbitrary.

```ts
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function normalizeKeyBody(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = cleaned.startsWith('FLK') ? cleaned.slice(3) : cleaned;
  if (body.length !== 12) return null;
  for (const c of body) if (!ALPHABET.includes(c)) return null;
  return body;
}

export const looksPlausible = (raw: string): boolean => normalizeKeyBody(raw) !== null;

export function formatKeyForDisplay(raw: string): string {
  const body = normalizeKeyBody(raw);
  if (!body) return raw.toUpperCase().slice(0, 20);
  return `FLK-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}
```

- [ ] **Step 4: Run it → PASS.** If any `invalid` vector unexpectedly passes, the vector is wrong, not the code — check `I/L/O/U` exclusion first.
- [ ] **Step 5: Write the failing installation test.** Storage is mocked at the boundary; nothing here needs a device.

```ts
jest.mock('expo-secure-store', () => {
  const m = new Map<string, string>();
  return { getItemAsync: jest.fn((k: string) => Promise.resolve(m.get(k) ?? null)),
           setItemAsync: jest.fn((k: string, v: string) => { m.set(k, v); return Promise.resolve(); }) };
});
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee') }));

import { getInstallationId, INSTALLATION_KEY } from '@/src/firebase/installation/installationId';
import * as SecureStore from 'expo-secure-store';

it('generates once, then reads back the same id', async () => {
  const first = await getInstallationId();
  expect(first).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(INSTALLATION_KEY, first);
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(first);
  expect(await getInstallationId()).toBe(first);
  expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
});

it('replaces a corrupt stored value instead of propagating it', async () => {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('not-a-uuid');
  const id = await getInstallationId();
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
});
```

- [ ] **Step 6: Run → FAIL.** Then `npm i expo-secure-store@57.0.4 expo-crypto`. Confirm the real export names before implementing: `node -e "const c=require('expo-crypto');console.log(Object.keys(c).filter(k=>/uuid/i.test(k)))"`. Use whichever of `randomUUID` / `getRandomUUID` actually exists, in both the module and the mock — do not guess.
- [ ] **Step 7: Implement `installationId.ts`.**

```ts
import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';

export const INSTALLATION_KEY = 'streamz.installationId';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getInstallationId(): Promise<string> {
  const stored = await SecureStore.getItemAsync(INSTALLATION_KEY);
  if (stored && UUID_RE.test(stored)) return stored;
  const next = randomUUID().toLowerCase();
  await SecureStore.setItemAsync(INSTALLATION_KEY, next);
  return next;
}
```

- [ ] **Step 8: Run `npm test` → PASS.** Commit `feat: add key formatting and secure installation id`.

### Task 7: Gate decision reducer

**Files:**
- Create: `src/firebase/subscriptions/gate.ts`
- Test: `__tests__/subscriptions/gate.test.ts`

**Interfaces:**
- Consumes: `AccessResult`, `GateDecision` from `@/src/firebase/models`.
- Produces: `GateFacts`, `decideGate(f: GateFacts): GateDecision`, `shouldRevalidate(lastValidatedAtMs, nowMs, intervalMs): boolean`, `routeFor(d): 'Login' | 'Subscription' | 'Main' | 'Blocked'`.

The whole authorization policy lives in one pure function, which is why it is unit-tested rather than checked on a device. Offline grace applies **only** when the last server verdict was `authorized`, so revoked and suspended cannot be survived offline and an expired term cannot be cached into permanence (§13).

- [ ] **Step 1: Write the failing tests.** Each case is a spec requirement, not a convenience.

```ts
import { decideGate, routeFor, shouldRevalidate } from '@/src/firebase/subscriptions/gate';
import type { AccessResult } from '@/src/firebase/models';

const NOW = 1_000_000_000_000;
const GRACE = 24 * 60 * 60 * 1000;
const ok: AccessResult = { status: 'authorized', expiresAt: NOW + GRACE * 10, serverTimeMs: NOW };
const base = { uid: 'u1', live: null as AccessResult | null, transportFailed: false,
               lastGoodAuthorizedAt: null as number | null, nowMs: NOW, graceMs: GRACE };

describe('decideGate', () => {
  it('signedOut without a uid', () => expect(decideGate({ ...base, uid: null })).toBe('signedOut'));
  it('bootstrapping while the first verdict is pending', () => expect(decideGate(base)).toBe('bootstrapping'));
  it('ready on a live authorized verdict', () => expect(decideGate({ ...base, live: ok })).toBe('ready'));
  it('needsSubscription with no key activated', () =>
    expect(decideGate({ ...base, live: { ...ok, status: 'needsKey' } })).toBe('needsSubscription'));
  it('blocks expired, revoked, suspended, disabled', () => {
    for (const s of ['expired', 'revoked', 'suspended', 'disabled'] as const)
      expect(decideGate({ ...base, live: { ...ok, status: s } })).toBe('blocked');
  });
});
```
```ts
describe('offline grace', () => {
  const f = { ...base, transportFailed: true, lastGoodAuthorizedAt: NOW - 60_000 };
  it('admits a recent authorized verdict', () => expect(decideGate(f)).toBe('offlineCached'));
  it('refuses without any prior good verdict', () =>
    expect(decideGate({ ...f, lastGoodAuthorizedAt: null })).toBe('needsServerContact'));
  it('refuses past the grace window', () =>
    expect(decideGate({ ...f, lastGoodAuthorizedAt: NOW - GRACE - 1 })).toBe('needsServerContact'));
  it('never lets the cached path survive a revoked verdict', () =>
    expect(decideGate({ ...f, live: { ...ok, status: 'revoked' } })).toBe('blocked'));
});

describe('routing and revalidation', () => {
  it('maps every decision to a route', () => {
    expect(routeFor('signedOut')).toBe('Login');
    expect(routeFor('needsSubscription')).toBe('Subscription');
    expect(routeFor('ready')).toBe('Main');
    expect(routeFor('offlineCached')).toBe('Main');
    expect(routeFor('blocked')).toBe('Blocked');
    expect(routeFor('bootstrapping')).toBe('Blocked');
    expect(routeFor('needsServerContact')).toBe('Blocked');
  });
  it('always revalidates when never validated', () => expect(shouldRevalidate(null, NOW, 900_000)).toBe(true));
  it('revalidates past the interval only', () => {
    expect(shouldRevalidate(NOW - 901_000, NOW, 900_000)).toBe(true);
    expect(shouldRevalidate(NOW - 10_000, NOW, 900_000)).toBe(false);
  });
});
```

- [ ] **Step 2: Run `npx jest __tests__/subscriptions/gate` → FAIL, module not found.**
- [ ] **Step 3: Implement `gate.ts`.**

```ts
import type { AccessResult, GateDecision } from '@/src/firebase/models';

export interface GateFacts {
  uid: string | null;
  live: AccessResult | null;
  transportFailed: boolean;
  lastGoodAuthorizedAt: number | null;
  nowMs: number;
  graceMs: number;
}

export function decideGate(f: GateFacts): GateDecision {
  if (!f.uid) return 'signedOut';
  if (f.live && !f.transportFailed) {
    if (f.live.status === 'authorized') {
      return f.live.expiresAt !== null && f.live.serverTimeMs >= f.live.expiresAt
        ? 'blocked' : 'ready';
    }
    return f.live.status === 'needsKey' ? 'needsSubscription' : 'blocked';
  }
  if (f.transportFailed) {
    const age = f.lastGoodAuthorizedAt === null ? null : f.nowMs - f.lastGoodAuthorizedAt;
    return age !== null && age <= f.graceMs ? 'offlineCached' : 'needsServerContact';
  }
  return 'bootstrapping';
}
export function routeFor(d: GateDecision): 'Login' | 'Subscription' | 'Main' | 'Blocked' {
  if (d === 'signedOut') return 'Login';
  if (d === 'needsSubscription') return 'Subscription';
  if (d === 'ready' || d === 'offlineCached') return 'Main';
  return 'Blocked';
}

export function shouldRevalidate(last: number | null, nowMs: number, intervalMs: number): boolean {
  return last === null || nowMs - last >= intervalMs;
}
```

- [ ] **Step 4: Run → PASS.** The dual expiry check is deliberate: the server compares first, and the client re-checks `serverTimeMs >= expiresAt`, which defeats the clock-rollback case where a stale cache would otherwise look valid. A locally modified expiry changes nothing, because `expiresAt` is only ever accepted inside a live server response (§12 of the brief).
- [ ] **Step 5: Commit** `feat: add pure subscription gate reducer with offline grace`.

### Task 8: Error message mapping

**Files:**
- Create: `src/firebase/errors.ts`
- Test: `__tests__/firebase/errors.test.ts`

**Interfaces:**
- Produces: `describeActivation(code: ActivateCode): string`, `describeAuthError(code: string): string`, `isTransportError(e: unknown): boolean`.

`isTransportError` is what the gate's `transportFailed` flag is built from, so its precision is load-bearing: treating `permission-denied` as a transport failure would silently grace-cache a refused authorization.

- [ ] **Step 1: Write the failing test.**

```ts
import { describeActivation, describeAuthError, isTransportError } from '@/src/firebase/errors';

it('gives every activation code user copy', () => {
  const codes = ['ACTIVATED', 'ALREADY_OWNED', 'NOT_FOUND', 'EXPIRED', 'REVOKED',
                 'ALREADY_BOUND', 'CEILING', 'UNAUTHENTICATED'] as const;
  for (const c of codes) {
    expect(describeActivation(c).length).toBeGreaterThan(12);
    expect(describeActivation(c)).not.toMatch(/Firebase|firestore|functions|\[object/);
  }
  expect(describeActivation('ALREADY_BOUND')).toMatch(/another account/i);
  expect(describeActivation('EXPIRED')).toMatch(/expired/i);
  expect(describeActivation('REVOKED')).toMatch(/revoked/i);
  expect(describeActivation('NOT_FOUND')).toMatch(/valid/i);
});
it('separates cancellation from failure', () => {
  expect(describeAuthError('cancel')).toMatch(/cancelled/i);
  expect(describeAuthError('network-request-failed')).toMatch(/connection/i);
  expect(describeAuthError('mystery')).toBe('Sign-in failed. Please try again.');
});
it('detects only real transport failures', () => {
  expect(isTransportError({ code: 'unavailable' })).toBe(true);
  expect(isTransportError({ code: 'permission-denied' })).toBe(false);
  expect(isTransportError(new Error('boom'))).toBe(false);
});
```

- [ ] **Step 2: Run → FAIL. Step 3: implement** using the exact copy from the branding brief §6 — invalid `This subscription key isn't valid.`, already-bound `This key is already linked to another account.`, expired `This subscription key has expired.`, revoked `This subscription has been revoked.`, transport `We couldn't verify your subscription. Check your connection and try again.` `isTransportError` matches only codes `unavailable`, `internal`, `network-request-failed`. Keep raw codes in a `__DEV__`-only console line so diagnostics survive (§28).
- [ ] **Step 4: Run → PASS. Step 5: Commit** `feat: map firebase errors to user-facing copy`.

---

## Stage 3 — Firebase foundation

### Task 9: Install Firebase and prove it initialises

**Files:**
- Create: `src/firebase/init.ts`
- Modify: `package.json`, `App.tsx:40` (add `FirebaseProvider`? no — init is side-effect + a `useFirebaseReady()` probe used by Task 18)

**Interfaces:**
- Produces: `ensureFirebase(): boolean`, `firebaseProjectId(): string | null`.

**Pre-flight, per AGENTS.md:** read `https://docs.expo.dev/versions/v57.0.0/` for the current guidance on native modules in a committed-native (already-prebuilt) project before running any command here.

- [ ] **Step 1: Confirm the build route you are using.** `android/` is committed and CI builds it with gradle directly (`.github/workflows/build.yml`). **Do not run `npx expo prebuild`** in this project — it regenerates `android/` and would wipe the Task 4 package migration and the Task 10 Google Services wiring. Every native change in Phase 1A is a direct edit to `android/`. Record in the task report that prebuild was not run.
- [ ] **Step 2: Install.** `npm i @react-native-firebase/app@26.4.0 @react-native-firebase/auth@26.4.0 @react-native-firebase/firestore@26.4.0 @react-native-firebase/functions@26.4.0 @react-native-firebase/analytics@26.4.0 @react-native-google-signin/google-signin@16.1.5`. Then `npx pod-install` is not applicable on Windows; skip it and note iOS is unbuilt.
- [ ] **Step 3: Verify the modules resolve.** `node -e "console.log(require('./package.json').dependencies['@react-native-firebase/app'])"` → `26.4.0`.
- [ ] **Step 4: Write `src/firebase/init.ts`.**

```ts
import firebase from '@react-native-firebase/app';
import analytics from '@react-native-firebase/analytics';

let configured = false;

export function ensureFirebase(): boolean {
  if (configured) return true;
  if (!firebase.apps.length) return false;   // google-services.json supplies config
  configured = true;
  return true;
}

export const firebaseProjectId = (): string | null =>
  firebase.apps.length ? firebase.app().options.projectId : null;

export async function disableAdvertisingId(): Promise<void> {
  await analytics().setAdvertisingIdCollectionEnabled(false);   // spec A4
}
```

- [ ] **Step 5: Build to the device and prove it.** After Task 10 places `google-services.json`: `cd android && ./gradlew assembleDebug`, install, launch, and check `$A logcat -d | grep -iE "FirebaseApp|google-services"` for a clean init. Expected: no `DefaultFirebaseProjectsConfigNotFoundException`, no `MissingProjectConfiguration`.
- [ ] **Step 6: Typecheck and commit** `feat: wire react-native-firebase and disable ad-id collection`. If `tsc` reports missing type entries for a Firebase subpath, add a targeted `@ts-expect-error` **only** with a written reason in the task report — never a blanket ignore.

### Task 10: Keystore, signing, and `google-services.json`

**Files:**
- Create: `android/app/streamz-release.keystore` (gitignored), `android/app/google-services.json`
- Modify: `android/app/build.gradle:130-152`, `.gitignore`

**Interfaces:**
- Produces: `applicationId stream.z` signed by a real release key; the two SHA-1 fingerprints that Google Sign-In requires.

- [ ] **Step 1: Generate the release keystore.** `keytool -genkeypair -v -keystore android/app/streamz-release.keystore -alias streamz -keyalg RSA -keysize 2048 -validity 10000 -storepass "$STREAMZ_STORE_PASS" -keypass "$STREAMZ_KEY_PASS"`. Write both passwords **once** into an uncommitted `android/keystore.properties`, and record the keystore's SHA-1. Losing this keystore means you cannot publish a compatible upgrade of an already-installed app — say so in the report and store it somewhere durable outside the repo.
- [ ] **Step 2: Protect it.** Append to `.gitignore`: `android/app/*.keystore`, `android/keystore.properties`, `functions/.env`, `android/app/google-services.json` is **not** ignored (its values are public-by-design; the key inside gets restricted in console instead).
- [ ] **Step 3: Wire release signing** in `build.gradle` — add a `release` block to `signingConfigs` reading the properties file, and point `buildTypes.release.signingConfig` at it, replacing the debug fallback at `:145`. Keep `debug` untouched. Follow the v57/RN docs for the exact gradle idiom; the point is only that release no longer signs with `debug.keystore`.
- [ ] **Step 4: Place the config.** Copy the downloaded `google-services.json` to `android/app/google-services.json`; confirm `client[0].android_client_info.package_name == "stream.z"`. Add to `android/build.gradle` buildscript the Google Services classpath, and `apply plugin: 'com.google.gms.google-services'` at the **end** of `android/app/build.gradle`.
- [ ] **Step 5: Build.** `./gradlew clean assembleDebug assembleRelease 2>&1 | tail -30`. Expected: both succeed. A `package_name does not match applicationId` failure means Task 4 or Step 4 is wrong — fix the identity, do not edit the JSON to compensate.
- [ ] **Step 6: Capture both SHA-1s** (debug from `debug.keystore`, release from the new one) and hand them plus `stream.z` to the Firebase console owner checklist in §Appendix A. Google Sign-In cannot work until items 5-6 of that checklist are done.
- [ ] **Step 7: Verify signature identity on device.** `$A shell dumpsys package stream.z | grep -i signature` and confirm the release APK's signer hash matches the release keystore, not debug.
- [ ] **Step 8: Commit** `build: add release signing and google-services config` — the gradle edits and `.gitignore` only. Never the keystore.

---

## Stage 4 — Firestore rules and Cloud Functions

### Task 11: Project files, rules, and rules tests

**Files:**
- Create: `firebase.json`, `firestore.rules`, `firestore.indexes.json`, `__tests__/rules/firestore.rules.test.ts`
- Modify: `package.json` (add `firebase-tools`, `@firebase/rules-unit-testing`)

**Interfaces:**
- Produces the collection paths every Function and screen relies on: `users/{uid}`, `subscriptionKeys/{keyId}`, `watchSessions/{sessionId}`, `userDailyStats/{id}`, `contentStats/{contentId}`, `devices/{uid__installationId}`, `adminAudit/{id}`, `config/app`.

- [ ] **Step 1:** `firebase.json` — declare `firestore.rules`, `firestore.indexes`, `functions.source: "functions"`, and an `emulators` block for `firestore`, `functions`, `auth` with `"singleProjectMode": true` so the emulator needs no live project.
- [ ] **Step 2:** `firestore.indexes.json` — two composites the design requires: `(uid ASC, state ASC, updatedAt ASC)` on `watchSessions` for the stale sweep, `(date ASC, contentId ASC)` on `contentStats` for later top-content queries.
- [ ] **Step 3:** `firestore.rules`, deny by default then exactly these grants.
```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/rules {
    function signedIn() { return request.auth != null; }
    function isOwner(uid) { return signedIn() && request.auth.uid == uid; }

    match /users/{uid} {
      allow read: if isOwner(uid);
      allow update: if isOwner(uid)
        && request.resource.data.uid == resource.data.uid
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['lastActiveAt']);
      allow create, delete: if false;
    }
    match /subscriptionKeys/{keyId} { allow read, write: if false; }
    match /userDailyStats/{id}      { allow read, write: if false; }
    match /contentStats/{id}        { allow read, write: if false; }
    match /adminAudit/{id}          { allow read, write: if false; }
    match /config/app { allow read: if signedIn(); allow write: if false; }
    match /devices/{id} {
      allow read: if signedIn() && resource.data.uid == request.auth.uid;
      allow write: if false;
    }
    match /watchSessions/{id} {
      allow read: if signedIn() && resource.data.uid == request.auth.uid;
      allow create: if signedIn()
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.state == 'open'
        && request.resource.data.keys().hasAll(['sessionId','uid','state','startedAt','contentId']);
      allow update: if signedIn()
        && resource.data.uid == request.auth.uid
        && resource.data.state == 'open'
        && request.resource.data.uid == resource.data.uid
        && request.resource.data.sessionId == resource.data.sessionId
        && request.resource.data.startedAt == resource.data.startedAt
        && request.resource.data.state in ['open','finalized']
        && request.resource.data.watchDurationMs
           <= request.resource.data.durationMs;
      allow delete: if false;
    }
  }
}
```
- [ ] **Step 4: Write the failing rules tests.** This is the brief's §32 security list made executable — each refusal is an assertion rather than an intention.

```ts
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import * as fs from 'fs';

const rules = { source: fs.readFileSync('firestore.rules', 'utf8') };
const env = initializeTestEnvironment({
  projectId: 'streamz-test',
  firestore: { rules, host: '127.0.0.1', port: 8080 },
});
const alice = env.authenticatedContext('uid-alice');
const bob = env.authenticatedContext('uid-bob');

beforeEach(async () => { await env.clearFirestore(); });

it('refuses every privileged field a client might try to self-edit', async () => {
  await assertSucceeds(setDoc(doc(alice.firestore(), 'users', 'uid-alice'), { uid: 'uid-alice' }));
  const d = doc(alice.firestore(), 'users', 'uid-alice');
  for (const patch of [{ status: 'active' }, { expiresAt: 9e15 }, { subscriptionId: 'k1' },
                       { installationId: 'other' }, { role: 'admin' }, { uid: 'someone-else' }])
    await assertFails(updateDoc(d, patch));
});

it('allows only the lastActiveAt heartbeat', async () => {
  await assertSucceeds(updateDoc(doc(alice.firestore(), 'users', 'uid-alice'), { lastActiveAt: 5 }));
});

it('hides keys, rollups and audit from clients entirely', async () => {
  await assertFails(setDoc(doc(alice.firestore(), 'subscriptionKeys', 'k1'), { keyHash: 'x' }));
  await assertFails(getDoc(doc(alice.firestore(), 'subscriptionKeys', 'k1')));
  await assertFails(setDoc(doc(alice.firestore(), 'contentStats', 'c1'), { totalWatchMs: 1 }));
  await assertFails(setDoc(doc(alice.firestore(), 'adminAudit', 'a1'), { action: 'x' }));
});

it('isolates watch sessions between users and freezes them at finalize', async () => {
  const s = { sessionId: 'uid-alice__1', uid: 'uid-alice', state: 'open', startedAt: 1,
              contentId: 'c1', durationMs: 1000, watchDurationMs: 10 };
  await assertSucceeds(setDoc(doc(alice.firestore(), 'watchSessions', s.sessionId), s));
  await assertSucceeds(updateDoc(doc(alice.firestore(), 'watchSessions', s.sessionId),
                                 { state: 'finalized', watchDurationMs: 900 }));
  await assertFails(updateDoc(doc(alice.firestore(), 'watchSessions', s.sessionId),
                              { watchDurationMs: 10 }));
  await assertFails(getDoc(doc(bob.firestore(), 'watchSessions', s.sessionId)));
});

it('rejects a forged watch duration and an unauthenticated config read', async () => {
  await assertFails(setDoc(doc(alice.firestore(), 'watchSessions', 'uid-alice__2'),
    { sessionId: 'uid-alice__2', uid: 'uid-alice', state: 'open', startedAt: 1,
      contentId: 'c1', durationMs: 1000, watchDurationMs: 5000 }));
  await assertFails(getDoc(env.unauthenticatedContext().firestore().collection('config').doc('app')));
});
```

Note the two assertions that matter most: the finalized session refuses any later write, because the update rule requires `resource.data.state == 'open'`; and the forged duration (5000 ms of watching inside a 1000 ms clip) is refused. `users/{uid}` create is denied, so the fixture seeds it via `setDoc` only because the emulator's `clearFirestore` context allows an owner create — if that create fails, move seeding into the test's admin context rather than loosening the rule.
- [ ] **Step 5: Run** `npx -y firebase-tools@latest emulators:exec --only firestore "npx jest __tests__/rules"`. Expected: FAIL until the rules are exactly as above. Every assertion must execute against the emulator; a skipped test here is a false sense of security.
- [ ] **Step 6: Commit** `feat: add firestore rules, indexes, and executable rules tests`.

### Task 12: Functions project, key codec, admin guards

**Files:**
- Create: `functions/package.json`, `functions/tsconfig.json`, `functions/src/index.ts`, `functions/src/admin.ts`, `functions/src/keys.ts`
- Test: `__tests__/functions/keys.test.ts`

**Interfaces:**
- Produces: `normalizeKeyBody(raw: unknown): string | null` (same contract as the client), `hashKey(body): string`, `randomKeyBody(): string`, `formatKey(body): string`, `getAdmin()`, `requireAdmin(auth)`, `configDefaults()`, `ensureConfig(db)`, `readConfig(db)`, `audit(db, actorUid, action, targetId, metadata)`, `requireInstallationId(data)`, `appVersionOf(data)`, `upsertUser(ref, uid, token, installationId, appVersion, now)`, `rotationCountSince(db, uid, sinceMs)`, `rotateInstallation(db, uid, from, to, now)`. Tasks 13-16 import these from `functions/src/admin.ts` rather than redefining them.

- [ ] **Step 1: Scaffold.** `functions/package.json` with `firebase-functions` v6, `firebase-admin` v13, `engines.node: "22"`, CommonJS. `npm install` inside `functions/`. Add `"build:functions": "tsc -p functions/tsconfig.json"` to root scripts.
- [ ] **Step 2: Write the failing codec test reading the same `fixtures/keyNormalization.json` as the client suite** — this is what proves the two runtimes agree without sharing source.

```ts
import vectors from '../../fixtures/keyNormalization.json';
import { normalizeKeyBody, formatKey } from '../../functions/src/keys';

it.each(vectors.valid)('agrees with the client on $raw', ({ raw, normalized }) => {
  expect(normalizeKeyBody(raw)).toBe(normalized);
  expect(formatKey(normalized)).toMatch(/^FLK-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
});
it.each(vectors.invalid)('rejects $raw', ({ raw }) => expect(normalizeKeyBody(raw)).toBeNull());
it('is deterministic and never returns plaintext-shaped output', async () => {
  const { hashKey } = await import('../../functions/src/keys');
  expect(hashKey('7H3K92PQX8LM')).toBe(hashKey('7H3K92PQX8LM'));
  expect(hashKey('7H3K92PQX8LM')).toHaveLength(64);
});
```

- [ ] **Step 3: Implement `functions/src/keys.ts`** with the Crockford alphabet, `normalizeKeyBody`, `hashKey` over `streamz:v1:<body>` using `node:crypto`, `randomKeyBody` from `randomBytes`, `formatKey`.
- [ ] **Step 4: Run → PASS. Commit** `feat: scaffold cloud functions with shared key contract`.

### Task 13: `validateAccess` — the routine verdict

**Files:**
- Create: `functions/src/validateAccess.ts`, `functions/src/admin.ts` (extend with `upsertUser`)
- Modify: `functions/src/index.ts`
- Test: `__tests__/functions/validateAccess.test.ts`

**Interfaces:**
- Consumes: `config/app`, `users/{uid}`, `subscriptionKeys/{keyId}`, `devices/*`.
- Produces: `ValidatedAccess` (Task 5). When authorized it carries `jellyfin: JellyfinCredential`, attached in Task 17 Step 3.
- Exported callable name: `validateAccess`.

- [ ] **Step 1: Write the failing test matrix.**

```ts
it('creates the user document on first call, with server time', async () => {
  const r = await callValidateAccess({ uid: 'u1', installationId: 'i1' });
  expect(r.status).toBe('needsKey');
  expect(await userExists('u1')).toBe(true);
});
it('reports needsKey when no subscription is bound', async () => {
  await callValidateAccess({ uid: 'u2', installationId: 'i2' });
  expect((await readUser('u2')).subscriptionId).toBeNull();
  expect((await callValidateAccess({ uid: 'u2', installationId: 'i2' })).status).toBe('needsKey');
});
it('reports authorized while expiresAt is in the future', async () => {
  seedKey({ keyId: 'k1', status: 'ACTIVE', uid: 'u1', installationId: 'i1',
            expiresAt: Date.now() + 7 * 864e5 });
  const r = await callValidateAccess({ uid: 'u1', installationId: 'i1' });
  expect(r.status).toBe('authorized');
  expect(r.expiresAt).toBeGreaterThan(Date.now());
  expect(typeof r.serverTimeMs).toBe('number');
});
it('flips ACTIVE to EXPIRED on the key and the user, using server time', async () => {
  seedKey({ status: 'ACTIVE', expiresAt: 1 });
  const r = await callValidateAccess({ uid: 'u1', installationId: 'i1' });
  expect(r.status).toBe('expired');
  expect(await readKey('k1')).toMatchObject({ status: 'EXPIRED' });
});
it('returns suspended and disabled verbatim and never authorizes them', async () => {
  seedKey({ keyId: 'k1', status: 'ACTIVE', uid: 'u1', installationId: 'i1',
            expiresAt: Date.now() + 864e5 });
  for (const st of ['suspended', 'disabled']) {
    seedUser({ uid: 'u1', status: st, subscriptionId: 'k1', installationId: 'i1' });
    const r = await callValidateAccess({ uid: 'u1', installationId: 'i1' });
    expect(r.status).toBe(st);
    expect('jellyfin' in r).toBe(false);
  }
});
it('rotates a new installation under the ceiling and audits it', async () => {
  seedUser({ installationId: 'i1' });
  const r = await callValidateAccess({ uid: 'u1', installationId: 'i2' });
  expect(await readUser('u1')).toMatchObject({ installationId: 'i2' });
  expect(await auditCount('installation.rotated')).toBe(1);
});
it('refuses rotation once the 30-day ceiling is reached', async () => {
  seedRotations(3);
  expect((await callValidateAccess({ uid: 'u1', installationId: 'i9' })).status)
    .toBe('installationCeiling');
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Sequence inside the callable, all times from `Date.now()` on the server:

```ts
export const validateAccess = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const presented = requireInstallationId(req.data);
  const db = getAdmin().firestore();
  await ensureConfig(db);
  const cfg = await readConfig(db);
  const now = Date.now();

  const ref = db.collection('users').doc(uid);
  const user = await upsertUser(ref, uid, req.auth.token, presented, appVersionOf(req.data), now);

  if (user.status !== 'active') {
    return { status: user.status, expiresAt: user.expiresAt ?? null, serverTimeMs: now };
  }
  if (user.installationId !== presented) {
    const rotated = await rotationCountSince(db, uid, now - 30 * 864e5);
    if (rotated >= cfg.maxInstallationRotations30d) {
      await audit(db, uid, 'installation.refused', uid, { presented, rotated });
      return { status: 'installationCeiling', expiresAt: null, serverTimeMs: now };
    }
    await rotateInstallation(db, uid, user.installationId, presented, now);
  }
  if (!user.subscriptionId) return { status: 'needsKey', expiresAt: null, serverTimeMs: now };

  const keyRef = db.collection('subscriptionKeys').doc(user.subscriptionId);
  return reconcileKey(keyRef, user, now);
});
```

`reconcileKey` is the expiry authority: if `key.status === 'ACTIVE' && now >= key.expiresAt` it writes `EXPIRED` to the key and clears the user's access, then returns `expired`. Revoked and missing keys return their statuses verbatim. A client-side clock appears nowhere in this path, which is why a modified local expiry cannot extend anything (§12 of the brief).
- [ ] **Step 4: Run against the emulator → PASS. Step 5: Commit** `feat: add validateAccess with expiry reconciliation and rotation ceiling`.

### Task 14: `activateKey` — atomic binding

**Files:**
- Create: `functions/src/activateKey.ts`; Modify: `functions/src/index.ts`
- Test: `__tests__/functions/activateKey.test.ts`

**Interfaces:**
- Produces: `ActivateResult` (Task 5). Callable name `activateKey`, input `{ key: string, installationId: string }`.

- [ ] **Step 1: Write the failing tests.** The concurrency case is the whole point of this task, so it is run in parallel rather than sequentially.

```ts
it('activates an unused key and binds uid + installation', async () => {
  seedKey({ keyId: 'k1', body: '7H3K92PQX8LM', status: 'UNUSED', expiresAt: null });
  const r = await callActivate('u1', 'i1', 'flk-7h3k-92pq-x8lm');
  expect(r.code).toBe('ACTIVATED');
  expect(await readKey('k1')).toMatchObject({ status: 'ACTIVE', uid: 'u1', installationId: 'i1' });
  expect((await readKey('k1')).keyHash).not.toMatch(/7H3K92PQX8LM/);
});
it('refuses the same key for a second account', async () => {
  seedActivated('k1', 'u1', 'i1');
  expect((await callActivate('u2', 'i2', KEY_PLAINTEXT)).code).toBe('ALREADY_BOUND');
  expect(await readKey('k1')).toMatchObject({ uid: 'u1' });
});
it('is idempotent for the same account and installation', async () => {
  seedActivated('k1', 'u1', 'i1');
  expect((await callActivate('u1', 'i1', KEY_PLAINTEXT)).code).toBe('ALREADY_OWNED');
});
it('rejects expired, revoked and unknown keys', async () => {
  seedKey({ keyId: 'k2', status: 'UNUSED', expiresAt: 1 });
  expect((await callActivate('u1', 'i1', KEY2)).code).toBe('EXPIRED');
  seedKey({ keyId: 'k3', status: 'REVOKED' });
  expect((await callActivate('u1', 'i1', KEY3)).code).toBe('REVOKED');
  expect((await callActivate('u1', 'i1', 'FLK-ZZZZ-ZZZZ-ZZZZ')).code).toBe('NOT_FOUND');
});
it('rejects an unauthenticated call', async () => {
  await expect(callActivateAnon(KEY_PLAINTEXT)).rejects.toMatchObject({ code: 'unauthenticated' });
});
it('lets only one of two concurrent activations win', async () => {
  seedKey({ keyId: 'k9', body: 'AAAA2222BBBB', status: 'UNUSED' });
  const both = await Promise.all([callActivate('uA', 'iA', KEY9), callActivate('uB', 'iB', KEY9)]);
  const winners = both.filter((r) => r.code === 'ACTIVATED');
  expect(winners).toHaveLength(1);
  expect(await readKey('k9')).toMatchObject({ status: 'ACTIVE' });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement with one transaction.** The single-transaction requirement is what makes the concurrency test pass rather than flaky.

```ts
export const activateKey = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const body = normalizeKeyBody(req.data?.key);
  const installationId = requireInstallationId(req.data);
  if (!body) return { code: 'NOT_FOUND', expiresAt: null };

  const db = getAdmin().firestore();
  const hash = hashKey(body);
  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (t) => {
    const found = await t.get(db.collection('subscriptionKeys').where('keyHash', '==', hash).limit(1));
    if (found.empty) return { code: 'NOT_FOUND', expiresAt: null };
    const keyRef = found.docs[0], k = keyRef.data(), now = Date.now();

    if (k.status === 'REVOKED') return { code: 'REVOKED', expiresAt: null };
    if (k.uid === uid && k.installationId === installationId)
      return { code: 'ALREADY_OWNED', expiresAt: k.expiresAt };
    if (k.status === 'ACTIVE' && k.uid !== uid) return { code: 'ALREADY_BOUND', expiresAt: null };
    if (k.uid === uid && k.installationId !== installationId)
      return { code: 'ALREADY_BOUND', expiresAt: null };
    if (k.expiresAt !== null && now >= k.expiresAt) {
      t.update(keyRef, { status: 'EXPIRED' });
      return { code: 'EXPIRED', expiresAt: k.expiresAt };
    }

    const cfg = await readConfig(db);
    const expiresAt = k.expiresAt ?? now + cfg.keyDurationDays * 864e5;
    t.update(keyRef, { status: 'ACTIVE', uid, installationId, activatedAt: now, expiresAt });
    t.set(userRef, { uid, subscriptionId: keyRef.id, status: 'active', installationId,
                     activatedAt: now, expiresAt, lastLoginAt: now }, { merge: true });
    t.set(db.collection('devices').doc(`${uid}__${installationId}`),
          { uid, installationId, firstSeenAt: now, lastSeenAt: now, rotations: 0 }, { merge: true });
    return { code: 'ACTIVATED' as const, expiresAt };
  });
});
```

Note there is no `audit()` inside the transaction: audit writes go after commit, so a rolled-back transaction never leaves a phantom audit record.
- [ ] **Step 4: Run → PASS, and run the suite five times in a row** (`npx jest __tests__/functions/activateKey -t concurrent` repeated) to confirm the loser genuinely loses rather than racing. Commit `feat: atomic subscription key activation with device binding`.

### Task 15: Admin callables — generate, revoke, set role

**Files:**
- Create: `functions/src/manageKeys.ts`; Modify: `functions/src/index.ts`
- Test: `__tests__/functions/manageKeys.test.ts`

**Interfaces:**
- Produces callables `generateKeys({ count, durationDays })` → `{ keys: string[] }` (plaintext returned **once**, never persisted), `revokeKey({ keyId })`, `setAdminRole({ uid, role })`.

- [ ] **Step 1: Write the failing tests:** non-admin is rejected with `permission-denied`; `generateKeys(count: 5)` yields 5 distinct format-valid keys whose stored documents contain only `keyHash`; the returned plaintext all normalize to stored hashes; `revokeKey` on an `ACTIVE` key also clears the owning user's `subscriptionId`; `setAdminRole` refuses to demote the last admin.
- [ ] **Step 2: Implement**, guarding each with `requireAdmin(req.auth)`, batching creation with `db.batch()` in chunks of 400, and writing `adminAudit` after commit. `setAdminRole` uses `auth().setCustomClaims(uid, { role })` and is the only writer of roles anywhere in the system.
- [ ] **Step 3: Run → PASS. Commit** `feat: admin-only key generation, revocation, and role claims`.

### Task 16: Rollup trigger and stale-session sweeper

**Files:**
- Create: `functions/src/rollups.ts`; Modify: `functions/src/index.ts`, `package.json` (root script `emulator`)
- Test: `__tests__/functions/rollups.test.ts`

**Interfaces:**
- Produces: `onWatchSessionWrite` (Firestore trigger) and `finalizeStaleSessions` (scheduled, every 5 minutes).

- [ ] **Step 1: Write the failing tests.**

```ts
it('rolls up once, on the open -> finalized transition only', async () => {
  const s = seedSession({ state: 'open', startedAt: DAY1, durationMs: 1000, watchDurationMs: 40 });
  await runTrigger(s, { ...s, state: 'open', watchDurationMs: 60 });
  expect(await readDaily('u1', DAY1)).toBeNull();
  await runTrigger({ ...s, watchDurationMs: 60 }, { ...s, state: 'finalized', watchDurationMs: 60 });
  expect(await readDaily('u1', DAY1)).toMatchObject({ sessions: 1, totalWatchMs: 60 });
  await runTrigger({ ...s, state: 'finalized' }, { ...s, state: 'finalized', watchDurationMs: 999 });
  expect(await readDaily('u1', DAY1)).toMatchObject({ sessions: 1 });
});
it('clamps an impossible duration instead of trusting it', async () => {
  await runTrigger(null, seedSession({ state: 'finalized', durationMs: 1000, watchDurationMs: 5000 }));
  expect(await readDaily('u1', DAY1)).toMatchObject({ totalWatchMs: 1000 });
});
it('bumps contentStats under the same contentId', async () => {
  await runTrigger(null, seedSession({ state: 'finalized', contentId: 'c1',
                                       durationMs: 1000, watchDurationMs: 300 }));
  expect(await readContent('c1')).toMatchObject({ sessions: 1, totalWatchMs: 300 });
});
it('finalizes a stale session and leaves a fresh one alone', async () => {
  const stale = seedStored({ state: 'open', updatedAt: Date.now() - 11 * 60_000, positionMs: 5000 });
  const fresh = seedStored({ state: 'open', updatedAt: Date.now() - 60_000, positionMs: 1000 });
  await runScheduled();
  expect(await readSession(stale)).toMatchObject({ state: 'finalized', watchDurationMs: 5000 });
  expect(await readSession(fresh)).toMatchObject({ state: 'open' });
});
```

The first test is the guard against amendment A2 regressing: an `open -> open` update must not roll up, `open -> finalized` must roll up exactly once, and a later write to an already-finalized document must not roll up again. The third and fourth assert the clamp and the sweeper's two outcomes.
- [ ] **Step 2: Implement the trigger so it fires only on the transition** (amendment A2), and writes **only** rollups. Writing back to `watchSessions` re-triggers the same handler:

```ts
export const onWatchSessionWrite = FirestoreDocument.onWrite(async (event) => {
  const before = event.dataBefore, after = event.data;
  if (!after || before?.state === 'finalized') return;      // A2: only open -> finalized
  const dur = Math.min(after.watchDurationMs ?? 0, after.durationMs ?? 0);
  const day = dayKey(Number(after.startedAt));
  await Promise.all([
    getAdmin().firestore().collection('userDailyStats').doc(`${after.uid}__${day}`)
      .set({ uid: after.uid, date: day, totalWatchMs: FieldValue.increment(dur),
             sessions: FieldValue.increment(1) }, { merge: true }),
    getAdmin().firestore().collection('contentStats').doc(after.contentId)
      .set({ contentId: after.contentId, totalWatchMs: FieldValue.increment(dur),
             sessions: FieldValue.increment(1) }, { merge: true }),
  ]);
});
```

- [ ] **Step 3: Implement the sweeper** (A3): query `watchSessions` where `state == 'open'` and `updatedAt < now - staleSessionMinutes * 60000`, and for each, recompute `watchDurationMs` from the last reported `positionMs`, set `state: 'finalized'`, `endedAt`, `completed`, `completionPercentage` — through the *same* helper the client-side finalize path uses, so there is one normalization rule. It updates the session (which then legitimately fires the trigger once) and never recomputes rollups inline.
- [ ] **Step 4: Test the sweeper** against the emulator: seed one stale open session, run the scheduled handler, assert the doc is finalized and that `userDailyStats` gained exactly the clamped duration. Assert a fresh open session is left alone.
- [ ] **Step 5: Commit** `feat: rollup trigger and stale watch-session sweeper`.

### Task 17: Jellyfin session tokens (server-side only)

**Files:**
- Create: `functions/src/jellyfin.ts`
- Test: `__tests__/functions/jellyfin.test.ts` (fetch mocked; no live server in Phase 1A)

**Interfaces:**
- Produces: `jellyfinUsername(uid)` (deterministic, e.g. `streamz_` + first 8 of the uid), `ensureJellyfinUser(uid)`, `issueSessionToken(uid)` → `{ baseUrl, username, sessionToken }`, `revokeSessionToken(uid)`, `JF_BASE_URL` from Functions config. `issueSessionToken` calls `revokeSessionToken` first, which is what makes the login-time rotation in spec amendment A1 real rather than additive.

Phase 1A builds and unit-tests this module against a mocked `fetch` and does **not** wire it into playback — that is Phase 1B. Shipping it now keeps `validateAccess`'s return shape stable for the client tasks.

- [ ] **Step 1: Write the failing tests** asserting the `X-Emby-Authorization` header shape, that the service password is read from a secret and never logged, that `issueSessionToken` returns `{ baseUrl, username, sessionToken }`, and that it throws `unavailable` on a non-2xx so `validateAccess` degrades to the transport-failure branch rather than handing the client a broken token.
- [ ] **Step 2: Implement** with `fetch`, keeping every Jellyfin-specific endpoint string in one `const ENDPOINTS` object and a comment: `// Phase 1B pre-flight: confirm against the live server version before use (spec §13)`.
- [ ] **Step 3: Wire it into `validateAccess`.** Replace Task 13's `return reconcileKey(keyRef, user, now);` with `const v = await reconcileKey(keyRef, user, now); return v.status === 'authorized' ? { ...v, jellyfin: await issueSessionToken(uid) } : v;` and add a `validateAccess` test asserting an authorized verdict carries `{ baseUrl, username, sessionToken }` and that a Jellyfin outage downgrades to the transport-failure branch instead of returning an unauthorized-but-empty credential. Nothing in Phase 1A *plays* media with this token — Task 26's sample provider handles playback, and Phase 1B consumes the credential. Producing it here keeps the client-facing shape of `validateAccess` frozen across the milestone boundary.
- [ ] **Step 4: Commit** `feat: issue per-user jellyfin session tokens from validateAccess`.

---

## Stage 5 — Client integration

### Task 18: Google Sign-In and session provider

**Files:**
- Create: `src/firebase/auth/googleAuth.ts`, `src/firebase/auth/SessionProvider.tsx`
- Test: `__tests__/auth/googleAuth.test.ts`
- Modify: `App.tsx:40` (wrap children), `app.json` permissions if required by the sign-in flow

**Interfaces:**
- Consumes: `ensureFirebase`, `decideGate`, `routeFor`, `shouldRevalidate`, `validateAccess()`, `getInstallationId()`.
- Produces: `signInWithGoogle(): Promise<{ uid: string } | { cancelled: true } | { error: string }>`, `signOut(): Promise<void>`, `useSession(): { decision: GateDecision; user: UserSnapshot | null; refresh(): Promise<void>; retryNow(): Promise<void> }`.

- [ ] **Step 1: Write the failing test for the credential exchange**, mocking both libraries. The assertion that matters is that the **id token**, not an access token, is what reaches Firebase — getting this wrong produces a signed-in Firebase user whose `displayName` and `email` are empty.

```ts
it('exchanges the Google id token for a Firebase credential', async () => {
  (GoogleSignin.signIn as jest.Mock).mockResolvedValue({ idToken: 'IDT', accessToken: 'AT' });
  const r = await signInWithGoogle();
  expect(GoogleAuthProvider.credential).toHaveBeenCalledWith('IDT');
  expect(auth().signInWithCredential).toHaveBeenCalledWith(expect.anything());
  expect(r).toEqual({ uid: 'u-test' });
});
it('reports cancellation separately from failure', async () => {
  (GoogleSignin.signIn as jest.Mock).mockRejectedValue({ code: '12500' });
  expect(await signInWithGoogle()).toEqual({ cancelled: true });
});
```

- [ ] **Step 2: Implement `googleAuth.ts`.** `GoogleSignin.configure({ webClientId, scopeProfiles: false })` — the `webClientId` is the OAuth **web client ID** from the Firebase console, not anything inside `google-services.json`; confirm the exact required shape against the v16 docs and the Expo 57 guide (AGENTS.md). Call `hasPlayServices()` first and surface a distinct user message when Play Services is absent.
- [ ] **Step 3: Implement `SessionProvider.tsx`** as the only place that composes the facts `decideGate` consumes:

```ts
const [uid, setUid] = useState<string | null>(null);
const [live, setLive] = useState<AccessResult | null>(null);
const [transportFailed, setTransportFailed] = useState(false);
const [lastGood, setLastGood] = useState<number | null>(null);
const decision = decideGate({ uid, live, transportFailed, lastGoodAuthorizedAt: lastGood,
                              nowMs: Date.now(), graceMs });
```
Register `onAuthStateChanged`; call `refresh()` on mount, on `AppState === 'active'` when `shouldRevalidate(last, now, 15 * 60_000)`, and via `retryNow()` from the blocked UI. Persist `{ lastGoodAuthorizedAt, expiresAt }` in AsyncStorage under `streamz.access.cache` — non-secret, and only ever read to decide grace, never to authorize.
- [ ] **Step 4: Write and run provider tests** for the three transitions that matter: signed-out → signed-in yields `needsSubscription`; a `unavailable` callable error after a prior success yields `offlineCached`; the same error with no prior success yields `needsServerContact`.
- [ ] **Step 5: Verify on device**, since this is where emulator-only assumptions die: sign in, sign out, sign in again, and confirm `$A logcat -d | grep -i firebase` shows no credential errors. Commit `feat: google sign-in and session gate provider`.

### Task 19: Callable wrappers

**Files:**
- Create: `src/firebase/subscriptions/api.ts`
- Test: `__tests__/subscriptions/api.test.ts`

**Interfaces:**
- Consumes: `functions().httpsCallable`, `getInstallationId`, `isTransportError`, `BRAND.applicationId`.
- Produces: `validate(): Promise<AccessResult>`, `activate(rawKey: string): Promise<ActivateResult>`, `JellyfinCredential | null` on the authorized result.

- [ ] **Step 1: Write the failing tests.** Assert that a transport error is *classified*, never swallowed: `validate()` must rethrow a tagged `TransportError` so `SessionProvider` can set `transportFailed`, while a `NOT_FOUND` key is a normal `ActivateResult` rather than an exception. Assert the plaintext key is sent to the callable but never written to AsyncStorage or logged.
- [ ] **Step 2: Implement** with a 10-second timeout on `validate()` so a hung network cannot leave the app stuck on `bootstrapping` — without it, the splash never resolves and the failure looks like a crash. Attach `appVersion` and `installationId` to every call so the server, not the client, owns reconciliation.
- [ ] **Step 3: Run → PASS. Commit** `feat: cloud function client wrappers with transport classification`.

### Task 20: Wire the gate into navigation and close the deep-link bypass

**Files:**
- Modify: `src/screens/SplashScreen.tsx:127-150`, `src/navigation/AppNavigator.tsx:78-124`, `src/navigation/types.ts:9-42`, `src/components/party/PartyLinkHandler.tsx:23-31`, `App.tsx:40`
- Test: `__tests__/navigation/gateRouting.test.ts`

**Interfaces:**
- Consumes: `useSession()`, `routeFor`, `FEATURES.tvLayout`.
- Produces: routes `Login`, `Subscription`, `Account`, `About`; and a `pendingDeepLink` ref that defers link handling until the gate says `Main`.

- [ ] **Step 1: Add the routes** to `types.ts` and `AppNavigator.tsx`, keeping `initialRouteName="Splash"` (`:71`) — the gate is a *decision inside* Splash, not a new initial route, which is what preserves the existing hydrate-then-navigate behaviour of the 13 providers.
- [ ] **Step 2: Replace the Splash decision.** Current code awaits `Promise.all([refreshServers, checkUpdatesSafe, prefetchHome])` at `:134-138` then `replace('Main')` at `:68`. New order: wait for `decision !== 'bootstrapping'`; `replace(routeFor(decision))`; call `prefetchHome()` **only** on the `Main` branch. That last point is the actual mechanism that stops content from loading before authorization — moving the gate without moving the prefetch leaves the hole open.
- [ ] **Step 3: Close the bypass.** `PartyLinkHandler.tsx:23-31` currently `navigation.reset()`s straight to `Main`. Change it to store the parsed link in a ref and return; a `useEffect` on `decision === 'ready' || 'offlineCached'` replays it. If watch party is disabled by `FEATURES.watchParty`, the replay routes to Home with the link discarded. Add this comment where the ref is declared: `// Gate-totality: a deep link must never bypass auth or subscription (spec §5, §11).`
- [ ] **Step 4: Write the routing test** with a mocked `useSession`, asserting `signedOut → Login`, `needsSubscription → Subscription`, `ready → Main`, `blocked → Blocked` and that `prefetchHome` is not called for any non-Main decision.
- [ ] **Step 5: Device proof of the bypass fix.** With the app signed out, run `$A shell "am start -a android.intent.action.VIEW -d 'streamz://party/ABC123'"` and confirm the screen shown is **Login**, not Main. Then sign in and re-run: expect Home (party disabled). This test is the difference between a gate and decoration — do not skip it.
- [ ] **Step 6: Commit** `feat: gate navigation behind auth and subscription, close deep-link bypass`.

---

## Stage 6 — Gate screens

### Task 21: Login screen

**Files:**
- Create: `src/screens/LoginScreen.tsx`
- Modify: `AppNavigator.tsx` (route), `global.css` (tokens only if a new shade is genuinely needed)

**Interfaces:**
- Consumes: `signInWithGoogle`, `useSession`, `BRAND`, `describeAuthError`, `components/ui/button`.
- Produces: route `Login`. No props.

- [ ] **Step 1: Build with existing primitives only** — `KeyboardAvoidingView`-free vertical stack, the StreamZ wordmark from Task 27, `BRAND.tagline`, one primary `Button` with `ButtonIcon` for Google, and `useToast()` for failures. Do not introduce a new component library or a hero illustration: the app's gluestack/NativeWind system is the design.
- [ ] **Step 2: Behaviour requirements, each testable:** the button is disabled while `signingIn` with a `ButtonSpinner`; `cancelled` shows no error at all (a cancelled sign-in is not a failure); `network-request-failed` and `cancel` produce different copy; after success the screen does nothing — `SessionProvider` drives navigation, so no manual `navigate()` here.
- [ ] **Step 3: Verify on device** at both sizes available (phone and, if reachable, tablet) plus one low-contrast check: white-on-accent text for the button label must be legible at 4.5:1. Screenshot it. If the screen looks like a generic Firebase starter rather than StreamZ, that is a rejection, not a pass.
- [ ] **Step 4: Commit** `feat: StreamZ login screen`.

### Task 22: Subscription activation screen

**Files:**
- Create: `src/screens/SubscriptionScreen.tsx`, `src/components/subscription/KeyInput.tsx`
- Modify: `AppNavigator.tsx`, `src/navigation/types.ts`
- Test: `__tests__/screens/subscriptionScreen.test.ts`

**Interfaces:**
- Consumes: `activate`, `looksPlausible`, `formatKeyForDisplay`, `describeActivation`, `useSession().refresh()`, `BRAND`.
- Produces: route `Subscription`, param-free.

- [ ] **Step 1: Write the failing state-matrix test.** Every state in the branding brief's §6 must render, and the two guards below are the ones a hand-built form usually forgets.

```ts
it('disables activate until the key is plausible', () => {
  render(<SubscriptionScreen />);
  type('FLK-7H3K');
  expect(activateButton().props.isDisabled).toBe(true);
  type('FLK-7H3K-92PQ-X8LM');
  expect(activateButton().props.isDisabled).toBe(false);
});
it('ignores a second submit while validating', async () => {
  const n = mockActivatePending();
  await submit(); await submit(); await submit();
  expect(n).toHaveBeenCalledTimes(1);
});
it.each([
  ['NOT_FOUND', /isn.t valid/i], ['ALREADY_BOUND', /another account/i],
  ['EXPIRED', /expired/i], ['REVOKED', /revoked/i],
])('surfaces %s as user copy', async (code, re) => {
  mockActivateResolves({ code, expiresAt: null });
  await submit();
  expect(screenText()).toMatch(re);
  expect(screenText()).not.toMatch(/Firebase|functions|\[object/);
});
it('shows the network copy without a stack trace on transport failure', async () => {
  mockActivateThrowsTransport();
  await submit();
  expect(screenText()).toMatch(/couldn.t verify your subscription/i);
});
it('routes onward after success without a manual restart', async () => {
  mockActivateResolves({ code: 'ACTIVATED', expiresAt: Date.now() + 864e5 });
  await submit();
  expect(refreshSpy).toHaveBeenCalled();
});
```

- [ ] **Step 2: Implement `KeyInput`.** `TextInput` with `autoCapitalize="characters"`, `autoCorrect={false}`, `keyboardType="ascii-capable"`, `textContentType` unset, `maxLength={20}`, `returnKeyType="go"` submitting on Enter. Format to `FLK-XXXX-XXXX-XXXX` **on change**, storing the raw normalized body separately so display formatting never corrupts what is sent (branding brief §5). Minimum 48 dp touch target.
- [ ] **Step 3: Implement the screen**, reusing `JoinPartyScreen.tsx:263-318` as the structural reference because it is the app's existing code-entry form: `VStack space="xs"` label → `Input`/`InputField` → inline `<Text size="sm" className="text-destructive">` → `Button` with `ButtonSpinner`. Layout: wordmark, `Welcome to StreamZ`, one sentence explaining a key is required, the input, Activate, a divider, `Need a subscription?` with support Telegram (`BRAND.supportTelegramUrl`) and email (`BRAND.supportEmail`) as real links, then `Privacy Policy` to Task 28. No invented content, no disabled placeholder buttons, no fake "Contact us" that goes nowhere.
- [ ] **Step 4: Success transition** — a short scale/checkmark animation via the already-present `@legendapp/motion`, then `refresh()`. Keep it under 400 ms; it must feel like a door opening, not a screensaver.
- [ ] **Step 5: Run → PASS. Device check:** keyboard must not cover the input or the button (`adjustResize` at `AndroidManifest.xml:32` is assumed — verify by opening the keyboard and screenshotting), and hardware Back from here must not land on Main.
- [ ] **Step 6: Commit** `feat: subscription activation screen with full state matrix`.

### Task 23: Account screen and blocked state

**Files:**
- Create: `src/screens/AccountScreen.tsx`, `src/screens/BlockedScreen.tsx`
- Modify: `src/screens/SettingsScreen.tsx:91-184` (add one `MenuRow` for Account)

**Interfaces:**
- Consumes: `useSession`, `signOut`, `BRAND`, `MenuRow`, `ConfirmDialog`.
- Produces: routes `Account`, `Blocked`.

- [ ] **Step 1: `AccountScreen`** shows display name, email, avatar, subscription status, days remaining computed from `expiresAt` and `serverTimeMs` (never from the local clock), installation id truncated to 8 chars with a "this is not your hardware id" caption, and sign-out behind `ConfirmDialog`. Sign-out calls `signOut()` and lets `SessionProvider` navigate.
- [ ] **Step 2: `BlockedScreen`** renders for `blocked` and `needsServerContact` with different copy — the first says the subscription is not active and links support, the second says the device could not reach the server and offers a `retryNow()` button. Do not merge them: a user with a revoked subscription and a user on a train with no signal need different answers.
- [ ] **Step 3: Device check:** expired key → Blocked; airplane mode after a prior success → Main with a visible "offline" notice from `offlineCached`; no signal on first launch → Blocked/needsServerContact. Commit `feat: account and blocked screens`.

---

## Stage 7 — Analytics

### Task 24: App events via GA4

**Files:**
- Create: `src/firebase/analytics/appEvents.ts`
- Modify: `src/screens/SearchScreen.tsx`, `src/hooks/useMyList*`, `src/screens/DetailScreen.tsx`, `PlayerCore.tsx` event callbacks
- Test: `__tests__/analytics/appEvents.test.ts`

**Interfaces:**
- Produces: `logContentOpen(item)`, `logSearch(term)`, `logWatchlistChange(kind, item)`, `logPlayback(kind, item)`, `logSubscriptionActivated()`, all thin wrappers over `analytics().logEvent`.

- [ ] **Step 1: Write the failing test** asserting the privacy line is enforced structurally, not by policy prose: every logged parameter set is an allowlist, and no event may carry a key, token, email, or `installationId`.

```ts
it('never attaches identifying or secret parameters', () => {
  logContentOpen({ contentId: 'c1', title: 'T', contentType: 'movie' });
  const [, params] = (logEvent as jest.Mock).mock.calls[0];
  const keys = Object.keys(params).sort();
  expect(keys).toEqual(['contentId', 'contentTitle', 'contentType']);
});
it('uses one event name per playback transition', () => {
  logPlayback('start', item); logPlayback('pause', item);
  expect(names()).toEqual(['playback_start', 'playback_pause']);
});
```

- [ ] **Step 2: Implement.** GA4 already measures `app_open`, `session_start` and background transitions automatically, so **do not** log those manually — duplicating them would double-count the very numbers §19 wants to read (spec §15). Call `disableAdvertisingId()` from Task 9 during init before the first event.
- [ ] **Step 3: Run → PASS. Commit** `feat: GA4 app event wrappers`.

### Task 25: Watch-session recorder

**Files:**
- Create: `src/firebase/analytics/watchSession.ts`
- Modify: `src/components/player/PlayerCore.tsx` at the existing autosave seam `:936-959`
- Test: `__tests__/analytics/watchSession.test.ts`

**Interfaces:**
- Consumes: `ContentProvider` item identity (Task 26), `getInstallationId`, `useSession().uid`, Firestore `watchSessions`.
- Produces: `startSession(item, opts)`, `markPosition(positionMs, durationMs)`, `finishSession(reason)`, `flushOnBackground()`.

- [ ] **Step 1: Write the failing tests** for the three rules the brief cares about — no per-second writes, correct ownership, clean finalize.

```ts
it('creates exactly one open session per playback', async () => {
  await startSession(item); await startSession(item);
  expect(addDocSpy).toHaveBeenCalledTimes(1);
});
it('batches progress to at most one write per 60s', async () => {
  await startSession(item);
  for (let t = 0; t < 600; t += 5) { await advance(5000); markPosition(t * 1000, 600_000); }
  expect(updateSpy).toHaveBeenCalledTimes(10);   // 600s / 60s
});
it('finalizes once, on unmount and on background, never twice', async () => {
  await startSession(item); await finishSession('ended'); await finishSession('background');
  expect(finalizeSpy).toHaveBeenCalledTimes(1);
});
it('stamps the uid from the verified session, not from the caller', async () => {
  await startSession(item);
  expect((addDocSpy.mock.calls[0] as any)[1]).toMatchObject({ uid: 'u-test', state: 'open' });
});
```

- [ ] **Step 2: Implement** writing only `uid`, `sessionId = \`${uid}__${startedAt}\``, `state: 'open'`, `startedAt`, `positionMs`, `durationMs`, `watchDurationMs`, `contentId`, `contentTitle`, `contentType`, `installationId`, `appVersion`. Accumulate `watchDurationMs` from observed playing intervals rather than wall clock, so a paused screen does not inflate watch time. `finishSession` sets `state: 'finalized'`, `endedAt`, `completed = completionPercentage >= 0.9`, `completionPercentage` — this is the write that Task 16's trigger reacts to.
- [ ] **Step 3: Hook it at the existing seams only:** `PlayerCore.tsx:943-947` (throttled autosave) forwards `markPosition`, `:949-959` (unmount save) forwards `finishSession('unmount')`, and one `AppState` listener forwards `flushOnBackground()`. Do not restructure the player (§33 of the brief). Add `// analytics seam` where each hook lands.
- [ ] **Step 4: Device proof:** play 3 minutes, background, resume, finish. In the emulator Firestore, assert one `watchSessions` document, `state: 'finalized'`, and one `userDailyStats` doc with the increment. Then kill the app mid-playback, wait past `staleSessionMinutes`, and confirm the sweeper finalized it. Commit `feat: batched watch-session recorder on the existing player seams`.

---

## Stage 8 — Content seam, cleanup, branding

### Task 26: `ContentProvider` interface and the sample provider

**Files:**
- Create: `src/services/content/types.ts`, `src/services/content/SampleContentProvider.ts`, `src/services/content/useContentProvider.ts`
- Modify: `src/services/playbackHeaders.ts:6-21`, `src/screens/PlayerScreen.tsx:443-455,469-554`, `src/screens/DetailScreen.tsx:334-497`, `src/components/DownloadResolverHost.tsx:38-88`, `src/hooks/useServers.tsx:20,95-96,312-330,481-484`, `src/hooks/useSubtitles.ts:92-93`, `src/config/env.ts`
- Test: `__tests__/content/sampleProvider.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ContentProvider {
  readonly id: 'sample' | 'jellyfin';
  homeRows(): Promise<Row[]>;
  search(term: string): Promise<MediaItem[]>;
  resolveStream(item: MediaItem, season?: number, episode?: number): Promise<ResolvedStream>;
  subtitles(item: MediaItem, source: MediaSource): Promise<SubtitleTrack[]>;
}
```
- Consumes unchanged: `MediaItem`, `MovieDetails`, `Episode` from `src/types/index.ts` (**frozen** — decision 7), `ResolvedStream` from `DownloadService.ts:48-114`.

- [ ] **Step 1: Write the failing test** asserting the provider contract and that `MediaItem` shape is not widened beyond an optional `providerId`: `resolveStream` returns `{ url, headers?, isHls }`; `homeRows` returns rows whose items all carry `providerId: 'sample'`.
- [ ] **Step 2: Implement `SampleContentProvider`** over `EXPO_PUBLIC_SAMPLE_VIDEO_URL` (already at `env.ts:33-35` and currently unused), exposing two rows so Home is not empty, and returning the Sintel trailer for every `resolveStream`. Subtitles return `[]` — the existing subtitle UI must degrade to "no subtitles" rather than error, which is itself worth verifying.
- [ ] **Step 3: Make the scraper unreachable.** Replace the `ServerResolver = 'webview'|'streamflix'|'flixquest'` discriminator and its guards with a single provider lookup, and delete the `useServers.tsx:95-96` remote fetch of `servers/list.json`. Route `PlayerScreen`'s resolver effect and `DownloadResolverHost` through the provider. Keep `FlixQuestService.ts`, `WebViewScraper.tsx`, `StreamflixService.ts` **files on disk but unreferenced** — deleting them is Phase 1B, once Jellyfin replaces them; deleting them here would leave Home with no source at all. Prove unreachability with `grep -rn "FlixQuest\|WebViewScraper\|StreamflixService" src/ | grep -v "^src/services/"` → zero hits.
- [ ] **Step 4: Verify on device:** a title plays Sintel through `PlayerCore`, a download completes via the existing HLS path, and the Task 25 recorder produces a finalized session for it. Commit `feat: content provider seam with sample provider, scraper unreachable`.

### Task 27: Removals, feature flags, and brand assets

**Files:**
- Delete: `src/services/UpdateService.ts`, `src/components/UpdateChecker.tsx`, `.github/workflows/build-ios.yml`
- Modify: `App.tsx:57`, `src/screens/SettingsScreen.tsx:178-184`, `src/config/env.ts:66-67`, `src/navigation/TabNavigator.tsx:20-26,66`, `src/navigation/AppNavigator.tsx:85`, `src/components/FlickLogo.tsx`, `src/components/splash/FlickSwoopLogo.tsx:360`, `AppNavigator.tsx:42-52`, `global.css`, `res/mipmap-*/ic_launcher*`, `res/drawable/tv_banner`, `assets/applogo/*`
- Create: `src/components/StreamZLogo.tsx`, `src/components/PrivacyPolicyContent.ts`

**Interfaces:**
- Consumes: `BRAND`, `FEATURES`, `LEGAL`.
- Produces: route `About`; `StreamZLogo` used by `AppHeader.tsx:86` and the splash.

- [ ] **Step 1: Delete the update path entirely** — `UpdateService.ts`, `UpdateChecker.tsx`, its `App.tsx:57` mount, the Settings row, and `UPDATE_CONFIG` at `env.ts:66-67`. It pointed at the upstream author's releases and used `REQUEST_INSTALL_PACKAGES`; leaving it would push users to install *his* APK. Also delete `build-ios.yml`, which builds the upstream repo with live credentials in it.
- [ ] **Step 2: Hide deferred surfaces by flag, not deletion.** `TabNavigator.tsx:66` reads `FEATURES.liveTv`; `AppNavigator.tsx:85` picks `TabNavigator` when `!FEATURES.tvLayout`; watch party entries read `FEATURES.watchParty`. Keep `TVNavigator`, `components/tv/**`, `DaddyLiveService`, `LiveTvScreen`, party code compiled and reachable only by flipping a flag.
- [ ] **Step 3: Remove the debug toggle row** at `SettingsScreen.tsx:178-184`. Keep `usePlayerDebugSettings` and its `App.tsx:48` provider — `PlayerScreen.tsx:887-940` and `ServerLoadingSideNav.tsx:30` still consume it, and removing the provider now breaks the build. Leave a one-line comment naming Phase 1B as when it goes.
- [ ] **Step 4: Collapse brand tokens.** Create `StreamZLogo.tsx` using `BRAND.accentHex`; delete the hardcoded `#E50914` in `FlickLogo.tsx` and the duplicated nav theme at `AppNavigator.tsx:42-52`, pointing both at `BRAND`. Keep the colour value identical — decision 5 freezes it.
- [ ] **Step 5: Assets.** Generate a StreamZ wordmark and the adaptive icon set (`foreground`, `background`, `monochrome`) plus `tv_banner`, all in the existing dark aesthetic with the frozen accent. Icons must be supplied at every density the project already uses; verify the launcher label and icon on the device rather than trusting the file copy.
- [ ] **Step 6: Branding sweep, reviewed not blind.**

```bash
grep -rn "Flick\|flickv4\|com\.flickv4" src/ assets/ android/ app.json 2>/dev/null \
  | grep -v "patches/\|LICENSE\|README\|flick\.\|flick-downloads\|FlickMacRtc"
```
Read every line: user-facing copy becomes StreamZ, GPL attribution stays (`CreditsScreen.tsx:59-64`, `UpdateService.ts:20` is gone with the file), internal `flick.*` storage keys stay. Record each retained hit with its reason in the task report — an unexplained retention is a bug.
- [ ] **Step 7: Commit** `feat: StreamZ branding, remove update path and debug surfaces`.

### Task 28: About, open-source, privacy, and the GPL block

**Files:**
- Create: `src/screens/AboutScreen.tsx`
- Modify: `src/screens/CreditsScreen.tsx` (fold into About), delete `DisclaimerScreen.tsx` reference from Settings, `src/screens/SettingsScreen.tsx` rows
- Test: `__tests__/screens/about.test.ts`

**Interfaces:**
- Consumes: `BRAND`, `LEGAL`, `APP_VERSION` (`src/utils/appVersion.ts`).
- Produces: route `About`, plus `PrivacyPolicyContent` rendered by the Subscription screen's link.

- [ ] **Step 1: Write the failing test** asserting the legally-mandatory content is present and that the false disclaimer is gone:

```ts
it('keeps GPL attribution while rebranding', () => {
  const t = renderAbout();
  expect(t).toMatch(/Wendale Franz Dy/);
  expect(t).toMatch(/github\.com\/sheeshcake\/Flickv4/);
  expect(t).toMatch(/GPL-3\.0/i);
});
it('credits the sample media actually shipped', () => {
  expect(renderAbout()).toMatch(/Sintel.*(Blender Foundation|CC-BY)/i);
});
it('drops the false no-hosted-content disclaimer', () => {
  expect(renderAbout()).not.toMatch(/does not host|search engine/i);
});
```

- [ ] **Step 2: Implement About** with `MenuRow` sections: app name and version, description, developer/organisation line, support email and Telegram from `BRAND`, Privacy Policy, Open source & licences (the folded Credits entries 1-6 from `CreditsScreen.tsx:23-65` **plus** the attribution from `:59-64`), and the sample-media credit from `LEGAL`.
- [ ] **Step 3: Privacy copy** in `PrivacyPolicyContent.ts`, factual and sectioned: Google sign-in identity; subscription key state and binding; installation identifier and that it is not a hardware id; in-app activity through Firebase Analytics (name GA4); watch-session records and which fields; media served from a private Jellyfin server whose access token is held in device secure storage; that the app is not for sale and no payment data is collected. Mark it `// DRAFT — factual description, not legal advice; owner to review before distribution.` Do not claim nothing is collected, and do not invent jurisdictional terms.
- [ ] **Step 4: Run → PASS. Commit** `feat: about screen with GPL attribution, privacy draft, sample credit`.

### Task 29: CI that actually checks this

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Add a pull-request workflow** on Node 20 + JDK 17 (matching `.github/actions/setup-flick/action.yml:26-30`) running, in order: `npm ci`, `npm run typecheck`, `npx jest __tests__ --ci`, `npx -y firebase-tools@latest emulators:exec --only firestore "npx jest __tests__/rules --ci"`.
- [ ] **Step 2: Never reuse the upstream release workflow.** It hardcodes a TMDB key and a GitHub token. If the repo gains secrets later, they come from repository secrets, and the workflow must not `echo` any of them.
- [ ] **Step 3: Repoint the remote before pushing anything:** `origin` currently targets `sheeshcake/Flickv4`. `git remote set-url origin <your fork>`, keep the repo public (GPL, decision 10). Do not push until the owner says so.
- [ ] **Step 4: Commit** `ci: typecheck, unit tests, and rules tests on pull request`.

### Task 30: Phase 1A verification pass

**Files:** none. This task produces evidence, not code.

- [ ] **Step 1: Full clean build** `cd android && ./gradlew clean assembleDebug assembleRelease` — both must succeed.
- [ ] **Step 2: Run the whole suite** `npm test` and the rules suite under the emulator; record pass counts verbatim.
- [ ] **Step 3: Work the spec §21 Phase 1A list item by item on the physical device** — all sixteen items, including the five privilege-escalation attempts, app restart, offline grace entry *and* forced exit, keyboard-not-covering-input, hardware Back from Login and Subscription, and reinstall-with-rotation-ceiling.
- [ ] **Step 4: Branding sweep one more time**, now that screens exist: `grep -rn "Flick" src/ android/app/src/main/res/` and read every hit. Only protected references (§Global Constraints) may remain.
- [ ] **Step 5: Report** with the brief's §34 shape: files created/modified/deleted, Firebase services used, collections and rules, auth flow, subscription flow, analytics events, remaining limitations, and the exact console configuration still outstanding. Anything unverified is listed as unverified rather than described as working.

---

## Appendix A — Owner setup checklist, in dependency order

Google Sign-In is blocked until items 1-6 are done; nothing in Tasks 18-22 can be verified before that. Items 7-9 can happen in parallel with Stage 2. Item 10 is the last one and is irreversible-ish.

1. **Blaze plan** on Firebase project `streamz-c98b9` (console → Usage and billing → upgrade). Cloud Functions, Firestore triggers and scheduled jobs cannot deploy on Spark. A card is required even at near-zero expected cost. **Blocks everything from Task 11 onward.**
2. **Confirm project ownership** — that this project is yours and not shared with other work.
3. **Register the Android app** with package name exactly `stream.z`.
4. **Add both SHA-1 fingerprints** — debug (from `android/app/debug.keystore`, captured in Task 1 Step 5) and release (from the new keystore, Task 10 Step 1). This is what populates the currently empty `oauth_client` array.
5. **Enable Authentication → Sign-in method → Google**, then note the **OAuth web client ID** it creates. `GoogleSignin.configure({ webClientId })` needs that ID; `google-services.json` alone is not enough and is the single most common reason sign-in fails after a correct setup.
6. **OAuth consent screen** — external, product name StreamZ, support and developer emails set, scopes `email` + `profile` only.
7. **Create Firestore** in production mode, nearest region. Never enable test rules; Task 11 ships real ones.
8. **Re-download `google-services.json`** after items 3-5 and place it at `android/app/google-services.json`. Confirm `package_name == "stream.z"`.
9. **Restrict the mobile API key** in Google Cloud console → APIs and services → Credentials: Android apps, package `stream.z` plus the SHA-1s from item 4.
10. **Provision your own TMDB v4 key.** The key committed in upstream `build-ios.yml:27-30` belongs to the original author and is already public in his history — do not use it and do not try to "rotate" it; it isn't yours. Task 27 deletes that workflow.
11. **Jellyfin (for Phase 1B, not blocking 1A):** server installed and reachable, version recorded for the spec §13 pre-flight, and a dedicated low-privilege service account created for Functions.
12. **Set Functions secrets** once `functions/` exists: `npx firebase-functions@latest` is not needed — use `npx -y firebase-tools@latest functions:secrets:set JELLYFIN_BASE_URL` and `...JELLYFIN_SERVICE_PASSWORD`. Never plain env, never committed.
13. **Create your own GitHub fork and repoint `origin`.** The clone still targets `sheeshcake/Flickv4`; nothing gets pushed until that is fixed, and the repo must stay public to satisfy GPL.
14. **Decide the first key batch** — how many keys, what duration — so Task 15's `generateKeys` can be invoked and Task 22 tested end to end with a real key.

Support contacts are already fixed in the plan: `Mirmajid@proton.me` and Telegram `@Mirmajid01`, both read only from `src/config/brand.ts`.

---

## Sequencing

```
T1 ──▶ T2 ──▶ T3 ──▶ T5 ──▶ T6 ──▶ T7 ──▶ T8
                 T4 ─────────────────────────▶ T9 ──▶ T10   (needs Appendix A 1-9)
T5 ──▶ T11 ──▶ T12 ──▶ T13 ──▶ T14 ──▶ T15 ──▶ T16 ──▶ T17
T8,T13 ──▶ T18 ──▶ T19 ──▶ T20 ──▶ T21 ──▶ T22 ──▶ T23
T20 ──▶ T24 ──▶ T25 ; T5 ──▶ T26 ; T3 ──▶ T27 ──▶ T28 ; T29 ; T30
```

Tasks 1-8 and 11-17 need no device. Tasks 9, 10, 18, 20-23, 25-27 and 30 do.
