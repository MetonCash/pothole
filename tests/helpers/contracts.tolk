import "@acton/build"
import "@acton/crypto"
import "@acton/emulation/network"
import "@acton/emulation/testing"
import "@acton/testing/expect"
import "@acton/tlb/maybe"
import "@acton/types/big_array"
import "@acton/types/transaction"
import "@pothole/interfaces"

const TEST_NOW = 1700000000
const MAX_SEQNO = 18446744073709551615

struct MailboxFixture {
    address: address
    factory: Treasury
    owner: Treasury
    user: Treasury
    ownerKey: KeyPair
    userKey: KeyPair
}

fun setupMailbox(
    expiration: uint32 = 0,
    initialize: bool = true,
    initialSeqno: uint64 = 0,
): MailboxFixture {
    testing.setNow(TEST_NOW);
    testing.setChecksigIgnore(false);
    val factory = testing.treasury("mailbox-factory");
    val owner = testing.treasury("mailbox-owner");
    val user = testing.treasury("mailbox-user");
    var storage = PotholeStorage.initData(42, factory.address);
    storage.seqno = initialSeqno;
    val destination = AutoDeployAddress {
        stateInit: { code: build("Pothole"), data: storage.toCell() },
    };
    val address = destination.calculateAddress();
    expect(
        net.send(
            factory.address,
            createMessage({
                dest: destination,
                value: grams("0.3"),
                bounce: false,
            }),
        ),
    ).toHaveSuccessfulDeploy({ to: address });
    val f = MailboxFixture {
        address,
        factory,
        owner,
        user,
        ownerKey: crypto.seedToKeyPair(111),
        userKey: crypto.seedToKeyPair(222),
    };
    if (initialize) {
        expect(
            sendMailbox(f, factory.address, initializeBody(f, expiration), grams("0.3")),
        ).toHaveSuccessfulTx<InternalMintPothole>({ to: address });
    }
    return f;
}

fun mailboxData(address: address): PotholeStorageRuntime {
    return net.runGetMethod(address, "getPotholeData");
}

fun initializeBody(f: MailboxFixture, expiration: uint32 = 0): cell {
    return InternalMintPothole {
        queryId: 123,
        ownerPublicKey: f.ownerKey.publicKey,
        userPublicKey: f.userKey.publicKey,
        user: f.user.address,
        expiration,
    }.toCell();
}

fun sendMailbox(
    f: MailboxFixture,
    from: address,
    body: cell,
    value: coins = grams("0.05"),
): SendResultList {
    return net.send(from, createMessage({ dest: f.address, value, bounce: false, body }));
}

fun payloadFixture(bytes: int = 28, value: uint8 = 0x42): cell {
    var builder = beginCell();
    repeat (bytes) {
        builder.storeUint(value, 8);
    }
    return builder.endCell();
}

fun nestedPayload(value: uint8): cell {
    val leaf = beginCell().storeUint(value, 8).endCell();
    var tree = leaf;
    repeat (32) {
        tree = beginCell().storeUint(5, 3).storeRef(tree).storeRef(leaf).endCell();
    }
    return tree;
}

fun request(
    f: MailboxFixture,
    seqno: uint64 = 0,
    sender: uint1 = 0,
    ciphertext: cell? = null,
    validUntil: uint32 = TEST_NOW + 600,
    destination: address? = null,
    deploymentId: uint96? = null,
): Cell<ExternalMessageData> {
    return ExternalMessageData {
        destination: destination ?? f.address,
        deploymentId: deploymentId ?? mailboxData(f.address).deploymentId,
        seqno,
        validUntil,
        sender,
        ciphertext: ciphertext ?? payloadFixture(),
    }.toCell();
}

fun signedBody(message: cell, key: KeyPair): cell {
    return beginCell()
        .storeSlice(crypto.rawSign(key.privateKey, message.hash()))
        .storeRef(message)
        .endCell();
}

fun expectExternalAccepted(
    f: MailboxFixture,
    body: cell,
    nextSeqno: uint64,
    payload: cell,
): SendResult {
    var expected = mailboxData(f.address);
    expected.seqno = nextSeqno;
    expected.lastMessage = payload;
    val result = net.sendExternal(net.createExternalMessage(f.address, body));
    expect(result).toBeAccepted();
    val trace = result.unwrap();
    expect(trace.size()).toEqual(1);
    val execution = trace.at(0);
    val transaction = execution.tx.load();
    expect(transaction.getAccountAddress()).toEqual(f.address);
    val description = transaction.description.load();
    assert (description is TlbTransOrd) throw 700;
    expect(description.aborted).toEqual(false);
    val compute = description.computePh;
    assert (compute is TlbTrComputeVm) throw 701;
    expect(compute.success).toEqual(true);
    expect(compute.data.load().exitCode).toEqual(0);
    expect(description.action.unwrap().load().success).toEqual(true);
    expect(execution.outMessages.size()).toEqual(0);
    expect(execution.externals.size()).toEqual(0);
    expect(execution.allOutActions().size()).toEqual(0);
    expect(mailboxData(f.address)).toEqual(expected);
    return execution;
}

fun expectExternalRejected(f: MailboxFixture, body: cell, exitCode: int): void {
    val state = mailboxData(f.address);
    val balance = testing.getAccountBalance(f.address);
    val result = net.sendExternal(net.createExternalMessage(f.address, body));
    expect(result).toBeNotAccepted();
    expect(result).toHaveExternalVmExitCode(exitCode);
    expect(mailboxData(f.address)).toEqual(state);
    expect(testing.getAccountBalance(f.address)).toEqual(balance);
}
