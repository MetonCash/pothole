#!/usr/bin/env node

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_PLAINTEXT_BYTES = 99;
export const MAX_PAYLOAD_BYTES = 127;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = NONCE_BYTES + TAG_BYTES;

function sharedKey(keyHex) {
    if (typeof keyHex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(keyHex)) {
        throw new Error('POTHOLE_SHARED_KEY must contain exactly 64 hexadecimal characters (32 random bytes).');
    }
    return Buffer.from(keyHex, 'hex');
}

// Encryption happens off chain. Only nonce || tag || ciphertext goes on chain;
// the shared encryption key must never be placed in contract storage or messages.
export function encrypt(plaintext, keyHex) {
    const key = sharedKey(keyHex);
    if (typeof plaintext !== 'string' && !Buffer.isBuffer(plaintext)) {
        throw new Error('Plaintext must be a string or Buffer.');
    }
    const bytes = Buffer.from(plaintext);
    if (bytes.length > MAX_PLAINTEXT_BYTES) {
        throw new Error(`Plaintext must be at most ${MAX_PLAINTEXT_BYTES} bytes (UTF-8 for text).`);
    }

    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('hex');
}

export function decrypt(payloadHex, keyHex) {
    const key = sharedKey(keyHex);
    // Buffer.from(..., 'hex') alone silently truncates malformed input.
    if (typeof payloadHex !== 'string' || !/^(?:[0-9a-fA-F]{2})+$/.test(payloadHex)) {
        throw new Error('Payload must contain an even number of hexadecimal characters.');
    }
    if (payloadHex.length < HEADER_BYTES * 2 || payloadHex.length > MAX_PAYLOAD_BYTES * 2) {
        throw new Error(`Payload must be between ${HEADER_BYTES} and ${MAX_PAYLOAD_BYTES} bytes.`);
    }

    const payload = Buffer.from(payloadHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(0, NONCE_BYTES), {
        authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(payload.subarray(NONCE_BYTES, HEADER_BYTES));
    try {
        // Do not expose partial plaintext before authentication succeeds.
        return Buffer.concat([decipher.update(payload.subarray(HEADER_BYTES)), decipher.final()]);
    } catch {
        throw new Error('Authentication failed: wrong shared key or modified payload.');
    }
}

function main() {
    const command = process.argv[2];
    if (process.argv.length !== 3 || !['keygen', 'encrypt', 'decrypt'].includes(command)) {
        throw new Error('Usage: node scripts/cipher.mjs keygen|encrypt|decrypt (data via stdin, key via POTHOLE_SHARED_KEY).');
    }
    if (command === 'keygen') {
        process.stdout.write(`${randomBytes(32).toString('hex')}\n`);
        return;
    }

    const keyHex = process.env.POTHOLE_SHARED_KEY;
    sharedKey(keyHex);
    if (command === 'encrypt') {
        process.stdout.write(`${encrypt(readFileSync(0), keyHex)}\n`);
    } else {
        process.stdout.write(decrypt(readFileSync(0, 'utf8').trim(), keyHex));
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}
