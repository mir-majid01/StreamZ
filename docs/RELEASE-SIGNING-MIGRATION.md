# Release signing: current state, migration cost, and the plan

Status: **signing guard applied; production key generated 2026-10-18, secrets not yet in CI.**
The Android build keeps the debug key for debug builds only, requires environment-provided release
signing inputs, and fails before any release task can produce an artifact without them. CI decodes
its protected keystore into a temporary runner path and removes it after Gradle.

The release key exists now and is **not** in this repository — a committed keystore is the exact
thing this document argues against:

| | |
| --- | --- |
| File | `C:\Users\HP\streamz-release-key\streamz-release.keystore` (2,762 bytes, outside the repo) |
| Alias | `streamz-release` |
| Certificate | `CN=StreamZ, OU=Releases, O=StreamZ, C=IN`, RSA 2048, valid 2026-10-18 → 2054-03-05 |
| Certificate SHA-256 | `9a883be09b1e3c90f26e6c907b86338078d25b6940b484c9992b24b7c7c511d4` |
| Password | `keystore-password.txt` beside it (same value for store and key). Move it into a password manager and delete that file. |
| Still owed by the owner | Four repository secrets — `RELEASE_KEYSTORE_BASE64`, `RELEASE_KEYSTORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD` — then one CI run produces the first release-signed APK |

Two consequences, both irreversible in one direction. **Losing the keystore or its password ends
every remote update path for every install carrying this certificate** — Android has no key reset.
And because the fingerprint above differs from the debug certificate that signs every APK handed
out so far (§2), a release-signed build **cannot** install over them: `INSTALL_FAILED_UPDATE_INCOMPATIBLE`,
uninstall required, with the losses listed in §3. `signingCertSha256` in `releasePolicy/latest` must
be this value, and the updater will keep refusing any APK whose measured certificate is not it.

## 1. What signs StreamZ today

