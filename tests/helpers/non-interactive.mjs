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
} from 'node:crypto';

const DOMAIN = Buffer.from('pothole/non-interactive/v1');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = NONCE_BYTES + TAG_BYTES;

function requireNonemptyBuffer(value, name) {
  if (!Buffer.isBuffer(value) || value.length === 0) {
    throw new TypeError(`${name} must be a nonempty Buffer.`);
  }
}

function requireX25519Key(key, type) {
  if (!(key instanceof KeyObject) || key.type !== type || key.asymmetricKeyType !== 'x25519') {
    throw new TypeError(`Expected an X25519 ${type} KeyObject.`);
  }
}

function requireSharedKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new TypeError('Shared key must be a 32-byte Buffer.');
  }
}

function framedHash(...parts) {
  const hash = createHash('sha256');
  for (const part of parts) {
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(part.length));
    hash.update(length).update(part);
  }
  return hash.digest();
}

// Test-only encryption keys, separate from the contract's Ed25519 signing keys.
// Both parties must already possess an authenticated public key for their peer.
export function generateEncryptionKeyPair() {
  return generateKeyPairSync('x25519');
}

// Static X25519 needs no interactive handshake, but does not provide forward
// secrecy. Bind context to a unique session, including network and contract.
export function deriveSharedKey(privateKey, peerPublicKey, context) {
  requireX25519Key(privateKey, 'private');
  requireX25519Key(peerPublicKey, 'public');
  requireNonemptyBuffer(context, 'Context');

  const publicIdentities = [createPublicKey(privateKey), peerPublicKey]
    .map((key) => key.export({ type: 'spki', format: 'der' }))
    .sort(Buffer.compare);
  let secret;
  try {
    secret = diffieHellman({ privateKey, publicKey: peerPublicKey });
  } catch {
    throw new Error('Invalid X25519 peer public key.');
  }

  try {
    // OpenSSL rejects low-order points; retain the explicit all-zero check too.
    if (timingSafeEqual(secret, Buffer.alloc(32))) {
      throw new Error('Invalid X25519 shared secret.');
    }
    // Hash length-framed fields to bind identities and arbitrary-size context
    // unambiguously while staying below Node's HKDF info length limit.
    const info = framedHash(DOMAIN, context, ...publicIdentities);
    const salt = createHash('sha256').update(DOMAIN).digest();
    return Buffer.from(hkdfSync('sha256', secret, salt, info, 32));
  } finally {
    secret.fill(0);
  }
}

// AAD must bind the message's session, sender, and sequence number. The caller
// supplies the exact same bytes on decrypt; AAD is authenticated, not encrypted.
export function encryptData(data, key, aad) {
  requireSharedKey(key);
  requireNonemptyBuffer(aad, 'AAD');
  if (!Buffer.isBuffer(data) && typeof data !== 'string') {
    throw new TypeError('Data must be a string or Buffer.');
  }

  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
}

// Payload bytes are nonce[12] || tag[16] || ciphertext, suitable for snake cells.
// No single-cell size limit applies to this test helper.
export function decryptData(payload, key, aad) {
  requireSharedKey(key);
  requireNonemptyBuffer(aad, 'AAD');
  if (!Buffer.isBuffer(payload) || payload.length < HEADER_BYTES) {
    throw new TypeError('Payload must be a Buffer of at least 28 bytes.');
  }

  const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(0, NONCE_BYTES), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(aad);
  decipher.setAuthTag(payload.subarray(NONCE_BYTES, HEADER_BYTES));
  try {
    // Return plaintext only after final() authenticates the entire payload.
    return Buffer.concat([decipher.update(payload.subarray(HEADER_BYTES)), decipher.final()]);
  } catch {
    throw new Error('Authentication failed: wrong key, AAD, or modified payload.');
  }
}
