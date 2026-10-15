import "@acton/build"
import "@acton/crypto"
import "@acton/emulation/network"
import "@acton/emulation/testing"
import "@acton/testing/expect"
import "@acton/types/big_array"
import "@acton/types/message"
import "@acton/types/transaction"
import "@common/errors"
import "@common/params"
import "@factory/interfaces"
import "@pothole/interfaces"
import "@tests/helpers/contracts"
import "@tolkbox/interfaces/Jetton"

struct FactoryFixture {
    address: address
    owner: Treasury
    user: Treasury
    ownerKey: KeyPair
    userKey: KeyPair
}

get fun `test factory mint deploys predicted identity reserves funds and refunds user`() {
    val f = setupFactory();
    val initial = factoryData(f);
    val child = childFixture(f, 0);
    expect(net.runGetMethod<address>(f.address, "getPotholeAddress", [0])).toEqual(child.address);
    expect(testing.isDeployed(child.address)).toEqual(false);
    val reserve = testing.getAccountBalance(f.address);
    val minted = mint(f, 77, TEST_NOW + 300);
    expect(minted).toHaveSuccessfulTx<MintMessage>({ from: f.user.address, to: f.address });
    expect(minted).toHaveSuccessfulDeploy({ from: f.address, to: child.address });
    expect(minted).toHaveSuccessfulTx<JettonExcesses>({ from: child.address, to: f.user.address });
    val refund = minted.findTransaction<JettonExcesses>({ from: child.address, to: f
            .user
            .address })!;
    expect(refund.loadBody<JettonExcesses>().queryId).toEqual(77);
    val info = refund.loadInMsg<JettonExcesses>().info;
    assert (info is TlbInternalMessage) throw 700;
    expect(info.value.grams).toBeGreater(grams("0.4"));
    expect(testing.getAccountBalance(f.address)).toEqual(reserve);
    expect(testing.getAccountBalance(child.address)).toEqual(POTHOLE_STORAGE_FEE);
    val deployment = minted.findTransaction<InternalMintPothole>({ to: child.address })!;
    expect(mailboxData(child.address)).toEqual(PotholeStorageRuntime {
        potholeId: 0,
        factory: f.address,
        ownerPublicKey: f.ownerKey.publicKey,
        userPublicKey: f.userKey.publicKey,
        user: f.user.address,
        seqno: 0,
        lastMessage: null,
        expiration: TEST_NOW + 300,
        deploymentId: (deployment.now << 64) | deployment.lt,
    });
    var expected = initial;
    expected.lastPotholeId = 1;
    expect(factoryData(f)).toEqual(expected);
}

get fun `test integration factory mint owner confirmation user reply and user close`() {
    val f = setupFactory();
    mint(f);
    val child = childFixture(f, 0);
    expectExternalRejected(
        child,
        signedBody(request(child), child.userKey),
        Errors.InvalidSignature,
    );
    val confirmation = beginCell().storeUint(1, 1).endCell();
    val reply = nestedPayload(0x44);
    expectExternalAccepted(
        child,
        signedBody(request(child, 0, 0, confirmation), child.ownerKey),
        1,
        confirmation,
    );
    expectExternalAccepted(child, signedBody(request(child, 1, 1, reply), child.userKey), 2, reply);
    val closed = sendMailbox(child, child.user.address, ClosePothole { queryId: 91 }.toCell());
    expect(closed).toHaveSuccessfulTx<ClosePothole>({ to: child.address });
    expect(closed).toHaveSuccessfulTx<JettonExcesses>({ from: child.address, to: child
            .user
            .address });
    expect(
        closed
            .findTransaction<JettonExcesses>({ from: child.address, to: child.user.address })!
            .loadBody<JettonExcesses>()
            .queryId,
    ).toEqual(91);
    expect(closed.findTransaction<ClosePothole>({ to: child.address })!.endStatus).toEqual(
        TlbAccountStatus.NonExisting,
    );
    expect(testing.getAccountBalance(child.address)).toEqual(0);
    expect(testing.isDeployed(child.address)).toEqual(false);
    expect(factoryData(f).lastPotholeId).toEqual(1);
    expect(testing.isDeployed(f.address)).toEqual(true);
}

get fun `test each mint allocates a new counter ID even with the same query ID`() {
    val f = setupFactory();
    mint(f, 7);
    val first = childFixture(f, 0);
    val payload = payloadFixture();
    expectExternalAccepted(
        first,
        signedBody(request(first, 0, 0, payload), first.ownerKey),
        1,
        payload,
    );
    mint(f, 7, TEST_NOW + 500);
    val second = childFixture(f, 1);
    expect(second.address).toNotEqual(first.address);
    expect(mailboxData(first.address).seqno).toEqual(1);
    expect(mailboxData(first.address).lastMessage).toEqual(payload);
    expect(mailboxData(second.address).seqno).toEqual(0);
    expect(mailboxData(second.address).deploymentId).toNotEqual(
        mailboxData(first.address).deploymentId,
    );
    expect(mailboxData(second.address).expiration).toEqual(TEST_NOW + 500);
    expect(factoryData(f).lastPotholeId).toEqual(2);
    expect(net.runGetMethod<address>(f.address, "getPotholeAddress", [1])).toEqual(second.address);
}

