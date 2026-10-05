import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import type { HexDigest } from './keyHash';

/** Platform SHA-256, lowercase hex. Never hand-rolled — this is the OS implementation. */
export const sha256Hex: HexDigest = (input) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, input);
