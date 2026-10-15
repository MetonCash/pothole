import { Address, beginCell, Cell, ContractProvider, Sender, SendMode } from "@ton/core";
import { keyPairFromSeed, signVerify } from "@ton/crypto";
import {
  createMessageToSign,
  ClosePothole,
  InternalMintPothole,
  MessageParams,
  ExternalMessageData,
  FactoryIncomingMessage,
  MintMessage,
  Pothole,
  PotholeFactory,
  PotholeStorage,
  publicKeyToBigInt,
  signMessage,
} from "../src";

const factoryAddress = Address.parseRaw(`0:${"11".repeat(32)}`);
const otherAddress = Address.parseRaw(`0:${"22".repeat(32)}`);
const ownerSigning = keyPairFromSeed(Buffer.alloc(32, 1));
const userSigning = keyPairFromSeed(Buffer.alloc(32, 2));
const ownerPublicKey = publicKeyToBigInt(ownerSigning.publicKey);
const userPublicKey = publicKeyToBigInt(userSigning.publicKey);
const storage = { potholeId: 7n, factory: { ref: factoryAddress } };
const factoryStorage = { owner: factoryAddress, publicKey: ownerPublicKey, potholeCode: Pothole.CodeCell };
const params: MessageParams = {
  destination: factoryAddress,
  deploymentId: (1_700_000_000n << 64n) | 9_007_199_254_740_993n,
  seqno: 9_007_199_254_740_993n,
  validUntil: 1_700_000_060n,
  sender: 1,
  ciphertext: beginCell().storeUint(5, 3).storeRef(Cell.EMPTY).endCell(),
};

function captureInternal() {
  const internal = jest.fn<ReturnType<ContractProvider["internal"]>, Parameters<ContractProvider["internal"]>>()
    .mockResolvedValue(undefined);
  const provider = { internal } as unknown as ContractProvider;
  const sender: Sender = { address: factoryAddress, send: async () => {} };
  return { internal, provider, sender };
}