get fun `test factory identity namespaces otherwise equal child IDs`() {
    val first = setupFactory(1);
    val second = setupFactory(2);
    expect(childFixture(first, 0).address).toNotEqual(childFixture(second, 0).address);
    mint(first);
    mint(second);
    expect(mailboxData(childFixture(first, 0).address).factory).toEqual(first.address);
    expect(mailboxData(childFixture(second, 0).address).factory).toEqual(second.address);
    val firstChild = childFixture(first, 0);
    val secondChild = childFixture(second, 0);
    expectExternalRejected(
        secondChild,
        signedBody(request(firstChild), first.ownerKey),
        Errors.WrongSender,
    );
}

get fun `test invalid keys expiry and insufficient payment do not allocate an ID`() {
    val f = setupFactory();
    expectRejectedMint(
        f,
        MintMessage {
            queryId: 1,
            publicKey: 0,
            expiration: 0,
        },
        Errors.InvalidParams,
    );
    expectRejectedMint(
        f,
        MintMessage {
            queryId: 1,
            publicKey: f.ownerKey.publicKey,
            expiration: 0,
        },
        Errors.InvalidParams,
    );
    expectRejectedMint(
        f,
        MintMessage {
            queryId: 1,
            publicKey: f.userKey.publicKey,
            expiration: TEST_NOW,
        },
        Errors.Expired,
    );
    expectRejectedMint(
        f,
        MintMessage {
            queryId: 1,
            publicKey: f.userKey.publicKey,
            expiration: 0,
        },
        Errors.NotEnoughGas,
        grams("0.001"),
    );
    expect(testing.isDeployed(childFixture(f, 0).address)).toEqual(false);
}

get fun `test malformed mint requests reject trailing data and preserve factory state`() {
    val f = setupFactory();
    val initial = factoryData(f);
    val body = MintMessage {
        queryId: 2,
        publicKey: f.userKey.publicKey,
        expiration: 0,
    }.toCell();
    val malformed: array<cell> = [
        beginCell().storeUint(0x78beff58, 32).endCell(),
        beginCell().storeSlice(body.beginParse()).storeUint(1, 1).endCell(),
        beginCell().storeSlice(body.beginParse()).storeRef(createEmptyCell()).endCell(),
    ];
    var i = 0;
    repeat (malformed.size()) {
        expect(
            net.send(
                f.user.address,
                createMessage({ dest: f.address, value: grams("0.5"), bounce: false, body: malformed.get(
                        i,
                    ) }),
            ),
        ).toHaveFailedTx({ to: f.address, exitCode: 9 });
        expect(factoryData(f)).toEqual(initial);
        i += 1;
    }
}

get fun `test predeploying a child cannot steal the factory initialization authority`() {
    val f = setupFactory();
    val child = childFixture(f, 0);
    val destination = childDeployment(f, 0);
    expect(
        net.send(
            f.user.address,
            createMessage({ dest: destination, value: grams("0.2"), bounce: false }),
        ),
    ).toHaveSuccessfulDeploy({ to: child.address });
    expect(
        sendMailbox(child, f.user.address, initializeBody(child)),
    ).toHaveFailedTx({ to: child.address, exitCode: Errors.WrongSender });
    expect(mailboxData(child.address).user).toBeNull();
    expect(
        mint(f),
    ).toHaveSuccessfulTx<InternalMintPothole>({ from: f.address, to: child.address, deploy: false });
    expect(mailboxData(child.address).user).toEqual(f.user.address);
    expect(mailboxData(child.address).ownerPublicKey).toEqual(f.ownerKey.publicKey);
}

get fun `test failed child initialization bounces funds without retrying or rolling back the factory ID`() {
    val f = setupFactory();
    val child = childFixture(f, 0);
    // Inject an authorized initialization in the emulator, leaving the factory's
    // allocation counter at zero so its next mint encounters an initialized child.
    val initialized = net.send(
        f.address,
        createMessage({
            dest: childDeployment(f, 0),
            value: grams("0.3"),
            bounce: false,
            body: initializeBody(child),
        }),
    );
    expect(initialized).toHaveSuccessfulDeploy({ to: child.address });
    val childState = mailboxData(child.address);
    expect(factoryData(f).lastPotholeId).toEqual(0);
    val factoryBalance = testing.getAccountBalance(f.address);

    val result = mint(f, 404);
    expect(result).toHaveSuccessfulTx<MintMessage>({ to: f.address });
    expect(result).toHaveFailedTx<InternalMintPothole>({
        from: f.address,
        to: child.address,
        exitCode: Errors.AlreadyInitialized,
    });
    expect(result).toHaveSuccessfulTx({ from: child.address, to: f.address, bounced: true });
    expect(result.size()).toEqual(3);
    val bounce = result.findTransaction({ to: f.address, bounced: true })!;
    expect(bounce.outmsgCnt).toEqual(0);
    expect(testing.getAccountBalance(f.address)).toBeGreater(factoryBalance);
    expect(factoryData(f).lastPotholeId).toEqual(1);
    expect(mailboxData(child.address)).toEqual(childState);
    expect(testing.isDeployed(childFixture(f, 1).address)).toEqual(false);
}

