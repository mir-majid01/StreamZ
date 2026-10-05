import { canonicalPlaintext } from './keyFormat';

/**
 * Signature of "hash this string, give me lowercase hex". Injected rather than called
 * directly so the pure logic stays testable under jest (node:crypto) while the app uses
 * the platform digest (expo-crypto → CommonCrypto / MessageDigest).
 */
export type HexDigest = (input: string) => Promise<string>;

/**
 * A key's Firestore document id is the SHA-256 of its canonical plaintext, so the user
 * app can address the one document it is allowed to touch by hash equality alone.
 * Firestore rules cannot see a query's filters, so any client that may `list`
 * subscriptionKeys can dump every key in the collection — addressing by id is what keeps
 * that door shut.
 *
 * The preimage is the dashed plaintext exactly as StreamZ Admin generated it, with no
 * prefix and no version salt, because that is what its KeyGenerator + hashKey produce.
 */
export async function keyDocId(rawKey: unknown, digest: HexDigest): Promise<string | null> {
  const plaintext = canonicalPlaintext(rawKey);
  if (!plaintext) return null;
  const hex = (await digest(plaintext)).toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}
