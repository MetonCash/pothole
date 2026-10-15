# Pothole SDK

`@metoncash/pothole-sdk` provides Node.js 22+ TypeScript wrappers for the Pothole
factory and its encrypted owner/user channels on TON. The factory supplies the
owner's signing key; the wallet minting a channel becomes its user. The owner
sends message zero to confirm the channel, then owner and user alternate. The
stored user can close the channel, receive its remaining TON and delete the account.

The package includes generated ABI codecs and embedded bytecode, strict
TypeScript, CommonJS declarations, and Jest tests against TON Sandbox.
Encryption uses Node's `crypto`; browser support is not included.

## Build locally

```bash
npm ci --prefix sdk
npm --prefix sdk run build
npm --prefix sdk run typecheck
npm --prefix sdk test
```

Install from another project with `npm install /path/to/pothole/sdk`. The examples
assume a configured TON client exposing `client.open(...)`, wallet senders, and
confirmed transactions. The SDK does not select an RPC endpoint or manage wallets.
All ABI integers use `bigint`.

## Deploy a factory

```ts
import { toNano } from "@ton/core";
import { PotholeFactory, publicKeyToBigInt } from "@metoncash/pothole-sdk";

const factory = client.open(PotholeFactory.create({
  factoryId: 0n,
  owner: ownerSender.address!,
  publicKey: publicKeyToBigInt(ownerSigning.publicKey),
}));
await factory.sendDeploy(ownerSender, toNano("0.2"));
// Confirm deployment before invoking getters or minting.
const factoryData = await factory.getFactoryData();
```

`ownerSigning.publicKey` is the owner's 32-byte Ed25519 public key. `create`
uses the bundled Pothole code unless `potholeCode` is supplied explicitly. A new
factory starts with `lastPotholeId = 0n`. `getFactoryData()` returns its factory ID,
next channel ID, owner address, signing public key, and Pothole code.

## Mint a channel

```ts
import { Pothole, PotholeFactory, publicKeyToBigInt } from "@metoncash/pothole-sdk";
import { toNano } from "@ton/core";

const factory = client.open(PotholeFactory.fromAddress(factoryAddress));
await factory.sendMintMessage(userSender, toNano("0.2"), {
  queryId: 42n,
  publicKey: publicKeyToBigInt(userSigning.publicKey),
  expiration: 0n,
}, { bounce: true });
// Confirm the factory and child transactions; obtain mintedAddress from that trace.
const mailbox = client.open(Pothole.fromAddress(mintedAddress));
const data = await mailbox.getPotholeData();
```

The user address comes from the internal mint message's sender. Its signing key
must be nonzero and different from the factory's owner signing key. The attached
value covers execution and storage reserves; excess value returns to the user.

Each successful mint consumes the next sequential ID. `queryId` identifies the
request and its excess refund; repeating it creates another channel. Use
`factory.getPotholeAddress(potholeId)` to predict an ID's address. Concurrent mints
can advance the counter between reading it and submitting a request, so identify
the actual child from the confirmed transaction trace.

`expiration` is an absolute uint32 Unix timestamp in seconds; `0n` means no
expiry. A nonzero deadline must be in the future when the factory processes the
mint. After expiry, external writes stop, but the user can still close the channel.
The deadline does not change the address.

## Initial state and getters

`Pothole.create({ potholeId, factory })` calculates the canonical initial address
using the bundled code. Its initial keys, seqno and expiration are zero, and its
deployment ID is zero; its user and last message are null.
`Pothole.fromStorage(...)` rejects nondefault runtime fields.
`PotholeFactory.fromStorage(...)` accepts complete factory
configuration and requires a zero initial counter. Custom `toShard` options are
unsupported. Factory deployments and the mailbox's factory reference must use
basechain (workchain `0`). The initialized user and known internal-message sender
addresses must also be in basechain. Standalone mailbox deployment can select
another workchain; its factory and user must still be in basechain.

`Pothole.sendDeploy(...)` sends an empty funding/deployment message. It leaves a
new account uninitialized. Initialization is a separate `InternalMintPothole`
message authenticated against the factory address in StateInit; the normal mint
flow handles both operations. `sendInternalMintPothole` exposes this low-level
message for tools that control the factory sender.

`getPotholeData()` returns one snapshot:

- `potholeId`, `factory`, `ownerPublicKey`, and `userPublicKey`;
- `user`: null before initialization, otherwise the authorized closing address;
- `seqno`: the next external message number;
- `lastMessage`: the latest opaque cell, or null before the first message;
- `expiration`: Unix seconds, with zero meaning no deadline;
- `deploymentId`: uint96 initialization identity, zero before initialization.

The authenticated initialization assigns `deploymentId` from the blockchain's
Unix timestamp in its high 32 bits and transaction logical time in its low 64
bits. The logical time distinguishes deployments even within the same second.
Empty deployment or funding messages do not assign or change it. Read this ID
from the getter and include it explicitly in every signed message: a signature
from a deleted channel cannot confirm a new initialization at the same address.

An initialized channel with `seqno = 0n` is awaiting the owner's confirmation.
No separate confirmation operation exists: the owner's first valid external
message confirms the channel and advances the counter to one.

`factory.getVersion()` returns `[0n, 1n, ".0"]`, representing version `0.1.0`,
shared by the contracts, ABI metadata, root package and SDK package.

## Encrypt and send

X25519 encryption keys are separate from the Ed25519 signing keys checked by the
contracts. Each peer needs its own private key and an authenticated public key
for the other peer. They derive the same shared key without a handshake. Keep
private and shared keys off-chain. Static X25519 does not provide forward secrecy.

