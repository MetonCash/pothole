# Pothole

A minimal two-party messaging protocol on TON, written in Tolk. Smart contracts
act as mailboxes for encrypted text or arbitrary data.

## How it works

A user requests a mailbox from a factory to communicate with the factory's owner.
The factory assigns a unique sequential ID and initializes the participants and
optional expiration. The owner sends the first signed message (`seqno = 0`) to
confirm the mailbox; owner and user then alternate turns.

Each external message is signed over the complete request cell hash, including
the payload and the mailbox's `deploymentId`. This 96-bit ID combines the Unix
timestamp and logical time of the authorized initialization transaction, so a
new mailbox at the same address has a different identity even within the same
second. Empty predeployment leaves the ID at zero until initialization. Clients
read the ID from `getPotholeData()` and include it in every signed request.

The contract checks the signature, destination, deployment ID, sequence number and
deadline, then stores the latest payload. Clients read it through a getter and
handle encryption and decryption locally. The contract accepts arbitrary cells;
the SDK supports snake encoding for larger byte payloads.

Accepted external messages create TON transactions and consume the mailbox's
balance, without sending outgoing messages. Empty internal transfers can top up
the balance. An expiration of `0` means no deadline; otherwise, writes stop when
the deadline is reached.

Only the registered user wallet can close the mailbox and withdraw its remaining
TON, less fees. Closing works before owner confirmation and after expiration.
Only the latest payload is kept in contract storage; blockchain history remains
public even after the contract is deleted.

## Build and test

Requires **Acton 1.2.1**, **Node.js 22+** and **npm**. Run from the repository root:

```bash
npm ci
npm run build
npm run generate
npm run format:check
npm run lint
npm test
```

Tests run locally and cover messaging, signatures, replay protection, expiration,
factory integration, withdrawals and encrypted payload round trips.

Additional local commands:

```bash
npm run test:tolk # Contract tests
npm run test:node # Encryption and snake payload round trips
npm run test:gas  # Gas and fee measurements in the emulator
```

`npm run format` formats the Tolk sources. Project commands live in `package.json`;
`Acton.toml` configures the toolchain, contracts, wrapper output and import paths.

## TypeScript SDK

The [`sdk/`](sdk/README.md) package provides contract wrappers, message signing,
encryption and snake serialization helpers. See its README for usage examples.

```bash
npm ci --prefix sdk
npm run check:sdk
npm run test:sdk
```

After changing contracts, regenerate the Tolk and SDK wrappers with
`npm run generate` and `npm run generate:sdk`.

The deployment ID changes the storage and signed-message layouts. Contracts and
clients using the earlier layout must be redeployed or updated together; existing
signed messages are not compatible with this version of the layout.

## Contract scripts

Configure public keys and addresses using [`.env.example`](.env.example). Pass
Acton options after `--`:

```bash
npm run deploy:factory -- --net testnet
npm run mint -- --net testnet
npm run send -- --net testnet
npm run read -- --net testnet
npm run close -- --net testnet
```

Configure the Acton wallet `deployer` for deployment and `POTHOLE_WALLET` (default
`alice`) for mint, send and close. Deploy, mint and close require wallet funds;
external messages use the mailbox balance. Reading requires no wallet.

`npm run deploy` initializes a standalone mailbox. Deployment commands run in the
local emulator when `--net` is omitted.

## Project files

- [`contracts/`](contracts/) — Pothole, factory and shared contract code.
- [`tests/`](tests/) — Contract, integration, encryption and gas tests.
- [`scripts/`](scripts/) — Deployment, messaging, reading and closing tools.
- [`.env.example`](.env.example) — Configuration examples for the scripts.

Licensed under [MIT](LICENSE).
