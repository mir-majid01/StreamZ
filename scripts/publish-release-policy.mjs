#!/usr/bin/env node
/**
 * Builds the `releasePolicy/latest` document for one APK, from measurements rather
 * than from memory.
 *
 * The app refuses to install anything this script cannot state, so every field here
 * is read out of the file: the digest, the byte count, and the SHA-256 of the signing
 * certificate. The certificate is the field that cannot be copied from a build log —
 * a checksum beside an APK proves the download was not corrupted, nothing more, and
 * only the signer answers who produced it.
 *
 * Dry run by default. `--apply` writes to Firestore and is the only step that touches
 * anything shared.
 *
 *   node scripts/publish-release-policy.mjs \
 *     --apk android/app/build/outputs/apk/release/app-release.apk \
 *     --url https://github.com/mir-majid01/StreamZ/releases/download/v0.2.0/streamz-0.2.0.apk \
 *     --version 0.2.0 --code 2 --min-version 0.1.0
 *
 * Add `--apply --project streamz-c98b9 --token "$FIREBASE_ACCESS_TOKEN"` to publish.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const die = (message) => {
  console.error(`publish-release-policy: ${message}`);
  process.exit(1);
};

const apkPath = arg('apk');
if (!apkPath) die('--apk <path> is required');
let bytes;
try {
  bytes = readFileSync(apkPath);
} catch {
  die(`cannot read ${apkPath}`);
}
if (bytes.length < 1024) die(`${apkPath} is ${bytes.length} bytes — that is not an APK`);

const sha256 = createHash('sha256').update(bytes).digest('hex');
const sizeBytes = Number(arg('size') ?? statSync(apkPath).size);
if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) die('--size must be a positive integer');

/**
 * The certificate digest, computed the way the device computes it.
 *
 * `apksigner` and `keytool` both print the SHA-256 of the DER certificate; the on-device
 * module hashes the same DER. Colon separators and case are normalised so a value copied
 * from either tool compares equal to the device's read-out.
 *
 * `apksigner` is the one that works on a modern build: release APKs are signed v2/v3 only,
 * and `keytool -printcert -jarfile` reads v1 (JAR) signatures, so it finds nothing on them.
 * On Windows the tool is `apksigner.bat`, which `execFile` will not resolve by bare name,
 * so the SDK search below looks for both spellings.
 */
const quote = (value) => `"${String(value).replace(/"/g, '')}"`;

