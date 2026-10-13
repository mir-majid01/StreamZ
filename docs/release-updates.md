# In-app updates (P20)

How a StreamZ build decides that it is too old, and what it demands before handing an APK to the
Android installer. Written for the person who publishes releases, so the procedure at the bottom is
the operative part.

**Production update checks are off.** `FEATURES.updateChecker` (`src/config/features.ts`) is
`false`, and the updater additionally requires a repository named through the environment
(`EXPO_PUBLIC_UPDATE_REPO_OWNER` + `EXPO_PUBLIC_UPDATE_REPO_NAME`). Either condition alone keeps it
inert. Nothing in this document changes that until the gates at the end are met.

## What decides "mandatory"

Firestore `releasePolicy/latest` is the authority. Version ordering lives in
`src/utils/versions.ts` (`MAJOR * 1e6 + MINOR * 1e3 + PATCH`, pre-release suffix ignored, so
`1.10.0 > 1.9.0` and `2.0.1-beta == 2.0.1`). The installed version comes from the native binary, so
bumping `APP_VERSION` in `.env` cannot disguise an outdated APK.

| Installed vs policy | Result |
| --- | --- |
| below `minimumSupportedVersion` | `mandatory` — the app will not continue past the update screen |
| at or above the minimum, below `latestVersion` | `optional` — dismissable |
| at or above `latestVersion` | `upToDate` |
| no usable policy | `unknown` — **not** presented as up to date, and never blocks |

GitHub Releases are only a source of notes and a download URL. Whether an update is *required*, and
what makes a downloaded file trustworthy, comes from Firestore: a repository the app can read is
not an authority over its own version floor.

## Schema

One document, `releasePolicy/latest`:

| Field | Type | Required | Rule / parser requirement |
| --- | --- | --- | --- |
| `minimumSupportedVersion` | string | yes | `n.n.n`; below `latestVersion` |
| `latestVersion` | string | yes | `n.n.n` |
| `apkUrl` | string | yes | `https://` only |
| `apkSha256` | string | yes | 64 lowercase hex — SHA-256 of the published APK bytes |
| `signingCertSha256` | string | yes | 64 lowercase hex — SHA-256 over the DER signing certificate, i.e. what `keytool -list` prints as `SHA256:` and `apksigner verify --print-certs` prints as the certificate digest |
| `releaseNotes` | string | yes | shown verbatim |
| `apkSizeBytes` | integer | yes | positive; lets a truncated download be told apart from a substituted one |
| `publishedAt` | string | no | display only |

Two rules exist because Firestore cannot compare version strings, so ordering is enforced twice
outside the rules: the publishing job refuses a policy whose minimum exceeds its latest, and
`parseReleasePolicy` rejects the same document on the device rather than obeying a mistake that
would lock every installed build out.

`signingCertSha256` is required, not optional. A policy that names no certificate cannot answer
"who signed this file", and installing on that basis is the unknown-signing-identity case the
release process is meant to refuse.

## Failure behaviour

| Outcome | Meaning | Blocks? | May use cache? |
| --- | --- | --- | --- |
| `ok` | document read and parsed | only if mandatory | — |
| `missing` | reachable, no such document | no | no |
| `forbidden` | rules refused the read | no | no |
| `malformed` | read succeeded, fields unusable | no | no |
| `unreachable` | offline, timeout, server error | only from cache inside grace | **yes** |

The cache is written only from a successful read. The grace window is
`UPDATE_CONFIG.OFFLINE_GRACE_MS` (`EXPO_PUBLIC_UPDATE_OFFLINE_GRACE_HOURS`, default 72, capped at
168), so an outage costs a user an afternoon instead of locking them out permanently — and a pulled
or withdrawn release is obeyed again the next time the network is up. A cached minimum is never
honoured across `forbidden` or `missing`: a rules change and a withdrawal are both the publisher
changing their mind, and a stale cache must not keep enforcing the old answer.

The read is bounded (`POLICY_TIMEOUT_MS`, 8 s) so a hung Firestore call cannot hold app startup
open.

