import { Address, Cell, ContractProvider, Sender } from "@ton/core";
import {
  ClosePothole,
  InternalMintPothole,
  Pothole as GeneratedPothole,
} from "./Pothole.gen";
import { MessageParams, signMessage } from "../messages";
import {
  requireBasechain,
  requireBasechainSender,
  requireParticipants,
  requireUint,
} from "../utils/validation";
import { providerOptions, requireUnsharded, SendOptions } from "./options";

export interface PotholeConfig {
  potholeId: bigint;
  factory: Address;
}

export interface InternalMintParams {
  queryId?: bigint;
  ownerPublicKey: bigint;
  userPublicKey: bigint;
  user: Address;
  /** Absolute Unix seconds. 0 means no deadline. */
  expiration?: bigint;
}

export interface ClosePotholeParams {
  queryId?: bigint;
}

/** Owner-first messaging; only the stored user can close the channel. */
export class Pothole extends GeneratedPothole {
  static fromAddress(address: Address): Pothole {
    return new Pothole(address);
  }

  static fromStorage(...args: Parameters<typeof GeneratedPothole.fromStorage>): Pothole {
    const [storage] = args;
    requireUnsharded(args[1]);
    requireUint(storage.potholeId, 32, "potholeId");
    requireBasechain(storage.factory.ref, "factory");
    if (
      (storage.ownerPublicKey ?? 0n) !== 0n ||
      (storage.userPublicKey ?? 0n) !== 0n ||
      (storage.user ?? null) !== null ||
      (storage.seqno ?? 0n) !== 0n ||
      (storage.lastMessage ?? null) !== null ||
      (storage.expiration ?? 0n) !== 0n ||
      (storage.deploymentId ?? 0n) !== 0n
    ) {
      throw new Error("Initial mailbox configuration contains only potholeId and factory; runtime fields must keep their defaults.");
    }
    const generated = GeneratedPothole.fromStorage({
      ...storage,
      ownerPublicKey: 0n,
      userPublicKey: 0n,
      user: null,
      seqno: 0n,
      lastMessage: null,
      expiration: 0n,
      deploymentId: 0n,
    }, args[1]);
    return new Pothole(generated.address, generated.init);
  }

  /** Derive the canonical uninitialized mailbox address from its ID and factory. */
  static create(config: PotholeConfig, workchain = 0): Pothole {
    return Pothole.fromStorage({
      potholeId: config.potholeId,
      factory: { ref: config.factory },
    }, { workchain });
  }

  /** Deploy or fund the account; only a subsequent factory message initializes it. */
  async sendDeploy(provider: ContractProvider, via: Sender, value: bigint, options: SendOptions = {}): Promise<void> {
    requireBasechainSender(via);
    await provider.internal(via, { value, ...providerOptions(options), body: Cell.EMPTY });
  }

  /** Low-level factory message. The contract authenticates via against its stored factory. */
  async sendInternalMintPothole(
    provider: ContractProvider,
    via: Sender,
    value: bigint,
    body: InternalMintParams,
    options: SendOptions = {},
  ): Promise<void> {
    requireBasechainSender(via);
    requireBasechain(body.user, "user");
    const { queryId = 0n, expiration = 0n } = body;
    requireUint(queryId, 64, "queryId");
    requireUint(expiration, 32, "expiration");
    requireParticipants(body.ownerPublicKey, body.userPublicKey);
    await provider.internal(via, {
      value,
      ...providerOptions(options),
      body: InternalMintPothole.toCell(InternalMintPothole.create({ ...body, queryId, expiration })),
    });
  }

  /** Return the remaining TON balance to the stored user and delete the account. */
  async sendClosePothole(
    provider: ContractProvider,
    via: Sender,
    value: bigint,
    body: ClosePotholeParams = {},
    options: SendOptions = {},
  ): Promise<void> {
    requireBasechainSender(via);
    const queryId = body.queryId ?? 0n;
    requireUint(queryId, 64, "queryId");
    await provider.internal(via, {
      value,
      ...providerOptions({ ...options, bounce: options.bounce ?? true }),
      body: ClosePothole.toCell(ClosePothole.create({ queryId })),
    });
  }

  async sendExternal(provider: ContractProvider, body: Cell): Promise<void> {
    await provider.external(body);
  }

  async sendMessage(
    provider: ContractProvider,
    params: Omit<MessageParams, "destination">,
    secretKey: Buffer,
  ): Promise<void> {
    await provider.external(signMessage({ ...params, destination: this.address }, secretKey));
  }
}
