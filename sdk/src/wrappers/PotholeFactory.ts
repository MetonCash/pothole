import { Address, Cell, ContractProvider, Sender } from "@ton/core";
import {
  FactoryIncomingMessage,
  MintMessage,
  PotholeFactory as GeneratedFactory,
} from "./PotholeFactory.gen";
import { Pothole } from "./Pothole";
import { requireBasechainSender, requirePublicKey, requireUint } from "../utils/validation";
import { providerOptions, requireUnsharded, SendOptions } from "./options";

export interface PotholeFactoryConfig {
  factoryId?: bigint;
  owner: Address;
  publicKey: bigint;
  /** Defaults to the compiled Pothole code bundled with the SDK. */
  potholeCode?: Cell;
}

export interface MintParams {
  queryId?: bigint;
  /** The user's Ed25519 public key; the factory supplies the owner's key. */
  publicKey: bigint;
  /** Absolute Unix seconds. 0 means no deadline. */
  expiration?: bigint;
}

export class PotholeFactory extends GeneratedFactory {
  static fromAddress(address: Address): PotholeFactory {
    return new PotholeFactory(address);
  }

  static fromStorage(...args: Parameters<typeof GeneratedFactory.fromStorage>): PotholeFactory {
    const [storage] = args;
    requireUnsharded(args[1]);
    if ((args[1]?.workchain ?? 0) !== 0) {
      throw new RangeError("Factory deployment must use the basechain (workchain 0).");
    }
    requireUint(storage.factoryId ?? 0n, 64, "factoryId");
    requirePublicKey(storage.publicKey, "publicKey");
    if ((storage.lastPotholeId ?? 0n) !== 0n) {
      throw new Error("A new factory must start with lastPotholeId = 0.");
    }
    const generated = GeneratedFactory.fromStorage({
      ...storage,
      factoryId: storage.factoryId ?? 0n,
      lastPotholeId: 0n,
    }, args[1]);
    return new PotholeFactory(generated.address, generated.init);
  }

  static create(config: PotholeFactoryConfig, workchain = 0): PotholeFactory {
    return PotholeFactory.fromStorage({
      factoryId: config.factoryId ?? 0n,
      owner: config.owner,
      publicKey: config.publicKey,
      potholeCode: config.potholeCode ?? Pothole.CodeCell,
    }, { workchain });
  }

  async sendDeploy(provider: ContractProvider, via: Sender, value: bigint, options: SendOptions = {}): Promise<void> {
    requireBasechainSender(via);
    await provider.internal(via, { value, ...providerOptions(options), body: Cell.EMPTY });
  }

  async sendMintMessage(
    provider: ContractProvider,
    via: Sender,
    value: bigint,
    body: MintParams,
    options: SendOptions = {},
  ): Promise<void> {
    requireBasechainSender(via);
    const { queryId = 0n, expiration = 0n } = body;
    requireUint(queryId, 64, "queryId");
    requireUint(expiration, 32, "expiration");
    requirePublicKey(body.publicKey, "publicKey");
    await provider.internal(via, {
      value,
      ...providerOptions(options),
      body: MintMessage.toCell(MintMessage.create({ publicKey: body.publicKey, queryId, expiration })),
    });
  }

  async sendFactoryIncomingMessage(
    provider: ContractProvider,
    via: Sender,
    value: bigint,
    body: FactoryIncomingMessage,
    options: SendOptions = {},
  ): Promise<void> {
    await this.sendMintMessage(provider, via, value, body, options);
  }

  async getPotholeAddress(provider: ContractProvider, potholeId: bigint): Promise<Address> {
    requireUint(potholeId, 32, "potholeId");
    return super.getPotholeAddress(provider, potholeId);
  }
}