| Fact | Evidence |
| --- | --- |
| Release builds cannot run without a release key | `android/app/build.gradle` keeps `signingConfigs.debug` for `buildTypes.debug` only, and requires `STREAMZ_RELEASE_STORE_FILE`, `STREAMZ_RELEASE_STORE_PASSWORD`, `STREAMZ_RELEASE_KEY_ALIAS`, and `STREAMZ_RELEASE_KEY_PASSWORD` for release tasks |
| The keystore is committed to git | `git ls-files` returns `android/app/debug.keystore` and nothing else matching `*.keystore`/`*.jks` |
| Its identity | `CN=Android Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US`, valid 2014-01-01 → 2052-05-01, certificate SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c` |
| CI requires protected release signing inputs | `.github/workflows/android-ci.yml` and `.github/workflows/build.yml` require `RELEASE_KEYSTORE_BASE64`, `RELEASE_KEYSTORE_PASSWORD`, `RELEASE_KEY_ALIAS`, and `RELEASE_KEY_PASSWORD`, decode only to the runner temp directory, and remove the file after Gradle |
| Every APK so far carries that one certificate | Measured, not inferred — see §2 |
| The admin app is separate | `stream.z.admin` is installed too and is signed by a *different* debug certificate (`65175c193ea1a6558bf06bcd315e0b324def6b43aac7385246f4b4ed09cc2c60`), from its own project. A `stream.z` key change does not touch it, and it likewise has no production key |

Consequence for the updater: the app requires a `signingCertSha256` in the release policy and refuses
to install on a mismatch (`src/utils/releasePolicy.ts` → `evaluateApkIntegrity`). Pinning the debug
certificate would satisfy the code while proving nothing about who built the file, because that key
is public and sits in the repository. So the publisher-authenticity guarantee is currently vacuous,
and `FEATURES.updateChecker` stays `false` for that reason as much as any other.

## 2. What is installed on the phone right now

Measured by pulling the installed package and verifying it (`pm path stream.z` → `base.apk` →
`apksigner verify --print-certs`):

```
bytes    : 81,676,398
sha256   : cc24aca2286e4646f9abfdc3857bddddff47712386060771770f74be5d86963b   (= CI run 39 artifact)
signer   : CN=Android Debug … SHA-256 fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c
versionName 0.1.0   versionCode 1   targetSdk 36   minSdk 24
```

The digest matches run 39's published `app-release.apk` byte for byte, so the build the owner
tested is the one containing the Live TV source-type fix — which is why that fix can be reported as
**shipped and insufficient**: the failures continued on a build that already has it.

**Who is affected:** the owner's Infinix X6876, plus every person who was handed any CI artifact to
date. They all hold the same debug certificate, because there is only one and it is in the repo.
There is no way to enumerate installs from here — the app records no install telemetry beyond
per-account device binding — so the honest answer to "have friends installed it" is *unknown*, and
the plan must assume **yes**.

## 3. What a new signing key costs the people who already installed it

Android refuses to install an APK signed by a different certificate over an existing package:
`INSTALL_FAILED_UPDATE_INCOMPATIBLE`. There is no override, no downgrade path, and no way for the
app to migrate the key itself. The only route is **uninstall, then install the production build**.

Uninstalling deletes the app's private storage. Concretely, for each person:

| Lost on uninstall | Why |
| --- | --- |
| Downloaded videos | `src/services/DownloadService.ts:517` writes to `${Paths.document.uri}downloads/<id>` — app-private storage, removed with the package |
| The saved activation key | `src/firebase/subscriptions/savedKey.ts` caches the plaintext per-uid in `SecureStore`; Android wipes it with the app. The key must be typed again, and only works if it is still valid and unbound elsewhere |
| The installation identity | `src/firebase/installation/installationId.ts` keeps `installationId` in `SecureStore`. A reinstall produces a **new** id, which the rules count as an installation rotation against `config/app.maxInstallationRotations`. Someone already at the ceiling would be refused re-activation with `CEILING` and would need an admin to raise it or reset their user document |
| Sign-in session | Firebase Auth state is local; they must sign in with Google again |
| Local state | Continue-watching, My List, subtitle/audio settings, server preferences, the cached release policy — all AsyncStorage |

Server-side state survives: the `users/{uid}` subscription, the bound key, and the analytics rows
are in Firestore and are untouched. So the cost is re-login, re-activation, re-download, and — the
sharp edge — a possible rotation-ceiling refusal.

**Therefore:** do not switch the signing key until there is a production-signed build worth moving
to, and tell everyone who has an APK that the switch requires an uninstall. The first
production-signed release is the migration event; after it, in-place updates work normally and this
problem does not recur.

## 4. Plan — generation and custody (not yet executed)

1. Generate on this machine, **outside the repository**, into a directory that is not a git root:
   `keytool -genkeypair -storetype PKCS12 -keystore <outside>/streamz-release.p12 -alias streamz-release
   -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=StreamZ Release, O=<owner's name>, C=IN"`.
   RSA 4096 and ~27-year validity because the key must outlive every installed device, and
   `minSdk 24` devices cannot verify a signing key that has expired.
2. Set a strong store password and reuse it for the key password. The password is **not** stored in
   the keystore file and never in the repository.
3. Record the certificate fingerprint immediately:
   `keytool -list -v -keystore streamz-release.p12` → the SHA-256 that later goes into
   `releasePolicy/latest` as `signingCertSha256`.
4. Backups, at least two, both under the owner's control, each tested by restoring and listing the
   alias: (a) an encrypted local disk or VeraCrypt container, (b) a cloud copy encrypted with a
   passphrase independent of the cloud account (e.g. `age` or 7-Zip AES-256). Store the password in
   the owner's password manager, not beside the file.
5. **Recovery procedure, written down now:** losing this key means no further in-place update for
   anyone who has a build signed by it — the only path is uninstall and reinstall, exactly the cost
   in §3. There is no reset, no support ticket, no back door. If the key is ever lost or leaked, the
   replacement is: generate a new key, announce a clean-install release, and raise or reset
   `maxInstallationRotations` in `config/app` for affected accounts before asking them to reinstall.
