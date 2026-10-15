import assert from 'node:assert/strict';
import {
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
} from 'node:crypto';
import test from 'node:test';

import {
  decryptData,
  deriveSharedKey,
  encryptData,
  generateEncryptionKeyPair,
} from './helpers/non-interactive.mjs';

const context = Buffer.from('testnet:0:example-contract:session-1');
const alice = generateEncryptionKeyPair();
const bob = generateEncryptionKeyPair();
const aliceKey = deriveSharedKey(alice.privateKey, bob.publicKey, context);
const bobKey = deriveSharedKey(bob.privateKey, alice.publicKey, context);

function messageAad(sender, sequence) {
  return Buffer.from(JSON.stringify([context.toString(), sender, sequence]));
}

function importPublicKey(rawHex) {
  return createPublicKey({
    key: Buffer.from(`302a300506032b656e032100${rawHex}`, 'hex'),
    type: 'spki',
    format: 'der',
  });
}

function importPrivateKey(rawHex) {
  return createPrivateKey({
    key: Buffer.from(`302e020100300506032b656e04220420${rawHex}`, 'hex'),
    type: 'pkcs8',
    format: 'der',
  });
}

test('each party independently derives the same 32-byte key from its own private key', () => {
  assert.ok(Buffer.isBuffer(aliceKey));
  assert.equal(aliceKey.length, 32);
  assert.deepEqual(aliceKey, bobKey);
  assert.notDeepEqual(alice.publicKey.export({ type: 'spki', format: 'der' }),
    bob.publicKey.export({ type: 'spki', format: 'der' }));
});