```ts
import {
  deriveSharedKey, encryptData, bufferToSnakeCell,
} from "@metoncash/pothole-sdk";

// Persist key pairs created with generateEncryptionKeyPair().
const state = await mailbox.getPotholeData();
const context = Buffer.from(`pothole:testnet:${mailbox.address.toRawString()}:${state.deploymentId}`);
const key = deriveSharedKey(ownerEncryption.privateKey, userEncryption.publicKey, context);
const party = 0 as const; // Owner. The user sends as 1 on odd sequence numbers.
const aad = Buffer.from(JSON.stringify([context.toString("hex"), party, state.seqno.toString()]));
const ciphertext = bufferToSnakeCell(encryptData("Channel confirmed", key, aad));

await mailbox.sendMessage({
  deploymentId: state.deploymentId,
  seqno: state.seqno,
  sender: party,
  validUntil: BigInt(Math.floor(Date.now() / 1000) + 300),
  ciphertext,
}, ownerSigning.secretKey);
```

The owner sends even sequence numbers, starting at zero; the user sends odd
sequence numbers. `secretKey` is a 64-byte Ed25519 secret key, such as the value
returned by `@ton/crypto`'s `keyPairFromSeed`, not a raw 32-byte seed.

`sendMessage` binds the destination to the mailbox and signs the complete request
root hash, including `deploymentId` and every referenced payload cell. It requires
the caller's deployment ID and does not fetch or replace it automatically.
External writes replace the latest payload, produce no outgoing messages, and
consume the channel's TON
balance. `ciphertext` can be any arbitrary cell; byte payloads can use snake cells.

`createMessageToSign(params)` returns the unsigned request cell.
`signMessage(params, secretKey)` builds the complete external body for independent
transport, and `mailbox.sendExternal(body)` submits an already signed body.
Both signing helpers require `deploymentId` as a `bigint` in the uint96 range.
The new storage and signed request layouts require this matching contract/SDK
version; bodies signed with the previous layout cannot be reused.

## Read and decrypt

```ts
import { deriveSharedKey, decryptData, snakeCellToBuffer } from "@metoncash/pothole-sdk";

const state = await mailbox.getPotholeData();
if (state.lastMessage !== null && state.seqno > 0n) {
  const messageSeqno = state.seqno - 1n;
  const messageParty = Number(messageSeqno & 1n);
  const aad = Buffer.from(JSON.stringify([
    context.toString("hex"), messageParty, messageSeqno.toString(),
  ]));
  const key = deriveSharedKey(userEncryption.privateKey, ownerEncryption.publicKey, context);
  const plaintext = decryptData(snakeCellToBuffer(state.lastMessage), key, aad);
  console.log(plaintext.toString("utf8"));
}
```

AES-256-GCM payloads are `nonce[12] || tag[16] || ciphertext`, with a fresh nonce
for every encryption. Reproduce AAD exactly on receipt. Snake cells contain up to
127 bytes with one continuation reference and no comment prefix. The decoder
rejects branching, non-byte-aligned and exotic cells. TON message and cell-depth
limits still apply; SDK tests cover byte payloads through 32768 bytes.

## Close and withdraw

```ts
import { Pothole } from "@metoncash/pothole-sdk";
import { toNano } from "@ton/core";

const mailbox = client.open(Pothole.fromAddress(mailboxAddress));
await mailbox.sendClosePothole(userSender, toNano("0.05"), { queryId: 99n });
// Confirm deletion and the outgoing payout to the stored user.
```

`ClosePothole` is an internal message authorized by the stored user address. An
owner signing key does not grant permission to close. Closing works before the
owner's first message and after expiry. The contract sends its full remaining
TON balance, including the attached value less fees, to the stored user with a
`JettonExcesses` body carrying the query ID, then deletes the account. Blockchain
history remains available.

Close requests bounce by default. Open existing channels with `fromAddress` so
no deployment StateInit is attached when closing an already deleted channel.
A deleted channel cannot resume messaging; mint another channel when needed.

## Development and exports

```bash
# From the repository root after editing contracts:
npm run generate:sdk
npm run check:sdk
npm run test:sdk
```

Commit both regenerated `.gen.ts` files. Building and using the SDK does not
require Acton: compiled bytecode is embedded in the wrappers. The tests exercise
the actual compiled contracts, including owner-first messages, user-authorized
withdrawal, account deletion, expiration, and stale-signature rejection after
redeployment within the same second.

`generate:sdk` uses the TypeScript wrapper destination configured in `Acton.toml`;
the SDK's `generate` command delegates to this root command.

`check:sdk` requires the full repository and Acton. It builds the current
contracts and SDK, checks that the root package, SDK package and contract ABI
release versions agree, compares embedded bytecode, error codes and getter
availability against the compiler artifacts, and typechecks the SDK tests.
CI also regenerates the wrappers and checks for differences, so ABI changes
cannot silently leave stale codecs. The SDK's `check:contracts` command performs
the build and contract comparisons without the test typecheck.

Exports include `Pothole`, `PotholeFactory`, their configuration types,
`PotholeStorage`, `PotholeStorageRuntime`, `FactoryStorage`, `FactoryIncomingMessage`, `MintMessage`,
`InternalMintPothole`, `ClosePothole`, `ExternalMessageData`, `ExternalMessage`,
`JettonExcesses`, signing helpers, encryption helpers and snake helpers.
`MessageParams.sender` is `0 | 1`, representing owner and user respectively.