6. If the key is ever compromised, the response is the same clean-install migration to a new key;
   the debug keystore in git is *already* public, which is the argument for never shipping another
   debug-signed build to anyone.

## 5. Wiring it so a debug fallback is impossible

The signing guard and CI wiring below are applied. Key generation and custody are intentionally still
separate from source control.

1. `android/app/build.gradle`: reads four environment values — `STREAMZ_RELEASE_STORE_FILE`,
   `STREAMZ_RELEASE_STORE_PASSWORD`, `STREAMZ_RELEASE_KEY_ALIAS`, `STREAMZ_RELEASE_KEY_PASSWORD` —
   and defines `signingConfigs.release` from them. Explicit release task names fail during Gradle
   configuration when any value is absent; the resolved task graph repeats the same check for broad
   invocations such as `assemble`. The guard belongs in Gradle rather than only in the workflow so
   local release commands are covered too, and so the failure cannot be bypassed by editing one YAML
   file.
2. `debug` is kept for `buildTypes.debug` only. Nothing in the repo should ever be able to produce a
   file that looks like a release and is debug-signed.
3. `.github/workflows/android-ci.yml` and `.github/workflows/build.yml`: store the keystore as a **protected** repository secret
   (`RELEASE_KEYSTORE_BASE64`) plus `RELEASE_KEYSTORE_PASSWORD`, `RELEASE_KEY_ALIAS`,
   `RELEASE_KEY_PASSWORD`. Decode to a temp file outside the workspace, pass the env vars to Gradle,
   delete it in `always()`. Add a step before the build that fails when the secret is empty — the
   existing pattern of writing `.env` from secrets and silently omitting unset ones is precisely the
   failure mode to avoid here.
4. Versioning, because the current scheme cannot express a release at all: `APP_VERSION` and
   `ANDROID_VERSION_CODE` are pinned to `0.1.0` / `1` in the workflow, so every build is identical
   and Android rejects a same-code reinstall. Make both inputs to `workflow_dispatch`, defaulting to
   values read from `package.json`/`app.json`, and add a step that refuses a `versionCode` less than
   or equal to the one already published in `releasePolicy/latest`.
5. Publication: after a build whose signing guard passed, run
   `scripts/publish-release-policy.mjs` (added in `6785f12`) against that APK. It measures the
   digest, the byte count and the certificate digest, refuses to invent a certificate it cannot
   read, refuses a minimum above the latest in both dimensions, prints the document, and only with
   `--apply` writes `releasePolicy/latest` — then reads it back and refuses to call the write
   successful unless the stored digest is the one it computed. The certificate it reads must be the
   new release key's, which is the check that makes the whole chain mean something.
6. The app already verifies all four before handing a file to the installer, and `UpdateModal` now
   reads the installer's result code instead of assuming. `FEATURES.updateChecker` stays `false`
   until a device has completed the whole loop: prompt → download → verify → install → updated
   version reported.

## 6. Verification required before any production-signed APK is given to anyone

1. `apksigner verify --print-certs` on the built APK reports the **new** certificate, not
   `fac61745…`.
2. The APK's digest, size and certificate equal what `releasePolicy/latest` says.
3. Install the production build on a device that has the debug build → confirm Android refuses with
   a signature mismatch (proving the guard is real, and rehearsing what users will see).
4. Uninstall, install the production build, sign in, activate, and confirm the app reports
   `upToDate` against its own published policy.
5. Publish a second production build with a higher `versionCode` and the same key, and confirm the
   in-app path downloads, verifies, and installs it over the first **without** a uninstall step.
6. Confirm a tampered or truncated download is refused: flip a byte, or serve a short file, and
   check the refusal names the reason rather than installing.

Steps 3–6 need the physical device and a real build, so they cannot be closed out locally.