const fromPosix = (p) =>
  process.platform === 'win32' && /^\/([a-zA-Z])\//.test(p)
    ? p.replace(/^\/([a-zA-Z])\//, (_, d) => `${d.toUpperCase()}:/`)
    : p;

const candidateTools = () => {
  const found = [];
  if (flag('apksigner')) found.push(fromPosix(arg('apksigner')));
  const sdkRaw = arg('sdk') ?? process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? null;
  const sdk = sdkRaw ? fromPosix(sdkRaw) : null;
  if (sdk) {
    const versions = readdirSync(join(sdk, 'build-tools'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
    for (const v of versions) {
      found.push(join(sdk, 'build-tools', v, 'apksigner.bat'), join(sdk, 'build-tools', v, 'apksigner'));
    }
  }
  found.push('apksigner', 'keytool');
  return found;
};

const readCertDigest = () => {
  for (const tool of candidateTools()) {
    const isKeytool = tool.endsWith('keytool') || tool.endsWith('keytool.exe');
    const invocation = isKeytool
      ? ['-printcert', '-jarfile', apkPath]
      : ['verify', '--print-certs', apkPath];
    // "certificate SHA-256 digest: <hex>" (apksigner) / "SHA256: <colon hex>" (keytool)
    const pattern = isKeytool ? /SHA256:\s*([0-9a-fA-F:]{64,})/ : /SHA-256 digest:\s*([0-9a-fA-F]{64})/;
    try {
      // Windows ships apksigner as a .bat, which CreateProcess will not run directly.
      const viaShell = /\.(bat|cmd)$/i.test(tool);
      const out = execFileSync(tool, viaShell ? invocation.map(quote) : invocation, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: viaShell,
      });
      const found = out.match(pattern);
      if (!found) continue;
      const hex = found[1].replace(/:/g, '').toLowerCase();
      if (/^[0-9a-f]{64}$/.test(hex)) {
        return { hex, from: isKeytool ? 'keytool' : 'apksigner', subject: (out.match(/certificate DN: (.*)/) ?? [])[1] ?? null };
      }
    } catch {
      /* tool absent, or this APK carries no v1 signature for keytool to read */
    }
  }
  return null;
};

const cert = readCertDigest();
if (!cert) {
  die(
    'could not read the signing certificate. Install apksigner (Android build-tools) or keytool, ' +
      'or pass --cert <64-hex>. A policy with no certificate is refused by every device, so this ' +
      'script will not invent one.',
  );
}

const version = arg('version');
const code = arg('code');
const minVersion = arg('min-version');
const minCode = arg('min-code');
const url = arg('url');
const notes = arg('notes') ?? '';
if (!version || !minVersion || !url) die('--version, --min-version and --url are required');
const SEMVER = /^\d+\.\d+\.\d+$/;
if (!SEMVER.test(version) || !SEMVER.test(minVersion)) {
  die('versions must be MAJOR.MINOR.PATCH — the Firestore rules reject anything else');
}
if (!/^https:\/\//.test(url)) die('--url must be https; an http APK can be swapped in transit');
const parseCode = (raw, label) => {
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) die(`--${label} must be a positive integer`);
  return n;
};
const versionCode = parseCode(code, 'code');
const minimumSupportedVersionCode = parseCode(minCode, 'min-code');

const cmp = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};
if (cmp(version, minVersion) < 0) die('minimumSupportedVersion is above latestVersion — that locks every device out');
if (cmp(version, minVersion) === 0 && versionCode !== null && minimumSupportedVersionCode !== null && minimumSupportedVersionCode > versionCode) {
  die('minimumSupportedVersionCode is above latestVersionCode under the same name — no installable upgrade exists');
}

const document = {
  minimumSupportedVersion: minVersion,
  latestVersion: version,
  apkUrl: url,
  apkSha256: sha256,
  signingCertSha256: cert.hex,
  releaseNotes: notes,
  apkSizeBytes: sizeBytes,
  publishedAt: new Date().toISOString(),
  ...(versionCode !== null ? { latestVersionCode: versionCode } : {}),
  ...(minimumSupportedVersionCode !== null ? { minimumSupportedVersionCode } : {}),
};

console.log(`APK      : ${apkPath}`);
console.log(`bytes    : ${sizeBytes}`);
console.log(`sha256   : ${sha256}`);
console.log(`signer   : ${cert.hex}  (read with ${cert.from})`);
console.log('');
console.log(JSON.stringify(document, null, 2));

if (!flag('apply')) {
  console.log('\nDry run. Re-run with --apply --project <id> --token <oauth> to publish.');
  process.exit(0);
}

const project = arg('project');
const token = arg('token');
if (!project || !token) die('--apply needs --project and --token');

// Firestore REST, document-shaped: strings as {stringValue}, integers as {integerValue}.
const value = (v) =>
  typeof v === 'number'
    ? { integerValue: String(v) }
    : { stringValue: String(v) };

const body = JSON.stringify({
  fields: Object.fromEntries(Object.entries(document).map(([k, v]) => [k, value(v)])),
});
const endpoint =
  `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents` +
  `/releasePolicy/latest?updateMask.fieldPaths=` +
  Object.keys(document).join('&updateMask.fieldPaths=');

const response = await fetch(endpoint, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body,
});
if (!response.ok) {
  die(`Firestore responded ${response.status}: ${(await response.text()).slice(0, 400)}`);
}

// A write that cannot be read back is not a release.
const readBack = await fetch(
  `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/releasePolicy/latest`,
  { headers: { Authorization: `Bearer ${token}` } },
);
const remote = await readBack.json();
const remoteDigest = remote?.fields?.apkSha256?.stringValue;
if (remoteDigest !== sha256) {
  die(`the document now stored names a different APK (${remoteDigest ?? 'unreadable'})`);
}
console.log(`\nPublished and read back: releasePolicy/latest in ${project}.`);
