import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants as bufferConstants } from 'node:buffer';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
    decryptData,
    deriveSharedKey,
    encryptData,
    generateEncryptionKeyPair,
} from './helpers/non-interactive.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

function requestedSizes() {
    const configured = process.env.POTHOLE_TEST_SIZES;
    if (configured === undefined) {
        return [0, 1, 127, 128, 1024, 4096, 16384, 32768];
    }
    const sizes = configured.split(',').map((entry) => {
        const value = entry.trim();
        if (!/^\d+$/.test(value)) {
            throw new Error('POTHOLE_TEST_SIZES must be a comma-separated list of nonnegative byte counts.');
        }
        const bytes = Number(value);
        if (!Number.isSafeInteger(bytes) || bytes > bufferConstants.MAX_LENGTH - 28) {
            throw new Error('POTHOLE_TEST_SIZES contains a size that cannot fit in a Node Buffer.');
        }
        return bytes;
    });
    return sizes;
}

function roundTrip(messages, t) {
    const alice = generateEncryptionKeyPair();
    const bob = generateEncryptionKeyPair();
    // Public channel context, plus each participant's own private key and the peer's public key.
    // No pre-shared encryption secret, interactive handshake, or Ed25519 key conversion.
    const context = randomBytes(32);
    const keyA = deriveSharedKey(alice.privateKey, bob.publicKey, context);
    const keyB = deriveSharedKey(bob.privateKey, alice.publicKey, context);
    assert.deepEqual(keyA, keyB);
    const keys = [keyA, keyB];
    const messageAad = (seqno) => Buffer.from(JSON.stringify([
        'pothole/test-message/v1', context.toString('hex'), seqno, seqno & 1,
    ]));
    const associatedData = messages.map((_, seqno) => messageAad(seqno));
    const encrypted = messages.map((message, seqno) =>
        encryptData(message, keys[seqno & 1], associatedData[seqno]));

    // Acton's filesystem API only accepts paths inside the project. Only ciphertext
    // crosses this bridge; plaintext and X25519/AES keys stay in this Node process.
    mkdirSync(join(root, 'build'), { recursive: true });
    const directory = mkdtempSync(join(root, 'build/encrypted-roundtrip-'));
    try {
        encrypted.forEach((payload, seqno) => {
            writeFileSync(join(directory, `${seqno}.encrypted`), payload);
        });
        const logPath = join(directory, 'acton.log');
        const log = openSync(logPath, 'w');
        let result;
        try {
            result = spawnSync('acton', ['script', 'tests/fixtures/encrypted-roundtrip.tolk'], {
                cwd: root,
                env: {
                    ...process.env,
                    POTHOLE_TEST_DIR: relative(root, directory),
                    POTHOLE_TEST_COUNT: String(messages.length),
                },
                stdio: ['ignore', log, log],
                timeout: 30_000,
            });
        } finally {
            closeSync(log);
        }
        const output = readFileSync(logPath, 'utf8');
        assert.ifError(result.error);
        assert.equal(result.status, 0, output);
        for (const line of output.trim().split(/\r?\n/)) {
            t.diagnostic(line);
        }

        messages.forEach((plaintext, seqno) => {
            // Read back from the contract getter after real emulated external-in execution.
            const stored = readFileSync(join(directory, `${seqno}.stored`));
            assert.deepEqual(stored, encrypted[seqno]);
            const recipientKey = keys[1 - (seqno & 1)];
            assert.deepEqual(decryptData(stored, recipientKey, associatedData[seqno]), plaintext);

            const modified = Buffer.from(stored);
            modified[modified.length - 1] ^= 1;
            assert.throws(() => decryptData(modified, recipientKey, associatedData[seqno]));
            // The same encrypted payload cannot be interpreted as a different turn.
            assert.throws(() => decryptData(stored, recipientKey, messageAad(seqno + 1)));
        });
        t.diagnostic(`Decrypted ${messages.length} alternating messages: ${messages.map((message) => message.length).join(', ')} plaintext bytes`);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

test('non-interactive A/B/A: UTF-8 text, binary data, and empty data survive on-chain snake storage', (t) => {
    roundTrip([
        Buffer.from('Hello B! This encrypted text crosses several cells. 👋\n'.repeat(12)),
        Buffer.from(Array.from({ length: 1024 }, (_, index) => index % 256)),
        Buffer.alloc(0),
    ], t);
});

test('snake serialization preserves exact 127, 128, and 254 byte payload boundaries', (t) => {
    // AES-GCM contributes 12 bytes of nonce and 16 bytes of authentication tag.
    roundTrip([99, 100, 226].map((length) => randomBytes(length)), t);
});

test('arbitrary plaintext sizes round trip through encrypted snake storage', (t) => {
    const sizes = requestedSizes();
    roundTrip(sizes.map((bytes) => randomBytes(bytes)), t);
});
