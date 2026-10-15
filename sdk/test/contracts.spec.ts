import { Address, beginCell, Cell, contractAddress, external, toNano } from '@ton/core';
import { keyPairFromSeed } from '@ton/crypto';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';

import {
    JettonExcesses,
    MintMessage,
    Pothole,
    PotholeFactory,
    PotholeStorage,
    publicKeyToBigInt,
    signMessage,
} from '../src';

const NOW = 1_700_000_000;
const SDK_VERSION: string = require('../package.json').version;
const ownerSigning = keyPairFromSeed(Buffer.alloc(32, 1));
const userSigning = keyPairFromSeed(Buffer.alloc(32, 2));
const ownerPublicKey = publicKeyToBigInt(ownerSigning.publicKey);
const userPublicKey = publicKeyToBigInt(userSigning.publicKey);

type Trace = Awaited<ReturnType<Blockchain['sendMessage']>>;

function transactionAt(trace: Trace, address: Address) {
    const matches = trace.transactions.filter((transaction) => {
        const info = transaction.inMessage?.info;
        return info && info.type !== 'external-out' && info.dest.equals(address);
    });
    expect(matches).toHaveLength(1);
    return matches[0]!;
}

function expectSuccessfulTransaction(trace: Trace, address: Address, destroyed = false) {
    const transaction = transactionAt(trace, address);
    const description = transaction.description;
    if (description.type !== 'generic' || description.computePhase.type !== 'vm') {
        throw new Error('Expected an ordinary transaction executing contract code');
    }
    expect(description.aborted).toBe(false);
    expect(description.computePhase.success).toBe(true);
    expect(description.computePhase.exitCode).toBe(0);
    expect(description.actionPhase?.success).toBe(true);
    expect(description.destroyed).toBe(destroyed);
    expect(transaction.endStatus).toBe(destroyed ? 'non-existing' : 'active');
    return transaction;
}

function expectFailedTransaction(trace: Trace, address: Address, exitCode: number) {
    const description = transactionAt(trace, address).description;
    if (description.type !== 'generic' || description.computePhase.type !== 'vm') {
        throw new Error('Expected rejected contract execution');
    }
    expect(description.aborted).toBe(true);
    expect(description.computePhase.exitCode).toBe(exitCode);
}

async function signedRequest(
    mailbox: SandboxContract<Pothole>,
    seqno: bigint,
    ciphertext: Cell,
    secretKey: Buffer,
    validUntil = BigInt(NOW + 60),
    sender = Number(seqno & 1n) as 0 | 1,
    destination = mailbox.address,
) {
    const { deploymentId } = await mailbox.getPotholeData();
    return signMessage({ destination, deploymentId, seqno, sender, validUntil, ciphertext }, secretKey);
}

