// AUTO-GENERATED, do not edit
// It's a TypeScript wrapper for a PotholeFactory contract in Tolk.
/* eslint-disable */

import * as c from '@ton/core';
import { beginCell, ContractProvider, Sender, SendMode } from '@ton/core';

// ————————————————————————————————————————————
//   predefined types and functions
//

type StoreCallback<T> = (obj: T, b: c.Builder) => void
type LoadCallback<T> = (s: c.Slice) => T

export type CellRef<T> = {
    ref: T
}

function makeCellFrom<T>(self: T, storeFn_T: StoreCallback<T>): c.Cell {
    let b = beginCell();
    storeFn_T(self, b);
    return b.endCell();
}

function loadAndCheckPrefix32(s: c.Slice, expected: number, structName: string): void {
    let prefix = s.loadUint(32);
    if (prefix !== expected) {
        throw new Error(`Incorrect prefix for '${structName}': expected 0x${expected.toString(16).padStart(8, '0')}, got 0x${prefix.toString(16).padStart(8, '0')}`);
    }
}

function lookupPrefix(s: c.Slice, expected: number, prefixLen: number): boolean {
    return s.remainingBits >= prefixLen && s.preloadUint(prefixLen) === expected;
}

function throwNonePrefixMatch(fieldPath: string): never {
    throw new Error(`Incorrect prefix for '${fieldPath}': none of variants matched`);
}

function storeCellRef<T>(cell: CellRef<T>, b: c.Builder, storeFn_T: StoreCallback<T>): void {
    let b_ref = c.beginCell();
    storeFn_T(cell.ref, b_ref);
    b.storeRef(b_ref.endCell());
}

function loadCellRef<T>(s: c.Slice, loadFn_T: LoadCallback<T>): CellRef<T> {
    let s_ref = s.loadRef().beginParse();
    return { ref: loadFn_T(s_ref) };
}

function storeTolkNullable<T>(v: T | null, b: c.Builder, storeFn_T: StoreCallback<T>): void {
    if (v === null) {
        b.storeUint(0, 1);
    } else {
        b.storeUint(1, 1);
        storeFn_T(v, b);
    }
}

// ————————————————————————————————————————————
//   parse get methods result from a TVM stack
//

class StackReader {
    constructor(private tuple: c.TupleItem[]) {
    }

    static fromGetMethod(expectedN: number, getMethodResult: { stack: c.TupleReader }): StackReader {
        let tuple = [] as c.TupleItem[];
        while (getMethodResult.stack.remaining) {
            tuple.push(getMethodResult.stack.pop());
        }
        if (tuple.length !== expectedN) {
            throw new Error(`expected ${expectedN} stack width, got ${tuple.length}`);
        }
        return new StackReader(tuple);
    }

    private popExpecting<ItemT>(itemType: string): ItemT {
        const item = this.tuple.shift();
        if (item?.type === itemType) {
            return item as ItemT;
        }
        throw new Error(`not '${itemType}' on a stack`);
    }

    private popCellLike(): c.Cell {
        const item = this.tuple.shift();
        if (item && (item.type === 'cell' || item.type === 'slice' || item.type === 'builder')) {
            return item.cell;
        }
        throw new Error(`not cell/slice on a stack`);
    }

    readBigInt(): bigint {
        return this.popExpecting<c.TupleItemInt>('int').value;
    }

    readBoolean(): boolean {
        return this.popExpecting<c.TupleItemInt>('int').value !== 0n;
    }

    readCell(): c.Cell {
        return this.popCellLike();
    }

    readSlice(): c.Slice {
        return this.popCellLike().beginParse();
    }

    readSnakeString(): string {
        return this.readCell().beginParse().loadStringTail();
    }
}

// ————————————————————————————————————————————
//   auto-generated serializers to/from cells
//

type coins = bigint

type uint32 = bigint
type uint64 = bigint
type uint256 = bigint

/**
 > struct FactoryStorage {
 >     factoryId: uint64
 >     lastPotholeId: uint32
 >     owner: address
 >     publicKey: uint256
 >     potholeCode: cell
 > }
 */
export interface FactoryStorage {
    readonly $: 'FactoryStorage'
    factoryId: uint64 /* = 0 */
    lastPotholeId: uint32 /* = 0 */
    owner: c.Address
    publicKey: uint256
    potholeCode: c.Cell
}

