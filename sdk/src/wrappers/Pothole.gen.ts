// AUTO-GENERATED, do not edit
// It's a TypeScript wrapper for a Pothole contract in Tolk.
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

function storeTolkBitsN(v: c.Slice, nBits: number, b: c.Builder): void {
    if (v.remainingBits !== nBits) { throw new Error(`expected ${nBits} bits, got ${v.remainingBits}`); }
    if (v.remainingRefs !== 0) { throw new Error(`expected 0 refs, got ${v.remainingRefs}`); }
    b.storeSlice(v);
}

function loadTolkBitsN(s: c.Slice, nBits: number): c.Slice {
    return new c.Slice(new c.BitReader(s.loadBits(nBits)), []);
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

    readNullable<T>(readFn_T: (r: StackReader) => T): T | null {
        if (this.tuple[0].type === 'null') {
            this.tuple.shift();
            return null;
        }
        return readFn_T(this);
    }
}

// ————————————————————————————————————————————
//   auto-generated serializers to/from cells
//

type coins = bigint

type uint1 = bigint
type uint32 = bigint
type uint64 = bigint
type uint96 = bigint
type uint256 = bigint

type bits512 = c.Slice

/**
 > struct PotholeStorage {
 >     potholeId: uint32
 >     factory: Cell<address>
 >     ownerPublicKey: uint256
 >     userPublicKey: uint256
 >     user: address?
 >     seqno: uint64
 >     lastMessage: cell?
 >     expiration: uint32
 >     deploymentId: uint96
 > }
 */
export interface PotholeStorage {
    readonly $: 'PotholeStorage'
    potholeId: uint32
    factory: CellRef<c.Address>
    ownerPublicKey: uint256 /* = 0 */
    userPublicKey: uint256 /* = 0 */
    user: c.Address | null /* = null */
    seqno: uint64 /* = 0 */
    lastMessage: c.Cell | null /* = null */
    expiration: uint32 /* = 0 */
    deploymentId: uint96 /* = 0 */
}

export const PotholeStorage = {
    create(args: {
        potholeId: uint32
        factory: CellRef<c.Address>
        ownerPublicKey?: uint256 /* = 0 */
        userPublicKey?: uint256 /* = 0 */
        user?: c.Address | null /* = null */
        seqno?: uint64 /* = 0 */
        lastMessage?: c.Cell | null /* = null */
        expiration?: uint32 /* = 0 */
        deploymentId?: uint96 /* = 0 */
    }): PotholeStorage {
        return {
            $: 'PotholeStorage',
            ownerPublicKey: 0n,
            userPublicKey: 0n,
            user: null,
            seqno: 0n,
            lastMessage: null,
            expiration: 0n,
            deploymentId: 0n,
            ...args
        }
    },
    fromSlice(s: c.Slice): PotholeStorage {
        return {
            $: 'PotholeStorage',
            potholeId: s.loadUintBig(32),
            factory: loadCellRef<c.Address>(s,
                (s) => s.loadAddress()
            ),
            ownerPublicKey: s.loadUintBig(256),
            userPublicKey: s.loadUintBig(256),
            user: s.loadMaybeAddress(),
            seqno: s.loadUintBig(64),
            lastMessage: s.loadBoolean() ? s.loadRef() : null,
            expiration: s.loadUintBig(32),
            deploymentId: s.loadUintBig(96),
        }
    },
    store(self: PotholeStorage, b: c.Builder): void {
        b.storeUint(self.potholeId, 32);
        storeCellRef<c.Address>(self.factory, b,
            (v,b) => b.storeAddress(v)
        );
        b.storeUint(self.ownerPublicKey, 256);
        b.storeUint(self.userPublicKey, 256);
        b.storeAddress(self.user);
        b.storeUint(self.seqno, 64);
        storeTolkNullable<c.Cell>(self.lastMessage, b,
            (v,b) => b.storeRef(v)
        );
        b.storeUint(self.expiration, 32);
        b.storeUint(self.deploymentId, 96);
    },
    toCell(self: PotholeStorage): c.Cell {
        return makeCellFrom<PotholeStorage>(self, PotholeStorage.store);
    }
}

/**
 > struct PotholeStorageRuntime {
 >     potholeId: uint32
 >     factory: address
 >     ownerPublicKey: uint256
 >     userPublicKey: uint256
 >     user: address?
 >     seqno: uint64
 >     lastMessage: cell?
 >     expiration: uint32
 >     deploymentId: uint96
 > }
 */