describe("public SDK message and deployment helpers", () => {
  it("signs the complete request root once and keeps its arbitrary payload reference", () => {
    const expectedRoot = beginCell()
      .storeUint(0x706f7468, 32)
      .storeAddress(params.destination)
      .storeUint(params.deploymentId, 96)
      .storeUint(params.seqno, 64)
      .storeUint(params.validUntil, 32)
      .storeUint(params.sender, 1)
      .storeRef(params.ciphertext)
      .endCell();
    const envelope = signMessage(params, userSigning.secretKey).beginParse();
    expect(envelope.remainingBits).toBe(512);
    expect(envelope.remainingRefs).toBe(1);
    const signature = envelope.loadBuffer(64);
    const root = envelope.loadRef();
    envelope.endParse();

    expect(root.hash()).toEqual(expectedRoot.hash());
    expect(root.refs[0].hash()).toEqual(params.ciphertext.hash());
    expect(signVerify(root.hash(), signature, userSigning.publicKey)).toBe(true);
    expect(signVerify(params.ciphertext.hash(), signature, userSigning.publicKey)).toBe(false);
    expect(signVerify(root.hash(), signature, ownerSigning.publicKey)).toBe(false);
    const decoded = ExternalMessageData.fromSlice(root.beginParse());
    expect(decoded.deploymentId).toBe(params.deploymentId);
    expect(decoded.seqno).toBe(params.seqno);
  });

  it("binds destination, deployment, sequence, deadline, sender, and nested payload data to the signature", () => {
    const signature = signMessage(params, userSigning.secretKey).beginParse().loadBuffer(64);
    const changes: Partial<MessageParams>[] = [
      { destination: otherAddress },
      { deploymentId: params.deploymentId + 1n },
      { seqno: params.seqno + 1n },
      { validUntil: params.validUntil + 1n },
      { sender: 0 },
      { ciphertext: beginCell().storeUint(5, 3).storeRef(beginCell().storeBit(1).endCell()).endCell() },
    ];
    for (const change of changes) {
      const root = createMessageToSign({ ...params, ...change });
      expect(signVerify(root.hash(), signature, userSigning.publicKey)).toBe(false);
    }
  });

  it("preserves maximum uint values and rejects unsafe numbers or invalid request fields", () => {
    const root = createMessageToSign({
      ...params, deploymentId: (1n << 96n) - 1n, seqno: (1n << 64n) - 1n, validUntil: (1n << 32n) - 1n,
    });
    const decoded = ExternalMessageData.fromSlice(root.beginParse());
    expect(decoded.deploymentId).toBe((1n << 96n) - 1n);
    expect(decoded.seqno).toBe((1n << 64n) - 1n);
    expect(decoded.validUntil).toBe((1n << 32n) - 1n);
    for (const deploymentId of [-1n, 1n << 96n, 1 as unknown as bigint, undefined as unknown as bigint]) {
      expect(() => createMessageToSign({ ...params, deploymentId })).toThrow("deploymentId");
    }
    for (const seqno of [-1n, 1n << 64n, 1 as unknown as bigint]) {
      expect(() => createMessageToSign({ ...params, seqno })).toThrow("seqno");
    }
    for (const validUntil of [-1n, 1n << 32n, 1 as unknown as bigint]) {
      expect(() => createMessageToSign({ ...params, validUntil })).toThrow("validUntil");
    }
    expect(() => createMessageToSign({ ...params, sender: 2 as 0 | 1 })).toThrow("sender");
  });

  it("requires expanded Ed25519 secret keys and converts public keys as unsigned big-endian bytes", () => {
    for (const secretKey of [Buffer.alloc(32), Buffer.alloc(63), Buffer.alloc(65), new Uint8Array(64) as Buffer]) {
      expect(() => signMessage(params, secretKey)).toThrow("64-byte Ed25519 secret key");
    }
    const bytes = new Uint8Array(32);
    bytes[0] = 0x80;
    bytes[31] = 1;
    expect(publicKeyToBigInt(bytes)).toBe((1n << 255n) + 1n);
    expect(publicKeyToBigInt(Buffer.alloc(32))).toBe(0n);
    for (const publicKey of [new Uint8Array(31), new Uint8Array(33), "00" as unknown as Uint8Array]) {
      expect(() => publicKeyToBigInt(publicKey)).toThrow("exactly 32 bytes");
    }
  });

  it("requires the caller's deployment identity when sending a signed message", async () => {
    const external = jest.fn<ReturnType<ContractProvider["external"]>, Parameters<ContractProvider["external"]>>()
      .mockResolvedValue(undefined);
    const provider = { external } as unknown as ContractProvider;
    const mailbox = Pothole.fromAddress(otherAddress);
    const request = {
      deploymentId: params.deploymentId, seqno: params.seqno, validUntil: params.validUntil,
      sender: params.sender, ciphertext: params.ciphertext,
    };
    await mailbox.sendMessage(provider, request, userSigning.secretKey);
    expect(external).toHaveBeenCalledTimes(1);
    const encoded = external.mock.calls[0][0].beginParse().loadRef();
    const decoded = ExternalMessageData.fromSlice(encoded.beginParse());
    expect(decoded.destination.equals(mailbox.address)).toBe(true);
    expect(decoded.deploymentId).toBe(params.deploymentId);
    await expect(mailbox.sendMessage(provider, {
      ...request, deploymentId: undefined as unknown as bigint,
    }, userSigning.secretKey)).rejects.toThrow("deploymentId");
    expect(external).toHaveBeenCalledTimes(1);
  });

  it("creates canonical initial storage from only the ID and factory", () => {
    const mailbox = Pothole.create({ potholeId: 7n, factory: factoryAddress });
    expect(mailbox).toBeInstanceOf(Pothole);
    expect(Pothole.fromStorage(storage).address.equals(mailbox.address)).toBe(true);
    const initial = PotholeStorage.fromSlice(mailbox.init!.data.beginParse());
    expect(initial.potholeId).toBe(7n);
    expect(initial.factory.ref.equals(factoryAddress)).toBe(true);
    expect(initial.ownerPublicKey).toBe(0n);
    expect(initial.userPublicKey).toBe(0n);
    expect(initial.user).toBeNull();
    expect(initial.seqno).toBe(0n);
    expect(initial.lastMessage).toBeNull();
    expect(initial.expiration).toBe(0n);
    expect(initial.deploymentId).toBe(0n);
    const explicitUndefined = Pothole.fromStorage({
      ...storage,
      ownerPublicKey: undefined,
      userPublicKey: undefined,
      user: undefined,
      seqno: undefined,
      lastMessage: undefined,
      expiration: undefined,
      deploymentId: undefined,
    });
    expect(explicitUndefined.address.equals(mailbox.address)).toBe(true);
    expect(explicitUndefined.init!.data.hash()).toEqual(mailbox.init!.data.hash());
    for (const patch of [
      { ownerPublicKey }, { userPublicKey }, { user: otherAddress },
      { seqno: 1n }, { lastMessage: Cell.EMPTY }, { expiration: 1n }, { deploymentId: 1n },
    ]) {
      expect(() => Pothole.fromStorage({ ...storage, ...patch })).toThrow("runtime fields must keep their defaults");
    }
    expect(() => Pothole.create({ potholeId: 1n << 32n, factory: factoryAddress })).toThrow("potholeId");
  });

  it("rejects unsupported shard-address options and nonzero initial factory counters", () => {
    const options = { toShard: { fixedPrefixLength: 1, closeTo: factoryAddress } };
    expect(() => Pothole.fromStorage(storage, options)).toThrow("toShard deployment is not supported");
    expect(() => PotholeFactory.fromStorage(factoryStorage, options)).toThrow("toShard deployment is not supported");
    expect(() => PotholeFactory.fromStorage({ ...factoryStorage, lastPotholeId: 1n })).toThrow("lastPotholeId = 0");
    expect(() => PotholeFactory.create({ owner: factoryAddress, publicKey: 0n })).toThrow("publicKey");
    expect(PotholeFactory.create(factoryStorage)).toBeInstanceOf(PotholeFactory);
    expect(PotholeFactory.fromStorage({
      ...factoryStorage, factoryId: undefined, lastPotholeId: undefined,
    }).address.equals(PotholeFactory.create(factoryStorage).address)).toBe(true);
  });

  it("requires basechain factory deployments and references while allowing mailbox and owner metadata on other chains", () => {
    const masterchain = new Address(-1, factoryAddress.hash);
    expect(() => Pothole.create({ potholeId: 0n, factory: masterchain })).toThrow("basechain");
    expect(() => Pothole.fromStorage({ ...storage, factory: { ref: masterchain } })).toThrow("basechain");
    expect(() => PotholeFactory.create(factoryStorage, -1)).toThrow("basechain");
    expect(() => PotholeFactory.fromStorage(factoryStorage, { workchain: -1 })).toThrow("basechain");
    expect(Pothole.create({ potholeId: 0n, factory: factoryAddress }, -1).address.workChain).toBe(-1);
    expect(PotholeFactory.create({ ...factoryStorage, owner: masterchain }).address.workChain).toBe(0);
  });

  it("rejects known non-basechain internal senders and initialization users before sending", async () => {
    const { internal, provider, sender } = captureInternal();
    const masterchain = new Address(-1, factoryAddress.hash);
    const invalidSender = { ...sender, address: masterchain };
    const mailbox = Pothole.fromAddress(otherAddress);
    const factory = PotholeFactory.create(factoryStorage);
    const init = { ownerPublicKey, userPublicKey, user: otherAddress };
    const mint = MintMessage.create({ queryId: 0n, publicKey: userPublicKey, expiration: 0n });
    for (const send of [
      () => mailbox.sendDeploy(provider, invalidSender, 1n),
      () => mailbox.sendInternalMintPothole(provider, invalidSender, 1n, init),
      () => mailbox.sendClosePothole(provider, invalidSender, 1n),
      () => factory.sendDeploy(provider, invalidSender, 1n),
      () => factory.sendMintMessage(provider, invalidSender, 1n, mint),
      () => factory.sendFactoryIncomingMessage(provider, invalidSender, 1n, mint),
    ]) {
      await expect(send()).rejects.toThrow("sender must be in the basechain");
    }
    await expect(mailbox.sendInternalMintPothole(provider, sender, 1n, { ...init, user: masterchain }))
      .rejects.toThrow("user must be in the basechain");
    expect(internal).not.toHaveBeenCalled();

    // An abstract wallet may not reveal its address; the contract still authenticates it.
    const unknownSender: Sender = { send: async () => {} };
    await mailbox.sendClosePothole(provider, unknownSender, 1n);
    expect(internal).toHaveBeenCalledWith(unknownSender, expect.any(Object));
  });

  it("deploys empty initial state and encodes the separate authenticated factory initialization", async () => {
    const { internal, provider, sender } = captureInternal();
    const mailbox = Pothole.create({ potholeId: 7n, factory: factoryAddress });
    const extraCurrencies = { 7: 123n };
    const init = { queryId: 9n, ownerPublicKey, userPublicKey, user: otherAddress, expiration: 1_700_000_060n };
    await mailbox.sendDeploy(provider, sender, 100_000_000n, { extraCurrencies });
    await mailbox.sendInternalMintPothole(provider, sender, 50_000_000n, init, { extraCurrencies });
    expect(internal).toHaveBeenCalledTimes(2);
    for (const [via, request] of internal.mock.calls) {
      expect(via).toBe(sender);
      expect(request.extracurrency).toEqual(extraCurrencies);
      expect(request).not.toHaveProperty("extraCurrencies");
      expect(request.sendMode).toBe(SendMode.PAY_GAS_SEPARATELY);
    }
    expect((internal.mock.calls[0][1].body as Cell).equals(Cell.EMPTY)).toBe(true);
    const decoded = InternalMintPothole.fromSlice((internal.mock.calls[1][1].body as Cell).beginParse());
    expect(decoded.user.equals(init.user)).toBe(true);
    expect({ ...decoded, user: undefined }).toEqual({ ...InternalMintPothole.create(init), user: undefined });
    expect(PotholeStorage.fromSlice(mailbox.init!.data.beginParse()).user).toBeNull();
  });

  it("encodes a user close with queryId and bounce enabled by default", async () => {
    const { internal, provider, sender } = captureInternal();
    const mailbox = Pothole.fromAddress(otherAddress);
    await mailbox.sendClosePothole(provider, sender, 50_000_000n);
    await mailbox.sendClosePothole(provider, sender, 50_000_000n, { queryId: (1n << 64n) - 1n }, {
      bounce: false, sendMode: SendMode.NONE, extraCurrencies: { 7: 5n },
    });
    await mailbox.sendClosePothole(provider, sender, 50_000_000n, {}, { bounce: undefined });
    const first = internal.mock.calls[0][1];
    expect(first.bounce).toBe(true);
    const firstBody = (first.body as Cell).beginParse();
    expect(firstBody.loadUint(32)).toBe(0x636c6f73);
    expect(firstBody.loadUintBig(64)).toBe(0n);
    firstBody.endParse();
    const second = internal.mock.calls[1][1];
    expect(second.bounce).toBe(false);
    expect(second.sendMode).toBe(SendMode.NONE);
    expect(second.extracurrency).toEqual({ 7: 5n });
    expect(ClosePothole.fromSlice((second.body as Cell).beginParse()).queryId).toBe((1n << 64n) - 1n);
    expect(internal.mock.calls[2][1].bounce).toBe(true);
    await expect(mailbox.sendClosePothole(provider, sender, 1n, { queryId: -1n })).rejects.toThrow("queryId");
    expect(internal).toHaveBeenCalledTimes(3);
  });

  it("uses MintMessage with user key and queryId rather than selecting the factory counter", async () => {
    const { internal, provider, sender } = captureInternal();
    const factory = PotholeFactory.create({ ...factoryStorage, factoryId: 7n });
    const extraCurrencies = { 8: 456n };
    const options = { extraCurrencies, bounce: true, sendMode: SendMode.NONE };
    const mint = { queryId: 1n << 60n, publicKey: userPublicKey, expiration: 0n };
    await factory.sendDeploy(provider, sender, 100_000_000n, options);
    await factory.sendMintMessage(provider, sender, 200_000_000n, mint, options);
    await factory.sendFactoryIncomingMessage(provider, sender, 200_000_000n, MintMessage.create(mint), options);
    expect(internal).toHaveBeenCalledTimes(3);
    for (const [via, request] of internal.mock.calls) {
      expect(via).toBe(sender);
      expect(request.extracurrency).toEqual(extraCurrencies);
      expect(request).not.toHaveProperty("extraCurrencies");
      expect(request.bounce).toBe(true);
      expect(request.sendMode).toBe(SendMode.NONE);
    }
    expect((internal.mock.calls[0][1].body as Cell).equals(Cell.EMPTY)).toBe(true);
    for (const [, request] of internal.mock.calls.slice(1)) {
      const encoded = request.body as Cell;
      expect(FactoryIncomingMessage.fromSlice(encoded.beginParse())).toEqual(MintMessage.create(mint));
      expect(FactoryIncomingMessage.toCell(MintMessage.create(mint)).hash()).toEqual(encoded.hash());
    }
    await expect(factory.sendMintMessage(provider, sender, 1n, { publicKey: 0n })).rejects.toThrow("publicKey");
    await expect(factory.sendMintMessage(provider, sender, 1n, { publicKey: userPublicKey, expiration: 1n << 32n }))
      .rejects.toThrow("expiration");
    await expect(factory.getPotholeAddress(provider, -1n)).rejects.toThrow("potholeId");
    expect(internal).toHaveBeenCalledTimes(3);
  });
});