export const FactoryStorage = {
    create(args: {
        factoryId?: uint64 /* = 0 */
        lastPotholeId?: uint32 /* = 0 */
        owner: c.Address
        publicKey: uint256
        potholeCode: c.Cell
    }): FactoryStorage {
        return {
            $: 'FactoryStorage',
            factoryId: 0n,
            lastPotholeId: 0n,
            ...args
        }
    },
    fromSlice(s: c.Slice): FactoryStorage {
        return {
            $: 'FactoryStorage',
            factoryId: s.loadUintBig(64),
            lastPotholeId: s.loadUintBig(32),
            owner: s.loadAddress(),
            publicKey: s.loadUintBig(256),
            potholeCode: s.loadRef(),
        }
    },
    store(self: FactoryStorage, b: c.Builder): void {
        b.storeUint(self.factoryId, 64);
        b.storeUint(self.lastPotholeId, 32);
        b.storeAddress(self.owner);
        b.storeUint(self.publicKey, 256);
        b.storeRef(self.potholeCode);
    },
    toCell(self: FactoryStorage): c.Cell {
        return makeCellFrom<FactoryStorage>(self, FactoryStorage.store);
    }
}

/**
 > struct (0x78beff58) MintMessage {
 >     queryId: uint64
 >     publicKey: uint256
 >     expiration: uint32
 > }
 */
export interface MintMessage {
    readonly $: 'MintMessage'
    queryId: uint64
    publicKey: uint256
    expiration: uint32
}

export const MintMessage = {
    PREFIX: 0x78beff58,

    create(args: {
        queryId: uint64
        publicKey: uint256
        expiration: uint32
    }): MintMessage {
        return {
            $: 'MintMessage',
            ...args
        }
    },
    fromSlice(s: c.Slice): MintMessage {
        loadAndCheckPrefix32(s, 0x78beff58, 'MintMessage');
        return {
            $: 'MintMessage',
            queryId: s.loadUintBig(64),
            publicKey: s.loadUintBig(256),
            expiration: s.loadUintBig(32),
        }
    },
    store(self: MintMessage, b: c.Builder): void {
        b.storeUint(0x78beff58, 32);
        b.storeUint(self.queryId, 64);
        b.storeUint(self.publicKey, 256);
        b.storeUint(self.expiration, 32);
    },
    toCell(self: MintMessage): c.Cell {
        return makeCellFrom<MintMessage>(self, MintMessage.store);
    }
}

/**
 > type FactoryIncomingMessage = MintMessage
 */
export type FactoryIncomingMessage = MintMessage

export const FactoryIncomingMessage = {
    fromSlice(s: c.Slice): FactoryIncomingMessage {
        return MintMessage.fromSlice(s);
    },
    store(self: FactoryIncomingMessage, b: c.Builder): void {
        MintMessage.store(self, b);
    },
    toCell(self: FactoryIncomingMessage): c.Cell {
        return makeCellFrom<FactoryIncomingMessage>(self, FactoryIncomingMessage.store);
    }
}

/**
 > struct (0x696e6974) InternalMintPothole {
 >     queryId: uint64
 >     ownerPublicKey: uint256
 >     userPublicKey: uint256
 >     user: address
 >     expiration: uint32
 > }
 */
export interface InternalMintPothole {
    readonly $: 'InternalMintPothole'
    queryId: uint64
    ownerPublicKey: uint256
    userPublicKey: uint256
    user: c.Address
    expiration: uint32
}

export const InternalMintPothole = {
    PREFIX: 0x696e6974,

    create(args: {
        queryId: uint64
        ownerPublicKey: uint256
        userPublicKey: uint256
        user: c.Address
        expiration: uint32
    }): InternalMintPothole {
        return {
            $: 'InternalMintPothole',
            ...args
        }
    },
    fromSlice(s: c.Slice): InternalMintPothole {
        loadAndCheckPrefix32(s, 0x696e6974, 'InternalMintPothole');
        return {
            $: 'InternalMintPothole',
            queryId: s.loadUintBig(64),
            ownerPublicKey: s.loadUintBig(256),
            userPublicKey: s.loadUintBig(256),
            user: s.loadAddress(),
            expiration: s.loadUintBig(32),
        }
    },
    store(self: InternalMintPothole, b: c.Builder): void {
        b.storeUint(0x696e6974, 32);
        b.storeUint(self.queryId, 64);
        b.storeUint(self.ownerPublicKey, 256);
        b.storeUint(self.userPublicKey, 256);
        b.storeAddress(self.user);
        b.storeUint(self.expiration, 32);
    },
    toCell(self: InternalMintPothole): c.Cell {
        return makeCellFrom<InternalMintPothole>(self, InternalMintPothole.store);
    }
}

// ————————————————————————————————————————————
//    class PotholeFactory
//

interface ExtraSendOptions {
    bounce?: boolean                    // default: false
    sendMode?: SendMode                 // default: SendMode.PAY_GAS_SEPARATELY
    extraCurrencies?: c.ExtraCurrency   // default: empty dict
}

interface DeployedAddrOptions {
    workchain?: number                  // default: 0 (basechain)
    toShard?: { fixedPrefixLength: number; closeTo: c.Address }
    overrideContractCode?: c.Cell
}