## Before the installer is offered

A finished download is not evidence of authenticity. `evaluateApkIntegrity`
(`src/utils/releasePolicy.ts`) refuses unless every published expectation is answered:

- digest matches the policy's `apkSha256`, measured by streaming the file on-device;
- declared package name is exactly `stream.z`;
- signing certificate matches the policy's `signingCertSha256`;
- byte count equals `apkSizeBytes` when the policy states one.

Any measurement that came back null is a refusal (`not_measured`), including the case where the
native inspection did not run at all. There is no path where a missing check is treated as a passed
check.

## Publishing procedure

1. Bump `APP_VERSION` and `ANDROID_VERSION_CODE` (the code must increase; Android refuses a
   lower-numbered install over an existing one).
2. Build the release APK. CI computes `sha256sum` over the built file in the same run that produced
   it, verifies the digest file is present, and uploads it as `streamz-release-<run>-sha256`. The
   digest is never typed by hand and never reused from an earlier release.
3. Publish the APK as a GitHub Release asset. Download URLs are only constructed after the release
   exists — `mir-majid01/StreamZ` had no releases at the time of writing, so a URL pointing at one
   would be a guess.
4. Write `releasePolicy/latest` with the digest of the file actually published, the certificate
   fingerprint of the keystore that signed it, and the byte count. The rules validate the shape at
   write time, so a document that could not survive a verified install is rejected there instead of
   reaching phones.
5. Confirm on a device: the update screen appears, the download completes, the three checks pass,
   and the installer opens. Android shows a one-time "allow installs from this app" prompt; no
   in-app code can skip it, and nothing here installs silently.

To make a release mandatory, lower `minimumSupportedVersion`. To stop gating, delete or correct the
document — devices read `missing` and continue working.

## What is not finished

These are blockers, not caveats to write around:

- **No StreamZ signing identity exists yet.** `android/app/build.gradle` sets
  `signingConfigs.debug` for `buildTypes.release`, and `android/app/debug.keystore` is committed.
  Every CI APK therefore carries the public Android debug certificate
  (`CN=Android Debug`, `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`).
  Pinning that in a policy would be theatre: the key is public, so it proves nothing about who built
  the file, and the pin would have to be broken the moment a real keystore appears. A release
  keystore, held in CI secrets rather than committed, has to come first.
- **Local-module autolinking is unproven.** `modules/apk-integrity` (streaming SHA-256, package
  name, certificate fingerprint) is written, but running the same resolver the Gradle plugin uses —
  `expo-modules-autolinking resolve --platform android` — returns the same 20 packages with and
  without it, including when `./modules` is passed explicitly. Making a committed `android/` project
  pick up a local module may need a prebuild or a hand-edited `settings.gradle`; neither was done,
  because both are the risky native changes this phase said to stop and report first. Until the
  module actually compiles into the APK, integrity checks return `not_measured` and installation is
  refused.
- **Firestore rules are prepared, not deployed.** The `releasePolicy/{docId}` block in
  `firestore.rules` grants public read of exactly `releasePolicy/latest` (nothing else in the
  collection; `/config` stays sign-in only) and admin-only writes with shape validation. Deploying
  it changes the production project's authority, so it waits for an explicit go-ahead plus a review
  of the diff.
- The design reference for the update popup was not supplied, so the mandatory screen reuses the
  existing modal rather than an invented layout.

## Gates before `updateChecker` may be enabled

1. A real release keystore, with its certificate fingerprint recorded outside the repo.
2. The native integrity module compiling and linking in CI.
3. A GitHub Release that actually exists, with the APK as an asset.
4. `releasePolicy/latest` deployed to the intended Firebase project, rules reviewed.
5. Integrity checks verified on a physical device: correct APK passes; a re-hashed, re-signed, or
   truncated APK is refused with the reason shown.
6. Grace-window behaviour verified with the network off and the rules deliberately mis-scoped.
7. Rollback path tested: `minimumSupportedVersion` raised too high is recoverable by editing the
   document.
8. Release procedure above executed end-to-end by someone other than the implementer.