describe('compiled owner/user Pothole contracts in TON Sandbox', () => {
    let blockchain: Blockchain;
    let owner: SandboxContract<TreasuryContract>;
    let user: SandboxContract<TreasuryContract>;
    let stranger: SandboxContract<TreasuryContract>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        blockchain.now = NOW;
        owner = await blockchain.treasury('owner');
        user = await blockchain.treasury('user');
        stranger = await blockchain.treasury('stranger');
    });

    async function createFactory() {
        const factory = blockchain.openContract(PotholeFactory.create({
            factoryId: 7n,
            owner: owner.address,
            publicKey: ownerPublicKey,
        }));
        expectSuccessfulTransaction(await factory.sendDeploy(owner.getSender(), toNano('0.5')), factory.address);
        return factory;
    }

    async function mint(expiration = 0n) {
        const factory = await createFactory();
        const address = await factory.getPotholeAddress(0n);
        const trace = await factory.sendMintMessage(user.getSender(), toNano('0.2'), {
            queryId: 42n,
            publicKey: userPublicKey,
            expiration,
        }, { bounce: true });
        expectSuccessfulTransaction(trace, factory.address);
        expectSuccessfulTransaction(trace, address);
        // Opening an existing channel carries no StateInit, including when closing it.
        return { factory, mailbox: blockchain.openContract(Pothole.fromAddress(address)), trace };
    }

    async function expectStorageMatchesGetter(mailbox: SandboxContract<Pothole>) {
        const data = await mailbox.getPotholeData();
        const state = (await blockchain.getContract(mailbox.address)).accountState;
        if (state?.type !== 'active' || !state.state.data) throw new Error('Expected active mailbox storage');
        const encoded = PotholeStorage.toCell(PotholeStorage.create({
            potholeId: data.potholeId,
            factory: { ref: data.factory },
            ownerPublicKey: data.ownerPublicKey,
            userPublicKey: data.userPublicKey,
            user: data.user,
            seqno: data.seqno,
            lastMessage: data.lastMessage,
            expiration: data.expiration,
            deploymentId: data.deploymentId,
        }));
        expect(encoded.hash()).toEqual(state.state.data.hash());
        return data;
    }

    it('mints sequential IDs with factory owner key and the authenticated user address', async () => {
        const factory = await createFactory();
        const version: [bigint, bigint, string] = await factory.getVersion();
        expect(version).toEqual([0n, 1n, '.0']);
        expect(`${version[0]}.${version[1]}${version[2]}`).toBe(SDK_VERSION);
        const initialFactory = await factory.getFactoryData();
        expect(initialFactory.factoryId).toBe(7n);
        expect(initialFactory.lastPotholeId).toBe(0n);
        expect(initialFactory.owner.equals(owner.address)).toBe(true);
        expect(initialFactory.publicKey).toBe(ownerPublicKey);
        expect(initialFactory.potholeCode.hash()).toEqual(Pothole.CodeCell.hash());
        const firstAddress = await factory.getPotholeAddress(0n);
        const canonical = Pothole.create({ potholeId: 0n, factory: factory.address });
        expect(firstAddress.equals(canonical.address)).toBe(true);
        const stateInit = PotholeStorage.fromSlice(canonical.init!.data.beginParse());
        expect(stateInit.user).toBeNull();
        expect(stateInit.expiration).toBe(0n);
        expect(stateInit.deploymentId).toBe(0n);

        for (const id of [0n, 1n]) {
            const predicted = await factory.getPotholeAddress(id);
            // The query ID is correlation metadata, not a selected mailbox ID.
            const trace = await factory.sendMintMessage(user.getSender(), toNano('0.2'), {
                queryId: 42n,
                publicKey: userPublicKey,
                expiration: id === 0n ? 0n : BigInt(NOW + 90),
            });
            expectSuccessfulTransaction(trace, factory.address);
            const initialization = expectSuccessfulTransaction(trace, predicted);
            const data = await expectStorageMatchesGetter(blockchain.openContract(Pothole.fromAddress(predicted)));
            expect(data.potholeId).toBe(id);
            expect(data.factory.equals(factory.address)).toBe(true);
            expect(data.ownerPublicKey).toBe(ownerPublicKey);
            expect(data.userPublicKey).toBe(userPublicKey);
            expect(data.user?.equals(user.address)).toBe(true);
            expect(data.seqno).toBe(0n);
            expect(data.lastMessage).toBeNull();
            expect(data.expiration).toBe(id === 0n ? 0n : BigInt(NOW + 90));
            expect(data.deploymentId >> 64n).toBe(BigInt(NOW));
            expect(data.deploymentId & ((1n << 64n) - 1n)).toBe(initialization.lt);
        }
        expect((await factory.getFactoryData()).lastPotholeId).toBe(2n);
        expect((await factory.getPotholeAddress(1n)).equals(firstAddress)).toBe(false);
    });

    it('derives and deploys children using the factory configured code, including through its union sender', async () => {
        // A leading TVM NOP preserves behavior while giving the child code a distinct hash.
        const customCode = beginCell().storeUint(0, 8).storeSlice(Pothole.CodeCell.beginParse()).endCell();
        expect(customCode.hash()).not.toEqual(Pothole.CodeCell.hash());
        const factory = blockchain.openContract(PotholeFactory.create({
            factoryId: 8n,
            owner: owner.address,
            publicKey: ownerPublicKey,
            potholeCode: customCode,
        }));
        expectSuccessfulTransaction(await factory.sendDeploy(owner.getSender(), toNano('0.5')), factory.address);
        expect((await factory.getFactoryData()).potholeCode.hash()).toEqual(customCode.hash());

        for (const id of [0n, (1n << 32n) - 1n]) {
            const canonical = Pothole.create({ potholeId: id, factory: factory.address });
            const custom = Pothole.fromStorage({ potholeId: id, factory: { ref: factory.address } }, {
                overrideContractCode: customCode,
            });
            const predicted = await factory.getPotholeAddress(id);
            expect(predicted.equals(contractAddress(0, { code: customCode, data: canonical.init!.data }))).toBe(true);
            expect(predicted.equals(custom.address)).toBe(true);
            expect(predicted.equals(canonical.address)).toBe(false);
        }

        const mailbox = blockchain.openContract(Pothole.fromAddress(await factory.getPotholeAddress(0n)));
        const trace = await factory.sendFactoryIncomingMessage(user.getSender(), toNano('0.2'), MintMessage.create({
            queryId: (1n << 64n) - 1n,
            publicKey: userPublicKey,
            expiration: BigInt(NOW + 90),
        }));
        expectSuccessfulTransaction(trace, factory.address);
        const deployment = expectSuccessfulTransaction(trace, mailbox.address);
        expect(deployment.inMessage?.init?.code?.hash()).toEqual(customCode.hash());
        const initialized = await expectStorageMatchesGetter(mailbox);
        expect(initialized.user?.equals(user.address)).toBe(true);
        expect(initialized.expiration).toBe(BigInt(NOW + 90));
        expect(initialized.ownerPublicKey).toBe(ownerPublicKey);
        const refund = deployment.outMessages.values()[0];
        expect(JettonExcesses.fromSlice(refund.body.beginParse()).queryId).toBe((1n << 64n) - 1n);
        expectSuccessfulTransaction(await mailbox.sendMessage({
            deploymentId: initialized.deploymentId, seqno: 0n, sender: 0, validUntil: BigInt(NOW + 60), ciphertext: Cell.EMPTY,
        }, ownerSigning.secretKey), mailbox.address);
        expect((await expectStorageMatchesGetter(mailbox)).seqno).toBe(1n);
    });

    it('requires factory initialization before messaging or closing and prevents reinitialization', async () => {
        // A treasury represents the authenticated factory address in this isolated test.
        const mailbox = blockchain.openContract(Pothole.create({ potholeId: 4n, factory: owner.address }));
        expectSuccessfulTransaction(await mailbox.sendDeploy(user.getSender(), toNano('0.2')), mailbox.address);
        const uninitialized = await expectStorageMatchesGetter(mailbox);
        expect(uninitialized.user).toBeNull();
        expect(uninitialized.deploymentId).toBe(0n);
        const body = await signedRequest(mailbox, 0n, Cell.EMPTY, ownerSigning.secretKey);
        await expect(blockchain.sendMessage(external({ to: mailbox.address, body }))).rejects.toMatchObject({
            exitCode: Pothole.Errors['Errors.NotInitialized'],
        });
        expectFailedTransaction(
            await mailbox.sendClosePothole(user.getSender(), toNano('0.02')),
            mailbox.address,
            Pothole.Errors['Errors.NotInitialized'],
        );
        const init = { queryId: 1n, ownerPublicKey, userPublicKey, user: user.address, expiration: 0n };
        expectFailedTransaction(
            await mailbox.sendInternalMintPothole(stranger.getSender(), toNano('0.05'), init, { bounce: true }),
            mailbox.address,
            Pothole.Errors['Errors.WrongSender'],
        );
        expect((await mailbox.getPotholeData()).user).toBeNull();
        expect((await mailbox.getPotholeData()).deploymentId).toBe(0n);
        blockchain.now = NOW + 5;
        expectSuccessfulTransaction(
            await mailbox.sendInternalMintPothole(owner.getSender(), toNano('0.05'), init), mailbox.address,
        );
        const initialized = await mailbox.getPotholeData();
        expect(initialized.deploymentId >> 64n).toBe(BigInt(NOW + 5));
        expectFailedTransaction(
            await mailbox.sendInternalMintPothole(owner.getSender(), toNano('0.05'), { ...init, user: stranger.address }),
            mailbox.address,
            Pothole.Errors['Errors.AlreadyInitialized'],
        );
        expect((await mailbox.getPotholeData()).user?.equals(user.address)).toBe(true);
        expect((await mailbox.getPotholeData()).deploymentId).toBe(initialized.deploymentId);
    });

    it('requires owner confirmation at seqno zero, then alternates owner/user without outgoing actions', async () => {
        const { mailbox } = await mint();
        for (const [body, exitCode] of [
            [await signedRequest(mailbox, 0n, Cell.EMPTY, userSigning.secretKey), Pothole.Errors['Errors.InvalidSignature']],
            [await signedRequest(mailbox, 0n, Cell.EMPTY, userSigning.secretKey, BigInt(NOW + 60), 1), Pothole.Errors['Errors.WrongTurn']],
        ] as const) {
            await expect(blockchain.sendMessage(external({ to: mailbox.address, body }))).rejects.toMatchObject({ exitCode });
            expect((await mailbox.getPotholeData()).seqno).toBe(0n);
        }
        const leaf = beginCell().storeBuffer(Buffer.from('opaque payload')).endCell();
        const payloads = [beginCell().storeUint(5, 3).storeRef(leaf).storeRef(leaf).endCell(), Cell.EMPTY, leaf];
        for (const [index, ciphertext] of payloads.entries()) {
            const sender = (index & 1) as 0 | 1;
            const { deploymentId } = await mailbox.getPotholeData();
            const trace = await mailbox.sendMessage({
                deploymentId, seqno: BigInt(index), sender, validUntil: BigInt(NOW + 60), ciphertext,
            }, sender === 0 ? ownerSigning.secretKey : userSigning.secretKey);
            expect(trace.transactions).toHaveLength(1);
            const transaction = expectSuccessfulTransaction(trace, mailbox.address);
            expect(transaction.outMessages.size).toBe(0);
            if (transaction.description.type === 'generic') {
                expect(transaction.description.actionPhase?.totalActions).toBe(0);
            }
            const data = await expectStorageMatchesGetter(mailbox);
            expect(data.seqno).toBe(BigInt(index + 1));
            expect(data.lastMessage!.hash()).toEqual(ciphertext.hash());
            expect(data.expiration).toBe(0n);
            expect(data.deploymentId).toBe(deploymentId);
        }
    });

    it('binds signatures to destination and sequence and rejects replay', async () => {
        const { mailbox } = await mint();
        const accepted = await signedRequest(mailbox, 0n, Cell.EMPTY, ownerSigning.secretKey);
        expectSuccessfulTransaction(await mailbox.sendExternal(accepted), mailbox.address);
        for (const [body, exitCode] of [
            [accepted, Pothole.Errors['Errors.InvalidSeqno']],
            [await signedRequest(mailbox, 2n, Cell.EMPTY, ownerSigning.secretKey), Pothole.Errors['Errors.InvalidSeqno']],
            [await signedRequest(mailbox, 1n, Cell.EMPTY, userSigning.secretKey, BigInt(NOW + 60), 1, stranger.address), Pothole.Errors['Errors.WrongSender']],
        ] as const) {
            await expect(blockchain.sendMessage(external({ to: mailbox.address, body }))).rejects.toMatchObject({ exitCode });
            expect((await mailbox.getPotholeData()).seqno).toBe(1n);
        }
    });

    it('rejects an old confirmation after redeployment at the same address within the same second', async () => {
        const mailbox = blockchain.openContract(Pothole.create({ potholeId: 4n, factory: owner.address }));
        const init = { ownerPublicKey, userPublicKey, user: user.address };
        expectSuccessfulTransaction(
            await mailbox.sendInternalMintPothole(owner.getSender(), toNano('0.2'), init), mailbox.address,
        );
        const first = await expectStorageMatchesGetter(mailbox);
        const oldConfirmation = await signedRequest(mailbox, 0n, Cell.EMPTY, ownerSigning.secretKey);
        expectSuccessfulTransaction(await mailbox.sendExternal(oldConfirmation), mailbox.address);
        expectSuccessfulTransaction(await mailbox.sendClosePothole(user.getSender(), toNano('0.05')), mailbox.address, true);

        const newUserSigning = keyPairFromSeed(Buffer.alloc(32, 3));
        expectSuccessfulTransaction(await mailbox.sendInternalMintPothole(owner.getSender(), toNano('0.2'), {
            ...init, user: stranger.address, userPublicKey: publicKeyToBigInt(newUserSigning.publicKey),
        }), mailbox.address);
        const second = await expectStorageMatchesGetter(mailbox);
        expect(blockchain.now).toBe(NOW);
        expect(first.deploymentId >> 64n).toBe(BigInt(NOW));
        expect(second.deploymentId >> 64n).toBe(BigInt(NOW));
        expect(second.deploymentId).not.toBe(first.deploymentId);
        expect(second.seqno).toBe(0n);
        expect(second.lastMessage).toBeNull();

        const balanceBefore = (await blockchain.getContract(mailbox.address)).balance;
        await expect(mailbox.sendExternal(oldConfirmation)).rejects.toMatchObject({
            exitCode: Pothole.Errors['Errors.InvalidDeploymentId'],
        });
        expect((await blockchain.getContract(mailbox.address)).balance).toBe(balanceBefore);
        expect((await mailbox.getPotholeData()).seqno).toBe(0n);
        expect((await mailbox.getPotholeData()).lastMessage).toBeNull();

        expectSuccessfulTransaction(await mailbox.sendMessage({
            deploymentId: second.deploymentId,
            seqno: 0n, sender: 0, validUntil: BigInt(NOW + 60), ciphertext: Cell.EMPTY,
        }, ownerSigning.secretKey), mailbox.address);
        const confirmed = await expectStorageMatchesGetter(mailbox);
        expect(confirmed.seqno).toBe(1n);
        expect(confirmed.deploymentId).toBe(second.deploymentId);
        expect(confirmed.user?.equals(stranger.address)).toBe(true);
    });

    it('rejects expired mint requests and participant reuse without advancing the factory counter', async () => {
        const factory = await createFactory();
        for (const [body, exitCode] of [
            [{ publicKey: userPublicKey, expiration: BigInt(NOW) }, PotholeFactory.Errors['Errors.Expired']],
            [{ publicKey: ownerPublicKey, expiration: 0n }, PotholeFactory.Errors['Errors.InvalidParams']],
        ] as const) {
            const trace = await factory.sendMintMessage(user.getSender(), toNano('0.2'), body, { bounce: true });
            expectFailedTransaction(trace, factory.address, exitCode);
            expect((await factory.getFactoryData()).lastPotholeId).toBe(0n);
        }
    });

    it('allows only the stored user to close and pays that user before deleting the account', async () => {
        const { factory, mailbox } = await mint();
        await mailbox.sendMessage({
            deploymentId: (await mailbox.getPotholeData()).deploymentId,
            seqno: 0n, sender: 0, validUntil: BigInt(NOW + 60), ciphertext: Cell.EMPTY,
        }, ownerSigning.secretKey);
        await mailbox.sendDeploy(user.getSender(), toNano('0.2'));
        const snapshot = (data: Awaited<ReturnType<typeof mailbox.getPotholeData>>) => ({
            ...data,
            factory: data.factory.toRawString(),
            user: data.user?.toRawString(),
            lastMessage: data.lastMessage?.hash().toString('hex'),
        });
        const dataBefore = snapshot(await mailbox.getPotholeData());
        for (const other of [owner, stranger]) {
            expectFailedTransaction(
                await mailbox.sendClosePothole(other.getSender(), toNano('0.05'), { queryId: 77n }),
                mailbox.address,
                Pothole.Errors['Errors.WrongSender'],
            );
            expect(snapshot(await mailbox.getPotholeData())).toEqual(dataBefore);
        }
        const balanceBefore = (await blockchain.getContract(mailbox.address)).balance;
        const userBalanceBefore = (await blockchain.getContract(user.address)).balance;
        const close = await mailbox.sendClosePothole(user.getSender(), toNano('0.05'), { queryId: 77n });
        const transaction = expectSuccessfulTransaction(close, mailbox.address, true);
        expect(transaction.outMessages.size).toBe(1);
        const payout = transaction.outMessages.values()[0];
        if (payout.info.type !== 'internal') throw new Error('Expected an internal payout');
        expect(payout.info.dest.equals(user.address)).toBe(true);
        expect(payout.info.bounce).toBe(false);
        expect(payout.info.value.coins).toBeGreaterThan(balanceBefore);
        expect(payout.info.value.coins).toBeLessThan(balanceBefore + toNano('0.05'));
        expect(JettonExcesses.fromSlice(payout.body.beginParse()).queryId).toBe(77n);
        expect((await blockchain.getContract(user.address)).balance).toBeGreaterThan(userBalanceBefore + balanceBefore - toNano('0.01'));
        const closed = await blockchain.getContract(mailbox.address);
        expect(closed.balance).toBe(0n);
        expect(closed.accountState?.type).not.toBe('active');
        expect((await factory.getFactoryData()).lastPotholeId).toBe(1n);

        // fromAddress carries no StateInit; default bounce prevents reviving a closed account.
        await mailbox.sendClosePothole(user.getSender(), toNano('0.05'), {}, { bounce: undefined });
        expect((await blockchain.getContract(mailbox.address)).balance).toBe(0n);
        expect((await blockchain.getContract(mailbox.address)).accountState?.type).not.toBe('active');
    });

    it('lets the stored user close before the owner has confirmed', async () => {
        const { mailbox } = await mint();
        expect((await mailbox.getPotholeData()).seqno).toBe(0n);
        expectSuccessfulTransaction(await mailbox.sendClosePothole(user.getSender(), toNano('0.05')), mailbox.address, true);
    });

    it('enforces request and channel expiration while allowing the user to close after expiry', async () => {
        const { mailbox } = await mint(BigInt(NOW + 5));
        await expect(mailbox.sendExternal(await signedRequest(mailbox, 0n, Cell.EMPTY, ownerSigning.secretKey, BigInt(NOW))))
            .rejects.toMatchObject({ exitCode: Pothole.Errors['Errors.Expired'] });
        blockchain.now = NOW + 4;
        expectSuccessfulTransaction(await mailbox.sendExternal(await signedRequest(mailbox, 0n, Cell.EMPTY, ownerSigning.secretKey)), mailbox.address);
        blockchain.now = NOW + 5;
        await expect(mailbox.sendExternal(await signedRequest(mailbox, 1n, Cell.EMPTY, userSigning.secretKey)))
            .rejects.toMatchObject({ exitCode: Pothole.Errors['Errors.Expired'] });
        const data = await mailbox.getPotholeData();
        expect(data.seqno).toBe(1n);
        expect(data.expiration).toBe(BigInt(NOW + 5));
        expectSuccessfulTransaction(await mailbox.sendClosePothole(user.getSender(), toNano('0.05')), mailbox.address, true);
    });
});
