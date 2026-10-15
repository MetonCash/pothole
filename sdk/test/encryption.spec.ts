import { createPrivateKey, createPublicKey, generateKeyPairSync, KeyObject, randomBytes } from "node:crypto";
import { decryptData, deriveSharedKey, encryptData, generateEncryptionKeyPair } from "../src/utils/encryption";
import { bufferToSnakeCell, snakeCellToBuffer } from "../src/utils/snake";

const context = Buffer.from("pothole/sdk-test/session-1");
const aad = Buffer.from("pothole/sdk-test/session-1/alice/0");

function publicKey(rawHex: string): KeyObject {
  return createPublicKey({
    key: Buffer.from(`302a300506032b656e032100${rawHex}`, "hex"),
    type: "spki",
    format: "der",
  });
}

describe("non-interactive encryption", () => {
  const alice = generateEncryptionKeyPair();
  const bob = generateEncryptionKeyPair();
  const aliceKey = deriveSharedKey(alice.privateKey, bob.publicKey, context);
  const bobKey = deriveSharedKey(bob.privateKey, alice.publicKey, context);

  it("derives matching keys independently and round trips both directions through snake cells", () => {
    expect(aliceKey).toHaveLength(32);
    expect(aliceKey).toEqual(bobKey);
    const inputs = ["", "Encrypted message 👋 ".repeat(20), randomBytes(1024)];
    for (const [sendingKey, receivingKey] of [[aliceKey, bobKey], [bobKey, aliceKey]]) {
      for (const data of inputs) {
        const payload = encryptData(data, sendingKey, aad);
        expect(payload).toHaveLength(Buffer.byteLength(data) + 28);
        const stored = snakeCellToBuffer(bufferToSnakeCell(payload));
        expect(decryptData(stored, receivingKey, aad)).toEqual(Buffer.from(data));
      }
    }
  });

  it("matches the original client's KDF and payload format for RFC 7748 keys", () => {
    // RFC 7748 section 6.1 keys; expected KDF/payload captured from
    // tests/helpers/non-interactive.mjs to keep SDK compatibility explicit.
    const alicePrivate = createPrivateKey({
      key: Buffer.from("302e020100300506032b656e0422042077076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a", "hex"),
      type: "pkcs8",
      format: "der",
    });
    const bobPublic = publicKey("de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f");
    const key = deriveSharedKey(alicePrivate, bobPublic, context);
    expect(key.toString("hex")).toBe("ba14ec61e18fe7b1deabfce7df280db0f777d75aaa6f22f2ddd5e5aa8f7e3428");
    const payload = Buffer.from("20c5b87d8068e9159884f6866aca9c810964494eb1e6605fa71c778acf45128f8e68686b88ebff541cbada35c0fa6af37dc7dddc9652f0f59c62857781d828", "hex");
    expect(decryptData(payload, key, aad).toString("utf8")).toBe("Hello from the original client 👋");
  });

  it("uses fresh nonces and rejects wrong peers, contexts, keys, or message AAD", () => {
    const payload = encryptData("private", aliceKey, aad);
    expect(encryptData("private", aliceKey, aad).subarray(0, 12)).not.toEqual(payload.subarray(0, 12));
    const other = generateEncryptionKeyPair();
    const wrongKeys = [
      randomBytes(32),
      deriveSharedKey(other.privateKey, alice.publicKey, context),
      deriveSharedKey(bob.privateKey, alice.publicKey, Buffer.from("another session")),
    ];
    for (const key of wrongKeys) {
      expect(key).not.toEqual(aliceKey);
      expect(() => decryptData(payload, key, aad)).toThrow("Authentication failed");
    }
    expect(() => decryptData(payload, bobKey, Buffer.from("another sender or sequence"))).toThrow("Authentication failed");
    const longContext = Buffer.alloc(2048, 1);
    expect(deriveSharedKey(alice.privateKey, bob.publicKey, longContext))
      .toEqual(deriveSharedKey(bob.privateKey, alice.publicKey, longContext));
  });

  it("rejects tampered nonce/tag/ciphertext and truncated or extended payloads", () => {
    const payload = encryptData(randomBytes(1024), aliceKey, aad);
    for (const offset of [0, 12, 28, payload.length - 1]) {
      const modified = Buffer.from(payload);
      modified[offset] ^= 1;
      expect(() => decryptData(modified, bobKey, aad)).toThrow("Authentication failed");
    }
    for (const modified of [payload.subarray(0, 28), payload.subarray(0, -1), Buffer.concat([payload, Buffer.from([0])])]) {
      expect(() => decryptData(modified, bobKey, aad)).toThrow("Authentication failed");
    }
    expect(() => decryptData(payload.subarray(0, 27), bobKey, aad)).toThrow("at least 28 bytes");
  });

  it("rejects signing keys, reversed key types, low-order peers, and absent context", () => {
    const signing = generateKeyPairSync("ed25519");
    for (const key of [alice.publicKey, signing.privateKey]) {
      expect(() => deriveSharedKey(key, bob.publicKey, context)).toThrow("X25519 private");
    }
    for (const key of [bob.privateKey, signing.publicKey]) {
      expect(() => deriveSharedKey(alice.privateKey, key, context)).toThrow("X25519 public");
    }
    for (const hex of ["00".repeat(32), `01${"00".repeat(31)}`]) {
      expect(() => deriveSharedKey(alice.privateKey, publicKey(hex), context)).toThrow("Invalid X25519");
    }
    expect(() => deriveSharedKey(alice.privateKey, bob.publicKey, Buffer.alloc(0))).toThrow("Context must be");
    expect(() => deriveSharedKey(alice.privateKey, bob.publicKey, undefined as unknown as Buffer)).toThrow("Context must be");
  });

  it("validates binary keys, required AAD, and payload types at runtime", () => {
    const payload = encryptData("hello", aliceKey, aad);
    for (const key of [Buffer.alloc(31), Buffer.alloc(33), "not a buffer" as unknown as Buffer]) {
      expect(() => encryptData("hello", key, aad)).toThrow("32-byte Buffer");
      expect(() => decryptData(payload, key, aad)).toThrow("32-byte Buffer");
    }
    for (const invalidAad of [Buffer.alloc(0), undefined as unknown as Buffer]) {
      expect(() => encryptData("hello", aliceKey, invalidAad)).toThrow("AAD must be");
      expect(() => decryptData(payload, bobKey, invalidAad)).toThrow("AAD must be");
    }
    expect(() => encryptData({} as Buffer, aliceKey, aad)).toThrow("string or Buffer");
    expect(() => decryptData("hex" as unknown as Buffer, bobKey, aad)).toThrow("at least 28 bytes");
  });
});