get fun `test factory allows empty topups but rejects external unknown and nonbasechain requests`() {
    val f = setupFactory();
    expect(
        net.send(
            f.user.address,
            createMessage({ dest: f.address, value: grams("0.1"), bounce: false }),
        ),
    ).toHaveSuccessfulTx({ to: f.address });
    expect(
        net.send(
            f.user.address,
            createMessage({ dest: f.address, value: grams("0.1"), bounce: false, body: beginCell()
                    .storeUint(0xdeadbeef, 32)
                    .endCell() }),
        ),
    ).toHaveFailedTx({ to: f.address, exitCode: Errors.WrongOp });
    val balance = testing.getAccountBalance(f.address);
    val external = net.sendExternal(net.createExternalMessage(f.address, createEmptyCell()));
    expect(external).toBeNotAccepted();
    expect(external).toHaveExternalVmExitCode(Errors.WrongOp);
    expect(testing.getAccountBalance(f.address)).toEqual(balance);
    val masterchainUser = testing.treasury("masterchain-user", MASTERCHAIN);
    expect(
        net.send(
            masterchainUser.address,
            createMessage({ dest: f.address, value: grams("0.5"), bounce: false, body: MintMessage {
                    queryId: 1,
                    publicKey: f.userKey.publicKey,
                    expiration: 0,
                } }),
        ),
    ).toHaveFailedTx({ to: f.address, exitCode: Errors.InvalidWorkchain });
    expect(factoryData(f).lastPotholeId).toEqual(0);
}

get fun `test exhausted factory counter cannot wrap to an existing child ID`() {
    val f = setupFactory(0, 0xffffffff);
    expectRejectedMint(
        f,
        MintMessage {
            queryId: 1,
            publicKey: f.userKey.publicKey,
            expiration: 0,
        },
        Errors.InvalidOperation,
    );
    expect(factoryData(f).lastPotholeId).toEqual(0xffffffff);
}

fun setupFactory(factoryId: uint64 = 0, lastPotholeId: uint32 = 0): FactoryFixture {
    testing.setNow(TEST_NOW);
    testing.setChecksigIgnore(false);
    val owner = testing.treasury("factory-owner");
    val user = testing.treasury("factory-user");
    val ownerKey = crypto.seedToKeyPair(111);
    val userKey = crypto.seedToKeyPair(222);
    val storage = FactoryStorage {
        factoryId,
        lastPotholeId,
        owner: owner.address,
        publicKey: ownerKey.publicKey,
        potholeCode: build("Pothole"),
    };
    val destination = AutoDeployAddress {
        stateInit: { code: build("PotholeFactory"), data: storage.toCell() },
    };
    val address = destination.calculateAddress();
    expect(
        net.send(
            owner.address,
            createMessage({ dest: destination, value: grams("0.3"), bounce: false }),
        ),
    ).toHaveSuccessfulDeploy({ to: address });
    expect(net.runGetMethod<FactoryStorage>(address, "getFactoryData")).toEqual(storage);
    return {
        address,
        owner,
        user,
        ownerKey,
        userKey,
    };
}

fun factoryData(f: FactoryFixture): FactoryStorage {
    return net.runGetMethod(f.address, "getFactoryData");
}

fun childDeployment(f: FactoryFixture, potholeId: uint32): AutoDeployAddress {
    return {
        stateInit: {
            code: build("Pothole"),
            data: PotholeStorage.initData(potholeId, f.address).toCell(),
        },
    };
}

fun childFixture(f: FactoryFixture, potholeId: uint32): MailboxFixture {
    return {
        address: childDeployment(f, potholeId).calculateAddress(),
        factory: Treasury { address: f.address },
        owner: f.owner,
        user: f.user,
        ownerKey: f.ownerKey,
        userKey: f.userKey,
    };
}

fun mint(f: FactoryFixture, queryId: uint64 = 0, expiration: uint32 = 0): SendResultList {
    return net.send(
        f.user.address,
        createMessage({ dest: f.address, value: grams("0.5"), bounce: false, body: MintMessage {
                queryId,
                publicKey: f.userKey.publicKey,
                expiration,
            } }),
    );
}

fun expectRejectedMint(
    f: FactoryFixture,
    body: MintMessage,
    exitCode: int,
    value: coins = grams("0.5"),
): void {
    val state = factoryData(f);
    expect(
        net.send(f.user.address, createMessage({ dest: f.address, value, bounce: false, body })),
    ).toHaveFailedTx({ to: f.address, exitCode });
    expect(factoryData(f)).toEqual(state);
}