test('X25519 agrees with the RFC 7748 section 6.1 test vector', () => {
  // https://www.rfc-editor.org/rfc/rfc7748.html#section-6.1
  const alicePrivate = importPrivateKey('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
  const alicePublic = importPublicKey('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a');
  const bobPrivate = importPrivateKey('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
  const bobPublic = importPublicKey('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f');
  const expected = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742';
  assert.equal(diffieHellman({ privateKey: alicePrivate, publicKey: bobPublic }).toString('hex'), expected);
  assert.equal(diffieHellman({ privateKey: bobPrivate, publicKey: alicePublic }).toString('hex'), expected);
  const derived = deriveSharedKey(alicePrivate, bobPublic, context);
  assert.deepEqual(derived, deriveSharedKey(bobPrivate, alicePublic, context));
  assert.notEqual(derived.toString('hex'), expected, 'AES uses the HKDF result, not raw DH output');
});

test('a different peer or session context derives a different encryption key', () => {
  const otherPeer = generateEncryptionKeyPair();
  assert.notDeepEqual(aliceKey, deriveSharedKey(alice.privateKey, otherPeer.publicKey, context));
  for (const alternateContext of [Buffer.from('testnet:0:example-contract:session-2'), Buffer.alloc(2048, 42)]) {
    const derived = deriveSharedKey(alice.privateKey, bob.publicKey, alternateContext);
    assert.notDeepEqual(aliceKey, derived);
    assert.deepEqual(derived, deriveSharedKey(bob.privateKey, alice.publicKey, alternateContext));
  }
});

test('both directions round trip long UTF-8 text, 1024 binary bytes, and empty data', () => {
  const text = 'An encrypted message: why not? 👋 '.repeat(12);
  const binary = Buffer.from(Array.from({ length: 1024 }, (_, i) => i % 256));
  assert.ok(Buffer.byteLength(text) > 127);
  for (const [sender, sendingKey, receivingKey] of [['alice', aliceKey, bobKey], ['bob', bobKey, aliceKey]]) {
    for (const [sequence, data] of [text, binary, '', Buffer.alloc(0)].entries()) {
      const aad = messageAad(sender, sequence);
      const payload = encryptData(data, sendingKey, aad);
      assert.equal(payload.length, Buffer.byteLength(data) + 28);
      assert.deepEqual(decryptData(payload, receivingKey, aad), Buffer.from(data));
    }
  }
});

test('every encryption uses a fresh nonce, including repeated empty messages', () => {
  const aad = messageAad('alice', 0);
  for (const data of ['', 'same message']) {
    const first = encryptData(data, aliceKey, aad);
    const second = encryptData(data, aliceKey, aad);
    assert.notDeepEqual(first.subarray(0, 12), second.subarray(0, 12));
    assert.deepEqual(decryptData(first, bobKey, aad), Buffer.from(data));
    assert.deepEqual(decryptData(second, bobKey, aad), Buffer.from(data));
  }
});

test('rejects another peer, shared key, context, sender, or sequence during decryption', () => {
  const aad = messageAad('alice', 0);
  const payload = encryptData('private', aliceKey, aad);
  const otherPeer = generateEncryptionKeyPair();
  for (const wrongKey of [
    randomBytes(32),
    deriveSharedKey(otherPeer.privateKey, alice.publicKey, context),
    deriveSharedKey(bob.privateKey, alice.publicKey, Buffer.from('other-session')),
  ]) {
    assert.throws(() => decryptData(payload, wrongKey, aad), /Authentication failed/);
  }
  for (const wrongAad of [messageAad('bob', 0), messageAad('alice', 1), Buffer.from('other-session')]) {
    assert.throws(() => decryptData(payload, bobKey, wrongAad), /Authentication failed/);
  }
});

test('rejects modified nonce, tag, ciphertext, truncation, and appended bytes', () => {
  const aad = messageAad('alice', 0);
  const payload = encryptData(Buffer.alloc(1024, 42), aliceKey, aad);
  for (const index of [0, 11, 12, 27, 28, 127, payload.length - 1]) {
    const modified = Buffer.from(payload);
    modified[index] ^= 1;
    assert.throws(() => decryptData(modified, bobKey, aad), /Authentication failed/);
  }
  for (const modified of [payload.subarray(0, 28), payload.subarray(0, -1), Buffer.concat([payload, Buffer.from([0])])]) {
    assert.throws(() => decryptData(modified, bobKey, aad), /Authentication failed/);
  }
  for (const length of [0, 12, 16, 27]) {
    assert.throws(() => decryptData(payload.subarray(0, length), bobKey, aad), /at least 28 bytes/);
  }
});

test('rejects low-order X25519 peer points', () => {
  for (const publicHex of ['00'.repeat(32), `01${'00'.repeat(31)}`]) {
    const invalidPublic = importPublicKey(publicHex);
    assert.throws(() => deriveSharedKey(alice.privateKey, invalidPublic, context), /Invalid X25519/);
  }
});

test('rejects Ed25519 signing keys, reversed key types, and missing context', () => {
  const signingKeys = generateKeyPairSync('ed25519');
  for (const privateKey of [undefined, alice.publicKey, signingKeys.privateKey]) {
    assert.throws(() => deriveSharedKey(privateKey, bob.publicKey, context), /X25519 private/);
  }
  for (const publicKey of [undefined, bob.privateKey, signingKeys.publicKey]) {
    assert.throws(() => deriveSharedKey(alice.privateKey, publicKey, context), /X25519 public/);
  }
  for (const invalidContext of [undefined, '', 'context', Buffer.alloc(0)]) {
    assert.throws(() => deriveSharedKey(alice.privateKey, bob.publicKey, invalidContext), /Context must be/);
  }
});

test('requires an explicit binary shared key and message AAD', () => {
  const aad = messageAad('alice', 0);
  const payload = encryptData('hello', aliceKey, aad);
  for (const key of [undefined, aliceKey.toString('hex'), Buffer.alloc(31), Buffer.alloc(33)]) {
    assert.throws(() => encryptData('hello', key, aad), /32-byte Buffer/);
    assert.throws(() => decryptData(payload, key, aad), /32-byte Buffer/);
  }
  for (const invalidAad of [undefined, '', 'aad', Buffer.alloc(0)]) {
    assert.throws(() => encryptData('hello', aliceKey, invalidAad), /AAD must be/);
    assert.throws(() => decryptData(payload, bobKey, invalidAad), /AAD must be/);
  }
  assert.throws(() => encryptData({}, aliceKey, aad), /string or Buffer/);
  assert.throws(() => decryptData(payload.toString('hex'), bobKey, aad), /at least 28 bytes/);
});