function calculateDeployedAddress(code: c.Cell, data: c.Cell, options: DeployedAddrOptions): c.Address {
    const stateInitCell = beginCell().store(c.storeStateInit({
        code,
        data,
        splitDepth: options.toShard?.fixedPrefixLength,
        special: null,
        libraries: null,
    })).endCell();

    let addrHash = stateInitCell.hash();
    if (options.toShard) {
        const shardDepth = options.toShard.fixedPrefixLength;
        addrHash = beginCell()
            .storeBits(new c.BitString(options.toShard.closeTo.hash, 0, shardDepth))
            .storeBits(new c.BitString(stateInitCell.hash(), shardDepth, 256 - shardDepth))
            .endCell()
            .beginParse().loadBuffer(32);
    }

    return new c.Address(options.workchain ?? 0, addrHash);
}

export class PotholeFactory implements c.Contract {
    static CodeCell = c.Cell.fromBase64('te6ccgECDQEAAbkAART/APSkE/S88sgLAQIBIAIDAgFIBAUACvKED/LwAUjQ+JGRMOD4koIAlZgB+kQw8vIg1ywjxff6xDHjAoQPAccA8vQGAgEgCAkB/NcsI8X3+sTyv9M/0//TH9HtRNCCCTEtAIIDDUCBcvj4l/iTc6m2AKoBUASgAnD4OxKgErzy9IIAm5MilvgjI7nDAJF/4vL00z/TH/pI0//XTIFChiKVJ8MAwwCRcOKVUye9wwCRcOLy9IFkpySEH7ny9PgoyPpSyW1tJqQIyAcA+Ms/GMsfFfpSI88L/yLPFMntVATIyx8UzHDPC/9wzwv/EvpUcM8LPxP0AHDPC3/J+JLIz5GluaXSF8s/E8v/FMv/FPpSyx/JyM+JiAFdyM+E0MzM+RbPC/+BAI3PC3QSzBLMzMmCCJiWgPgnbxD4LKD4lqG2CXD7AoMG+wACASAKCwCTvu0faiaGmfmOmPmP0kGOn/mOpo/BRkfSlktraCZGWPiWY4Z4X/uGeF//0qOGeFn4l6ADhnhb/kgORnwmhmZnyLZGfFACBl/+eoQBC7o+RwcYiAwAH7se7tRNDTP9Mf+kjT/9TRgABC4w');

    static Errors = {
        'Errors.InvalidParams': 17030,
        'Errors.InvalidOperation': 25767,
        'Errors.NotEnoughGas': 29432,
        'Errors.InvalidWorkchain': 38296,
        'Errors.Expired': 39827,
        'Errors.WrongOp': 65535,
    }

    readonly address: c.Address
    readonly init: { code: c.Cell, data: c.Cell } | undefined

    protected constructor(address: c.Address, init?: { code: c.Cell, data: c.Cell }) {
        this.address = address;
        this.init = init;
    }

    static fromAddress(address: c.Address) {
        return new PotholeFactory(address);
    }

    static fromStorage(emptyStorage: {
        factoryId?: uint64 /* = 0 */
        lastPotholeId?: uint32 /* = 0 */
        owner: c.Address
        publicKey: uint256
        potholeCode: c.Cell
    }, deployedOptions?: DeployedAddrOptions) {
        const initialState = {
            code: deployedOptions?.overrideContractCode ?? PotholeFactory.CodeCell,
            data: FactoryStorage.toCell(FactoryStorage.create(emptyStorage)),
        };
        const address = calculateDeployedAddress(initialState.code, initialState.data, deployedOptions ?? {});
        return new PotholeFactory(address, initialState);
    }

    static createCellOfFactoryIncomingMessage(body: FactoryIncomingMessage) {
        return FactoryIncomingMessage.toCell(body);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, msgValue: coins, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: c.Cell.EMPTY,
            ...extraOptions
        });
    }

    async sendFactoryIncomingMessage(provider: ContractProvider, via: Sender, msgValue: coins, body: FactoryIncomingMessage, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: FactoryIncomingMessage.toCell(body),
            ...extraOptions
        });
    }

    async getFactoryData(provider: ContractProvider): Promise<FactoryStorage> {
        const r = StackReader.fromGetMethod(5, await provider.get('getFactoryData', []));
        return ({
            $: 'FactoryStorage',
            factoryId: r.readBigInt(),
            lastPotholeId: r.readBigInt(),
            owner: r.readSlice().loadAddress(),
            publicKey: r.readBigInt(),
            potholeCode: r.readCell(),
        });
    }

    async getPotholeAddress(provider: ContractProvider, potholeId: bigint): Promise<c.Address> {
        const r = StackReader.fromGetMethod(1, await provider.get('getPotholeAddress', [
            { type: 'int', value: potholeId },
        ]));
        return r.readSlice().loadAddress();
    }

    async getVersion(provider: ContractProvider): Promise<[
        bigint,
        bigint,
        string,
    ]> {
        const r = StackReader.fromGetMethod(3, await provider.get('getVersion', []));
        return [
            r.readBigInt(),
            r.readBigInt(),
            r.readSnakeString(),
        ];
    }
}
