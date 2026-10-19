/**
 * Why this file exists: the release build shipped without any cleartext permission while
 * `debug` and `debugOptimized` each set `usesCleartextTraffic="true"`, so every plain-HTTP
 * IPTV channel played for months in development and then failed in release with
 * `UnknownServiceException: CLEARTEXT communication to <host> not permitted by network
 * security policy`. A network security config now governs all variants, so the rule has to
 * be right in one place and it has to be checked in one place.
 *
 * The permission is deliberately broad for streams and deliberately narrow for everything
 * that carries a credential or a binary: an auth token or an APK arriving over plain HTTP is
 * an on-path attack, not a playback problem.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

const MANIFEST = 'android/app/src/main/AndroidManifest.xml';
const CONFIG = 'android/app/src/main/res/xml/network_security_config.xml';

/** Hosts that must never be reachable over cleartext, whatever the base rule says. */
const MUST_STAY_HTTPS = [
  'googleapis.com', // Firestore, Auth/identity, Cloud Functions, logging
  'google.com', // Google sign-in
  'firebaseio.com',
  'themoviedb.org', // API key in the request
  'tmdb.org', // poster CDN
  'wyzie.io', // subtitle provider key
  'github.com', // release lookup
  'githubusercontent.com', // the APK itself
];

/** Domains listed inside a `cleartextTrafficPermitted="false"` block. */
const deniedCleartextHosts = (xml: string): string[] => {
  const hosts: string[] = [];
  for (const block of xml.match(/<domain-config\b[^>]*>[\s\S]*?<\/domain-config>/g) ?? []) {
    if (!/cleartextTrafficPermitted\s*=\s*"false"/.test(block)) continue;
    for (const domain of block.match(/<domain\b[^>]*>([^<]+)<\/domain>/g) ?? []) {
      hosts.push(domain.replace(/<[^>]+>/g, '').trim());
    }
  }
  return hosts;
};

describe('Android network security policy', () => {
  const manifest = read(MANIFEST);
  const config = read(CONFIG);

  it('is wired into the application the release APK actually installs', () => {
    expect(manifest).toMatch(/android:networkSecurityConfig="@xml\/network_security_config"/);
  });

  it('permits cleartext by default, so plain-HTTP live channels play in release', () => {
    const base = config.match(/<base-config\b[^>]*\/?>/)?.[0] ?? '';
    expect(base).toMatch(/cleartextTrafficPermitted\s*=\s*"true"/);
  });

  it.each(MUST_STAY_HTTPS)('refuses cleartext to %s', (host) => {
    const denied = deniedCleartextHosts(config);
    expect(denied).toContain(host);
    // Subdomains carry the traffic in practice: firestore.googleapis.com, api.themoviedb.org,
    // sub.wyzie.io, uploads.github.com. A bare apex entry without subdomains would not bind.
    const entry = config.match(new RegExp(`<domain[^>]*>${host}<\\/domain>`))?.[0] ?? '';
    expect(entry).toMatch(/includeSubdomains\s*=\s*"true"/);
  });

  it('names the config file the manifest points at, in the resource directory it resolves to', () => {
    expect(config.startsWith('<?xml')).toBe(true);
    expect(config).toMatch(/<network-security-config[\s>]/);
    expect(config).toMatch(/<\/network-security-config>\s*$/);
  });
});
