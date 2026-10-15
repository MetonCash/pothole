import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { decrypt, encrypt, MAX_PAYLOAD_BYTES, MAX_PLAINTEXT_BYTES } from '../scripts/cipher.mjs';

const key = randomBytes(32).toString('hex');
const script = fileURLToPath(new URL('../scripts/cipher.mjs', import.meta.url));

function cli(command, input = '', keyHex = key) {
    return spawnSync(process.execPath, [script, command], {
        input,
        encoding: 'utf8',
        timeout: 5_000,
        env: { ...process.env, POTHOLE_SHARED_KEY: keyHex },
    });
}

test('round trips UTF-8, empty plaintext, and the maximum payload size', () => {
    for (const plaintext of ['', 'Hello, planet! 👋', 'x'.repeat(MAX_PLAINTEXT_BYTES)]) {
        const payload = encrypt(plaintext, key);
        assert.equal(decrypt(payload, key).toString('utf8'), plaintext);
        assert.equal(payload.length / 2, Buffer.byteLength(plaintext) + 28);
        assert.ok(payload.length / 2 <= MAX_PAYLOAD_BYTES);
    }
});

test('preserves binary bytes and uses a fresh nonce for every encryption', () => {
    const plaintext = Buffer.from([0, 255, 128, 10]);
    const first = encrypt(plaintext, key);
    const second = encrypt(plaintext, key);
    assert.notEqual(first.slice(0, 24), second.slice(0, 24));
    assert.deepEqual(decrypt(first, key), plaintext);
    assert.deepEqual(decrypt(second, key), plaintext);
});

test('rejects oversized plaintext measured in bytes, including multibyte text', () => {
    for (const plaintext of ['x'.repeat(100), '¢'.repeat(50), Buffer.alloc(100)]) {
        assert.throws(() => encrypt(plaintext, key), /at most 99 bytes/);
    }
});

test('rejects tampering with the nonce, authentication tag, and ciphertext', () => {
    const payload = Buffer.from(encrypt('Private message', key), 'hex');
    for (const index of [0, 12, 28, payload.length - 1]) {
        const modified = Buffer.from(payload);
        modified[index] ^= 1;
        assert.throws(() => decrypt(modified.toString('hex'), key), /Authentication failed/);
    }
});

test('rejects a wrong key and truncated ciphertext', () => {
    const payload = encrypt('Private message', key);
    assert.throws(() => decrypt(payload, randomBytes(32).toString('hex')), /Authentication failed/);
    assert.throws(() => decrypt(payload.slice(0, -2), key), /Authentication failed/);
});

test('rejects malformed hex, short payloads, and oversized payloads', () => {
    for (const payload of ['', '0', 'gg', 'ab'.repeat(28) + 'z', 'ab '.repeat(28), '0x' + 'ab'.repeat(28)]) {
        assert.throws(() => decrypt(payload, key), /hexadecimal/);
    }
    for (const length of [1, 27, 128]) {
        assert.throws(() => decrypt('ab'.repeat(length), key), /between 28 and 127 bytes/);
    }
});

test('validates encryption keys without silently truncating malformed hex', () => {
    for (const badKey of [undefined, '', '0'.repeat(63), '0'.repeat(65), 'g'.repeat(64), key + '\n']) {
        assert.throws(() => encrypt('hello', badKey), /POTHOLE_SHARED_KEY/);
        assert.throws(() => decrypt('00'.repeat(28), badKey), /POTHOLE_SHARED_KEY/);
    }
});

test('CLI encrypts stdin and decrypts it without adding a newline', () => {
    const plaintext = 'Hello 👋\n';
    const encrypted = cli('encrypt', plaintext);
    assert.equal(encrypted.status, 0);
    assert.equal(encrypted.stderr, '');
    assert.match(encrypted.stdout, /^[0-9a-f]+\n$/);
    const decrypted = cli('decrypt', encrypted.stdout);
    assert.equal(decrypted.status, 0);
    assert.equal(decrypted.stderr, '');
    assert.equal(decrypted.stdout, plaintext);
});

test('CLI fails without printing plaintext, shared keys, or partial plaintext', () => {
    const payload = encrypt('DO-NOT-PRINT', key);
    for (const result of [
        cli('encrypt', 'DO-NOT-PRINT', ''),
        cli('decrypt', payload, randomBytes(32).toString('hex')),
        cli('decrypt', 'invalid'),
        cli('encrypt', 'DO-NOT-PRINT'.repeat(10)),
        cli('unknown'),
    ]) {
        assert.equal(result.status, 1);
        assert.equal(result.stdout, '');
        assert.ok(result.stderr.length > 0);
        assert.ok(!result.stderr.includes('DO-NOT-PRINT'));
        assert.ok(!result.stderr.includes(key));
    }
});

test('CLI keygen produces usable independent 32-byte keys', () => {
    const first = cli('keygen');
    const second = cli('keygen');
    assert.equal(first.status, 0);
    assert.equal(first.stderr, '');
    assert.equal(second.status, 0);
    assert.match(first.stdout, /^[0-9a-f]{64}\n$/);
    assert.notEqual(first.stdout, second.stdout);
    const generatedKey = first.stdout.trim();
    assert.equal(decrypt(encrypt('hello', generatedKey), generatedKey).toString(), 'hello');
});