export interface PotholeStorageRuntime {
    readonly $: 'PotholeStorageRuntime'
    potholeId: uint32
    factory: c.Address
    ownerPublicKey: uint256
    userPublicKey: uint256
    user: c.Address | null
    seqno: uint64
    lastMessage: c.Cell | null
    expiration: uint32
    deploymentId: uint96
}

export const PotholeStorageRuntime = {
    create(args: {
        potholeId: uint32
        factory: c.Address
        ownerPublicKey: uint256
        userPublicKey: uint256
        user: c.Address | null
        seqno: uint64
        lastMessage: c.Cell | null
        expiration: uint32
        deploymentId: uint96
    }): PotholeStorageRuntime {
        return {
            $: 'PotholeStorageRuntime',
            ...args
        }
    },
    fromSlice(s: c.Slice): PotholeStorageRuntime {
        return {
            $: 'PotholeStorageRuntime',
            potholeId: s.loadUintBig(32),
            factory: s.loadAddress(),
            ownerPublicKey: s.loadUintBig(256),
            userPublicKey: s.loadUintBig(256),
            user: s.loadMaybeAddress(),
            seqno: s.loadUintBig(64),
            lastMessage: s.loadBoolean() ? s.loadRef() : null,
            expiration: s.loadUintBig(32),
            deploymentId: s.loadUintBig(96),
        }
    },
    store(self: PotholeStorageRuntime, b: c.Builder): void {
        b.storeUint(self.potholeId, 32);
        b.storeAddress(self.factory);
        b.storeUint(self.ownerPublicKey, 256);
        b.storeUint(self.userPublicKey, 256);
        b.storeAddress(self.user);
        b.storeUint(self.seqno, 64);
        storeTolkNullable<c.Cell>(self.lastMessage, b,
            (v,b) => b.storeRef(v)
        );
        b.storeUint(self.expiration, 32);
        b.storeUint(self.deploymentId, 96);
    },
    toCell(self: PotholeStorageRuntime): c.Cell {
        return makeCellFrom<PotholeStorageRuntime>(self, PotholeStorageRuntime.store);
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

/**
 > struct (0x706f7468) ExternalMessageData {
 >     destination: address
 >     deploymentId: uint96
 >     seqno: uint64
 >     validUntil: uint32
 >     sender: uint1
 >     ciphertext: cell
 > }
 */
export interface ExternalMessageData {
    readonly $: 'ExternalMessageData'
    destination: c.Address
    deploymentId: uint96
    seqno: uint64
    validUntil: uint32
    sender: uint1
    ciphertext: c.Cell
}

export const ExternalMessageData = {
    PREFIX: 0x706f7468,

    create(args: {
        destination: c.Address
        deploymentId: uint96
        seqno: uint64
        validUntil: uint32
        sender: uint1
        ciphertext: c.Cell
    }): ExternalMessageData {
        return {
            $: 'ExternalMessageData',
            ...args
        }
    },
    fromSlice(s: c.Slice): ExternalMessageData {
        loadAndCheckPrefix32(s, 0x706f7468, 'ExternalMessageData');
        return {
            $: 'ExternalMessageData',
            destination: s.loadAddress(),
            deploymentId: s.loadUintBig(96),
            seqno: s.loadUintBig(64),
            validUntil: s.loadUintBig(32),
            sender: s.loadUintBig(1),
            ciphertext: s.loadRef(),
        }
    },
    store(self: ExternalMessageData, b: c.Builder): void {
        b.storeUint(0x706f7468, 32);
        b.storeAddress(self.destination);
        b.storeUint(self.deploymentId, 96);
        b.storeUint(self.seqno, 64);
        b.storeUint(self.validUntil, 32);
        b.storeUint(self.sender, 1);
        b.storeRef(self.ciphertext);
    },
    toCell(self: ExternalMessageData): c.Cell {
        return makeCellFrom<ExternalMessageData>(self, ExternalMessageData.store);
    }
}

/**
 > struct ExternalMessage {
 >     signature: bits512
 >     message: Cell<ExternalMessageData>
 > }
 */
export interface ExternalMessage {
    readonly $: 'ExternalMessage'
    signature: bits512
    message: CellRef<ExternalMessageData>
}

export const ExternalMessage = {
    create(args: {
        signature: bits512
        message: CellRef<ExternalMessageData>
    }): ExternalMessage {
        return {
            $: 'ExternalMessage',
            ...args
        }
    },
    fromSlice(s: c.Slice): ExternalMessage {
        return {
            $: 'ExternalMessage',
            signature: loadTolkBitsN(s, 512),
            message: loadCellRef<ExternalMessageData>(s, ExternalMessageData.fromSlice),
        }
    },
    store(self: ExternalMessage, b: c.Builder): void {
        storeTolkBitsN(self.signature, 512, b);
        storeCellRef<ExternalMessageData>(self.message, b, ExternalMessageData.store);
    },
    toCell(self: ExternalMessage): c.Cell {
        return makeCellFrom<ExternalMessage>(self, ExternalMessage.store);
    }
}

/**
 > struct (0x636c6f73) ClosePothole {
 >     queryId: uint64
 > }
 */
export interface ClosePothole {
    readonly $: 'ClosePothole'
    queryId: uint64 /* = 0 */
}

export const ClosePothole = {
    PREFIX: 0x636c6f73,

    create(args: {
        queryId?: uint64 /* = 0 */
    }): ClosePothole {
        return {
            $: 'ClosePothole',
            queryId: 0n,
            ...args
        }
    },
    fromSlice(s: c.Slice): ClosePothole {
        loadAndCheckPrefix32(s, 0x636c6f73, 'ClosePothole');
        return {
            $: 'ClosePothole',
            queryId: s.loadUintBig(64),
        }
    },
    store(self: ClosePothole, b: c.Builder): void {
        b.storeUint(0x636c6f73, 32);
        b.storeUint(self.queryId, 64);
    },
    toCell(self: ClosePothole): c.Cell {
        return makeCellFrom<ClosePothole>(self, ClosePothole.store);
    }
}

/**
 > struct (0xd53276db) JettonExcesses {
 >     queryId: uint64
 > }
 */
export interface JettonExcesses {
    readonly $: 'JettonExcesses'
    queryId: uint64
}

export const JettonExcesses = {
    PREFIX: 0xd53276db,

    create(args: {
        queryId: uint64
    }): JettonExcesses {
        return {
            $: 'JettonExcesses',
            ...args
        }
    },
    fromSlice(s: c.Slice): JettonExcesses {
        loadAndCheckPrefix32(s, 0xd53276db, 'JettonExcesses');
        return {
            $: 'JettonExcesses',
            queryId: s.loadUintBig(64),
        }
    },
    store(self: JettonExcesses, b: c.Builder): void {
        b.storeUint(0xd53276db, 32);
        b.storeUint(self.queryId, 64);
    },
    toCell(self: JettonExcesses): c.Cell {
        return makeCellFrom<JettonExcesses>(self, JettonExcesses.store);
    }
}

// ————————————————————————————————————————————
//    class Pothole
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

export class Pothole implements c.Contract {
    static CodeCell = c.Cell.fromBase64('te6ccgECCgEAAmAAART/APSkE/S88sgLAQIBIAIDAgFIBAUB+PKDCNcY1NEg0NcsI4N7o0Tyv/pI01/TP9Mf0wDU0e1E0NMf1NP/0//6UNM/9AQx0x/TX9EG0PpI0YFo+CRus/L0ggCbkyKW+CMjucMAkX/i8vSCALM5+CgfxwUe8vRRtbry42KCAJuTCfgjvBny9IEf/lGYuhny9IEf/icJAlrQ+JGRMOD4koIAlZgB+kQw8vIg1ywjS3NLpOMC1ywjG2N7nDHjAoQPAccA8vQGBwA7oG+n2omhpj+pp/+n//Shpn/oCaY/pr+iD6H0kaIPAf4w1ywjS3NLpPK/0z/T/9P/+kjTH9HtRNDTH9TT/zHT/zH6UNM/9ATTHzHTXzHRA9D6SNGCALM5+JIixwXy9IFBMQNuE/L0ggCVmCb6RDDy8oFChiiVJ8MAwwCRcOKVU4e9wwCRcOLy9CX4I6o/+CWxA8j6UskFyMsfFcwYy/8WCACw1ywjG2N7nPK/0z/R7UTQ0x8x1NP/MdP/MfpQ0z8x9AQx0x8x018x0QHQ+kgx0YFo+CFus/L0ggCzOfiSIscF8vTIz4UI+lKCENUydtvPC47LP8mBAKD7AAB6y/8S+lQVyz8U9AATyx/LX8ntVMjPhQj6UoIQ1TJ2288Ljss/yYIImJaA+CdvEPgsoPiWobYJcPsCgwb7AAC4hD+58vSCAOn5J3GwJ7ry9IFChiGVIsMAwwCRcOKVUyG9wwCRcOLy9FQ1UeMECvkAQLr5EPLlEwOkBsj6UskDyMsfE8wXy/8Wy//6VBLLPxP0ABLLH8tfyfgA7VQ=');

    static Errors = {
        'Errors.InvalidDeploymentId': 866,
        'Errors.InvalidSignature': 1299,
        'Errors.InvalidSeqno': 8190,
        'Errors.AlreadyInitialized': 16689,
        'Errors.InvalidParams': 17030,
        'Errors.NotInitialized': 26872,
        'Errors.InvalidWorkchain': 38296,
        'Errors.Expired': 39827,
        'Errors.WrongSender': 45881,
        'Errors.WrongTurn': 59897,
        'Errors.WrongOp': 65535,
    }

    readonly address: c.Address
    readonly init: { code: c.Cell, data: c.Cell } | undefined

    protected constructor(address: c.Address, init?: { code: c.Cell, data: c.Cell }) {
        this.address = address;
        this.init = init;
    }

    static fromAddress(address: c.Address) {
        return new Pothole(address);
    }

    static fromStorage(emptyStorage: {
        potholeId: uint32
        factory: CellRef<c.Address>
        ownerPublicKey?: uint256 /* = 0 */
        userPublicKey?: uint256 /* = 0 */
        user?: c.Address | null /* = null */
        seqno?: uint64 /* = 0 */
        lastMessage?: c.Cell | null /* = null */
        expiration?: uint32 /* = 0 */
        deploymentId?: uint96 /* = 0 */
    }, deployedOptions?: DeployedAddrOptions) {
        const initialState = {
            code: deployedOptions?.overrideContractCode ?? Pothole.CodeCell,
            data: PotholeStorage.toCell(PotholeStorage.create(emptyStorage)),
        };
        const address = calculateDeployedAddress(initialState.code, initialState.data, deployedOptions ?? {});
        return new Pothole(address, initialState);
    }

    static createCellOfInternalMintPothole(body: {
        queryId: uint64
        ownerPublicKey: uint256
        userPublicKey: uint256
        user: c.Address
        expiration: uint32
    }) {
        return InternalMintPothole.toCell(InternalMintPothole.create(body));
    }

    static createCellOfClosePothole(body: {
        queryId?: uint64 /* = 0 */
    }) {
        return ClosePothole.toCell(ClosePothole.create(body));
    }

    async sendDeploy(provider: ContractProvider, via: Sender, msgValue: coins, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: c.Cell.EMPTY,
            ...extraOptions
        });
    }

    async sendInternalMintPothole(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId: uint64
        ownerPublicKey: uint256
        userPublicKey: uint256
        user: c.Address
        expiration: uint32
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: InternalMintPothole.toCell(InternalMintPothole.create(body)),
            ...extraOptions
        });
    }

    async sendClosePothole(provider: ContractProvider, via: Sender, msgValue: coins, body: {
        queryId?: uint64 /* = 0 */
    }, extraOptions?: ExtraSendOptions) {
        return provider.internal(via, {
            value: msgValue,
            body: ClosePothole.toCell(ClosePothole.create(body)),
            ...extraOptions
        });
    }

    async getPotholeData(provider: ContractProvider): Promise<PotholeStorageRuntime> {
        const r = StackReader.fromGetMethod(9, await provider.get('getPotholeData', []));
        return ({
            $: 'PotholeStorageRuntime',
            potholeId: r.readBigInt(),
            factory: r.readSlice().loadAddress(),
            ownerPublicKey: r.readBigInt(),
            userPublicKey: r.readBigInt(),
            user: r.readNullable<c.Address>(
                (r) => r.readSlice().loadAddress()
            ),
            seqno: r.readBigInt(),
            lastMessage: r.readNullable<c.Cell>(
                (r) => r.readCell()
            ),
            expiration: r.readBigInt(),
            deploymentId: r.readBigInt(),
        });
    }
}
