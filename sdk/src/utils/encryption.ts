import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  KeyObject,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const DOMAIN = Buffer.from("pothole/non-interactive/v1");
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = NONCE_BYTES + TAG_BYTES;

export interface EncryptionKeyPair {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
}

function requireNonemptyBuffer(value: unknown, name: string): asserts value is Buffer {
  if (!Buffer.isBuffer(value) || value.length === 0) {
    throw new TypeError(`${name} must be a nonempty Buffer.`);
  }
}

function requireX25519Key(key: unknown, type: "private" | "public"): asserts key is KeyObject {
  if (!(key instanceof KeyObject) || key.type !== type || key.asymmetricKeyType !== "x25519") {
    throw new TypeError(`Expected an X25519 ${type} KeyObject.`);
  }
}

function requireSharedKey(key: unknown): asserts key is Buffer {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new TypeError("Shared key must be a 32-byte Buffer.");
  }
}

function framedHash(...parts: Buffer[]): Buffer {
  const hash = createHash("sha256");
  for (const part of parts) {
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(part.length));
    hash.update(length).update(part);
  }
  return hash.digest();
}

/** Generate X25519 encryption keys, separate from the contract's Ed25519 signing keys. */
export function generateEncryptionKeyPair(): EncryptionKeyPair {
  return generateKeyPairSync("x25519");
}

/**
 * Derive the same AES key independently at each peer using X25519 and HKDF-SHA256.
 * The peer's public key must already be authenticated. Context should identify
 * the network, contract, and session. Static X25519 does not provide forward secrecy.
 * Compatible with the repository's non-interactive test client.
 */
export function deriveSharedKey(privateKey: KeyObject, peerPublicKey: KeyObject, context: Buffer): Buffer {
  requireX25519Key(privateKey, "private");
  requireX25519Key(peerPublicKey, "public");
  requireNonemptyBuffer(context, "Context");

  const publicIdentities = [createPublicKey(privateKey), peerPublicKey]
    .map((key) => key.export({ type: "spki", format: "der" }))
    .sort(Buffer.compare);
  let secret: Buffer;
  try {
    secret = diffieHellman({ privateKey, publicKey: peerPublicKey });
  } catch {
    throw new Error("Invalid X25519 peer public key.");
  }

  try {
    if (timingSafeEqual(secret, Buffer.alloc(32))) {
      throw new Error("Invalid X25519 shared secret.");
    }
    // Length-framed fields bind the context and both identities unambiguously.
    // Hashing them also keeps HKDF info below Node's 1024-byte limit.
    const info = framedHash(DOMAIN, context, ...publicIdentities);
    const salt = createHash("sha256").update(DOMAIN).digest();
    return Buffer.from(hkdfSync("sha256", secret, salt, info, 32));
  } finally {
    secret.fill(0);
  }
}

/**
 * Encrypt with AES-256-GCM: nonce[12] || authentication tag[16] || ciphertext.
 * A fresh random nonce is generated for every call. Bind AAD to the session,
 * sender, and sequence number; use the same exact AAD bytes when decrypting.
 */
export function encryptData(data: Buffer | string, key: Buffer, aad: Buffer): Buffer {
  requireSharedKey(key);
  requireNonemptyBuffer(aad, "AAD");
  if (!Buffer.isBuffer(data) && typeof data !== "string") {
    throw new TypeError("Data must be a string or Buffer.");
  }

  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const plaintext = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
}

/** Decrypt the binary payload, returning no plaintext unless authentication succeeds. */
export function decryptData(payload: Buffer, key: Buffer, aad: Buffer): Buffer {
  requireSharedKey(key);
  requireNonemptyBuffer(aad, "AAD");
  if (!Buffer.isBuffer(payload) || payload.length < HEADER_BYTES) {
    throw new TypeError("Payload must be a Buffer of at least 28 bytes.");
  }

  const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(0, NONCE_BYTES), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(aad);
  decipher.setAuthTag(payload.subarray(NONCE_BYTES, HEADER_BYTES));
  try {
    return Buffer.concat([decipher.update(payload.subarray(HEADER_BYTES)), decipher.final()]);
  } catch {
    throw new Error("Authentication failed: wrong key, AAD, or modified payload.");
  }
}
