import "@acton/build"
import "@acton/crypto"
import "@acton/emulation/network"
import "@acton/emulation/testing"
import "@acton/testing/expect"
import "@acton/types/big_array"
import "@acton/types/message"
import "@acton/types/out_actions"
import "@acton/types/transaction"
import "@common/errors"
import "@pothole/interfaces"
import "@tests/helpers/contracts"
import "@tolkbox/interfaces/Jetton"

get fun `test initialization records identity refunds excess and leaves the owner confirmation pending`() {
    val f = setupMailbox(0, false);
    val initial = PotholeStorage.initData(42, f.factory.address);
    val predicted = AutoDeployAddress {
        stateInit: { code: build("Pothole"), data: initial.toCell() },
    };
    expect(f.address).toEqual(predicted.calculateAddress());
    val reserve = testing.getAccountBalance(f.address);
    val initialized = sendMailbox(
        f,
        f.factory.address,
        initializeBody(f, TEST_NOW + 300),
        grams("0.3"),
    );
    expect(initialized).toHaveSuccessfulTx<InternalMintPothole>({
        from: f.factory.address,
        to: f.address,
    });
    expect(initialized).toHaveSuccessfulTx<JettonExcesses>({
        from: f.address,
        to: f.user.address,
    });
    expect(testing.getAccountBalance(f.address)).toEqual(reserve);
    val state = mailboxData(f.address);
    expect(state.potholeId).toEqual(42);
    expect(state.factory).toEqual(f.factory.address);
    expect(state.ownerPublicKey).toEqual(f.ownerKey.publicKey);
    expect(state.userPublicKey).toEqual(f.userKey.publicKey);
    expect(state.user).toEqual(f.user.address);
    expect(state.seqno).toEqual(0);
    expect(state.lastMessage).toBeNull();
    expect(state.expiration).toEqual(TEST_NOW + 300);
    val initialization = initialized.findTransaction<InternalMintPothole>({ to: f.address })!;
    expect(state.deploymentId).toEqual((initialization.now << 64) | initialization.lt);
}

get fun `test deployment identity uses authorized initialization time instead of empty predeployment`() {
    val f = setupMailbox(0, false);
    expect(mailboxData(f.address).deploymentId).toEqual(0);
    testing.setNow(TEST_NOW + 60);
    val result = sendMailbox(f, f.factory.address, initializeBody(f));
    expect(result).toHaveSuccessfulTx<InternalMintPothole>({ to: f.address, deploy: false });
    val initialization = result.findTransaction<InternalMintPothole>({ to: f.address })!;
    val deploymentId = mailboxData(f.address).deploymentId;
    expect(initialization.now).toEqual(TEST_NOW + 60);
    expect(deploymentId).toEqual((initialization.now << 64) | initialization.lt);
    expect(deploymentId >> 64).toEqual(TEST_NOW + 60);
    expect(deploymentId & MAX_SEQNO).toEqual(initialization.lt);
}

get fun `test owner confirms first then user replies and owner sends again without outgoing actions`() {
    val f = setupMailbox();
    val first = payloadFixture(28, 0x11);
    val second = payloadFixture(127, 0x22);
    val third = nestedPayload(0x33);
    val balance = testing.getAccountBalance(f.address);
    expectExternalAccepted(f, signedBody(request(f, 0, 0, first), f.ownerKey), 1, first);
    expectExternalAccepted(f, signedBody(request(f, 1, 1, second), f.userKey), 2, second);
    expectExternalAccepted(f, signedBody(request(f, 2, 0, third), f.ownerKey), 3, third);
    expect(testing.getAccountBalance(f.address)).toBeLess(balance);
}

get fun `test user cannot confirm for owner or take the first turn`() {
    val f = setupMailbox();
    expectExternalRejected(f, signedBody(request(f), f.userKey), Errors.InvalidSignature);
    expectExternalRejected(f, signedBody(request(f, 0, 1), f.userKey), Errors.WrongTurn);
    expectExternalRejected(
        f,
        signedBody(request(f), crypto.seedToKeyPair(333)),
        Errors.InvalidSignature,
    );
    val payload = payloadFixture();
    expectExternalAccepted(f, signedBody(request(f, 0, 0, payload), f.ownerKey), 1, payload);
    expectExternalRejected(f, signedBody(request(f, 1, 0), f.ownerKey), Errors.WrongTurn);
    expectExternalRejected(f, signedBody(request(f, 1, 1), f.ownerKey), Errors.InvalidSignature);
}

get fun `test replay stale and future sequence numbers cannot advance the mailbox`() {
    val f = setupMailbox();
    val payload = payloadFixture();
    val first = signedBody(request(f, 0, 0, payload), f.ownerKey);
    expectExternalRejected(f, signedBody(request(f, 2, 0), f.ownerKey), Errors.InvalidSeqno);
    expectExternalAccepted(f, first, 1, payload);
    expectExternalRejected(f, first, Errors.InvalidSeqno);
    expectExternalRejected(f, signedBody(request(f, 0, 1), f.userKey), Errors.InvalidSeqno);
    expectExternalRejected(f, signedBody(request(f, 3, 1), f.userKey), Errors.InvalidSeqno);
}

get fun `test deployment identity must match and is covered by the signature`() {
    val f = setupMailbox();
    val wrongId = mailboxData(f.address).deploymentId + 1;
    val otherDeployment = request(
        f,
        0,
        0,
        null,
        TEST_NOW + 600,
        null,
        wrongId,
    );
    expectExternalRejected(
        f,
        signedBody(otherDeployment, f.ownerKey),
        Errors.InvalidDeploymentId,
    );
    // Correcting the ID without obtaining a fresh signature cannot authorize this deployment.
    val signature = crypto.rawSign(f.ownerKey.privateKey, otherDeployment.hash());
    expectExternalRejected(
        f,
        beginCell().storeSlice(signature).storeRef(request(f)).endCell(),
        Errors.InvalidSignature,
    );
}

get fun `test owner confirmation cannot be replayed after closing and redeploying later`() {
    assertConfirmationRejectedAfterRedeployment(1);
}

get fun `test owner confirmation cannot be replayed after redeploying within the same second`() {
    assertConfirmationRejectedAfterRedeployment(0);
}

get fun `test external request deadlines and contract expiration are exclusive`() {
    val f = setupMailbox(TEST_NOW + 10);
    expectExternalRejected(
        f,
        signedBody(request(f, 0, 0, null, TEST_NOW), f.ownerKey),
        Errors.Expired,
    );
    val payload = payloadFixture();
    testing.setNow(TEST_NOW + 9);
    expectExternalAccepted(f, signedBody(request(f, 0, 0, payload), f.ownerKey), 1, payload);
    testing.setNow(TEST_NOW + 10);
    expectExternalRejected(f, signedBody(request(f, 1, 1), f.userKey), Errors.Expired);
    expect(sendMailbox(f, f.user.address, createEmptyCell())).toHaveSuccessfulTx({ to: f.address });
    expectExternalRejected(f, signedBody(request(f, 1, 1), f.userKey), Errors.Expired);
}

get fun `test zero expiration remains unlimited after time advances`() {
    val f = setupMailbox();
    testing.setNow(TEST_NOW + 86400);
    val payload = payloadFixture();
    expectExternalAccepted(
        f,
        signedBody(request(f, 0, 0, payload, TEST_NOW + 86460), f.ownerKey),
        1,
        payload,
    );
    expect(mailboxData(f.address).expiration).toEqual(0);
}

get fun `test signature binds destination payload subtree and validity deadline`() {
    val f = setupMailbox();
    expectExternalRejected(
        f,
        signedBody(
            request(
                f,
                0,
                0,
                null,
                TEST_NOW + 600,
                f.user.address,
            ),
            f.ownerKey,
        ),
        Errors.WrongSender,
    );
    val originalPayload = nestedPayload(0x11);
    val changedPayload = nestedPayload(0x12);
    expect(originalPayload.beginParse().loadUint(3)).toEqual(
        changedPayload.beginParse().loadUint(3),
    );
    val root = request(f, 0, 0, originalPayload);
    val signature = crypto.rawSign(f.ownerKey.privateKey, root.hash());
    val changed = request(f, 0, 0, changedPayload);
    expectExternalRejected(
        f,
        beginCell().storeSlice(signature).storeRef(changed).endCell(),
        Errors.InvalidSignature,
    );
    val deadline = request(f, 0, 0, originalPayload, TEST_NOW + 601);
    expectExternalRejected(
        f,
        beginCell().storeSlice(signature).storeRef(deadline).endCell(),
        Errors.InvalidSignature,
    );
    val payloadSignature = crypto.rawSign(f.ownerKey.privateKey, originalPayload.hash());
    expectExternalRejected(
        f,
        beginCell().storeSlice(payloadSignature).storeRef(root).endCell(),
        Errors.InvalidSignature,
    );
    expectExternalAccepted(f, signedBody(changed, f.ownerKey), 1, changedPayload);
}

get fun `test empty nonaligned maximum bit and shared-reference payloads are preserved`() {
    val f = setupMailbox();
    val leaf = payloadFixture(127);
    val full = beginCell().storeSlice(leaf.beginParse()).storeUint(127, 7).endCell();
    val tree = beginCell()
        .storeUint(1, 1)
        .storeRef(leaf)
        .storeRef(leaf)
        .storeRef(nestedPayload(4))
        .storeRef(createEmptyCell())
        .endCell();
    val payloads: array<cell> = [
        createEmptyCell(),
        beginCell().storeUint(1, 1).endCell(),
        full,
        tree,
    ];
    var seqno = 0;
    repeat (payloads.size()) {
        val payload = payloads.get(seqno);
        val key = seqno % 2 == 0 ? f.ownerKey : f.userKey;
        expectExternalAccepted(
            f,
            signedBody(request(f, seqno, seqno & 1, payload), key),
            seqno + 1,
            payload,
        );
        seqno += 1;
    }
}

get fun `test malformed external envelopes and signed request tails are rejected`() {
    val f = setupMailbox();
    val root = request(f);
    val body = signedBody(root, f.ownerKey);
    var signature = crypto.rawSign(f.ownerKey.privateKey, root.hash());
    val malformed: array<cell> = [
        createEmptyCell(),
        beginCell().storeSlice(signature).endCell(),
        beginCell().storeSlice(signature.loadBits(511)).storeRef(root).endCell(),
        beginCell().storeSlice(body.beginParse()).storeUint(1, 1).endCell(),
        beginCell().storeSlice(body.beginParse()).storeRef(createEmptyCell()).endCell(),
        signedBody(beginCell().storeSlice(root.beginParse()).storeUint(1, 1).endCell(), f.ownerKey),
        signedBody(
            beginCell().storeSlice(root.beginParse()).storeRef(createEmptyCell()).endCell(),
            f.ownerKey,
        ),
    ];
    var index = 0;
    repeat (malformed.size()) {
        expectExternalRejected(f, malformed.get(index), 9);
        index += 1;
    }
    expectExternalRejected(f, signedBody(createEmptyCell(), f.ownerKey), 63);
    val legacyRequest = beginCell()
        .storeUint(0x706f7468, 32)
        .storeAddress(f.address)
        .storeUint(0, 64)
        .storeUint(TEST_NOW + 600, 32)
        .storeUint(0, 1)
        .storeRef(payloadFixture())
        .endCell();
    expectExternalRejected(f, signedBody(legacyRequest, f.ownerKey), 9);
}

get fun `test initialization is factory-only single-use and required before external writes`() {
    val f = setupMailbox(0, false);
    expect(mailboxData(f.address)).toEqual(PotholeStorageRuntime {
        potholeId: 42,
        factory: f.factory.address,
        ownerPublicKey: 0,
        userPublicKey: 0,
        user: null,
        seqno: 0,
        lastMessage: null,
        expiration: 0,
        deploymentId: 0,
    });
    expectExternalRejected(f, signedBody(request(f), f.ownerKey), Errors.NotInitialized);
    expect(sendMailbox(f, f.user.address, createEmptyCell())).toHaveSuccessfulTx({ to: f.address });
    expect(mailboxData(f.address).user).toBeNull();
    expect(
        sendMailbox(f, f.owner.address, initializeBody(f)),
    ).toHaveFailedTx({ to: f.address, exitCode: Errors.WrongSender });
    expect(
        sendMailbox(f, f.factory.address, initializeBody(f)),
    ).toHaveSuccessfulTx({ to: f.address });
    val state = mailboxData(f.address);
    expect(
        sendMailbox(f, f.factory.address, initializeBody(f)),
    ).toHaveFailedTx({ to: f.address, exitCode: Errors.AlreadyInitialized });
    expect(mailboxData(f.address)).toEqual(state);
}

get fun `test invalid participants and malformed initialization never initialize storage`() {
    val f = setupMailbox(0, false);
    val missingOwner = InternalMintPothole {
        queryId: 1,
        ownerPublicKey: 0,
        userPublicKey: f.userKey.publicKey,
        user: f.user.address,
        expiration: 0,
    };
    expect(
        sendMailbox(f, f.factory.address, missingOwner.toCell()),
    ).toHaveFailedTx({ to: f.address, exitCode: Errors.InvalidParams });
    val masterchainUser = testing.treasury("init-masterchain-user", MASTERCHAIN);
    val invalidUser = InternalMintPothole {
        queryId: 1,
        ownerPublicKey: f.ownerKey.publicKey,
        userPublicKey: f.userKey.publicKey,
        user: masterchainUser.address,
        expiration: 0,
    };
    expect(
        sendMailbox(f, f.factory.address, invalidUser.toCell()),
    ).toHaveFailedTx({ to: f.address, exitCode: Errors.InvalidWorkchain });
    val badKeys: array<int> = [0, f.ownerKey.publicKey];
    var index = 0;
    repeat (badKeys.size()) {
        val body = InternalMintPothole {
            queryId: 1,
            ownerPublicKey: f.ownerKey.publicKey,
            userPublicKey: badKeys.get(index),
            user: f.user.address,
            expiration: 0,
        };
        expect(
            sendMailbox(f, f.factory.address, body.toCell()),
        ).toHaveFailedTx({ to: f.address, exitCode: Errors.InvalidParams });
        expect(mailboxData(f.address).user).toBeNull();
        index += 1;
    }
    val body = initializeBody(f);
    val malformed: array<cell> = [
        beginCell().storeUint(0x696e6974, 32).endCell(),
        beginCell().storeSlice(body.beginParse()).storeUint(1, 1).endCell(),
        beginCell().storeSlice(body.beginParse()).storeRef(createEmptyCell()).endCell(),
    ];
    index = 0;
    repeat (malformed.size()) {
        expect(
            sendMailbox(f, f.factory.address, malformed.get(index)),
        ).toHaveFailedTx({ to: f.address, exitCode: 9 });
        expect(mailboxData(f.address).user).toBeNull();
        index += 1;
    }
}

get fun `test internal bodies cannot overwrite ciphertext and empty transfers only top up`() {
    val f = setupMailbox();
    val payload = payloadFixture();
    expectExternalAccepted(f, signedBody(request(f, 0, 0, payload), f.ownerKey), 1, payload);
    val state = mailboxData(f.address);
    expect(
        sendMailbox(f, f.user.address, signedBody(request(f, 1, 1), f.userKey)),
    ).toHaveFailedTx({ to: f.address, exitCode: Errors.WrongOp });
    val balance = testing.getAccountBalance(f.address);
    expect(sendMailbox(f, f.user.address, createEmptyCell())).toHaveSuccessfulTx({ to: f.address });
    expect(testing.getAccountBalance(f.address)).toBeGreater(balance);
    expect(mailboxData(f.address)).toEqual(state);
}

get fun `test sequence exhaustion does not wrap to zero`() {
    val f = setupMailbox(0, true, MAX_SEQNO - 1);
    val payload = payloadFixture();
    expectExternalAccepted(
        f,
        signedBody(request(f, MAX_SEQNO - 1, 0, payload), f.ownerKey),
        MAX_SEQNO,
        payload,
    );
    expectExternalRejected(f, signedBody(request(f, MAX_SEQNO, 1), f.userKey), Errors.InvalidSeqno);
    expectExternalRejected(f, signedBody(request(f, 0, 0), f.ownerKey), Errors.InvalidSeqno);
}

get fun `test only stored user can close not owner factory or a stranger`() {
    val f = setupMailbox();
    val stranger = testing.treasury("close-stranger");
    val senders: array<address> = [f.owner.address, f.factory.address, stranger.address];
    val state = mailboxData(f.address);
    var index = 0;
    repeat (senders.size()) {
        expect(
            sendMailbox(f, senders.get(index), ClosePothole { queryId: 7 }.toCell()),
        ).toHaveFailedTx({ to: f.address, exitCode: Errors.WrongSender });
        expect(mailboxData(f.address)).toEqual(state);
        expect(testing.isDeployed(f.address)).toEqual(true);
        index += 1;
    }
    val masterchainSender = testing.treasury("close-masterchain-sender", MASTERCHAIN);
    expect(
        sendMailbox(f, masterchainSender.address, ClosePothole { queryId: 7 }.toCell()),
    ).toHaveFailedTx({ to: f.address, exitCode: Errors.InvalidWorkchain });
    expect(mailboxData(f.address)).toEqual(state);
}

get fun `test user closes an unconfirmed mailbox and recovers every remaining coin less fees`() {
    val f = setupMailbox();
    expect(mailboxData(f.address).seqno).toEqual(0);
    assertClosedMailbox(f, 71);
}

get fun `test user also closes an unconfirmed mailbox that has already expired`() {
    val f = setupMailbox(TEST_NOW - 1);
    expect(mailboxData(f.address).seqno).toEqual(0);
    expectExternalRejected(f, signedBody(request(f), f.ownerKey), Errors.Expired);
    assertClosedMailbox(f, 74);
}

get fun `test user closes on owner turn after a complete exchange`() {
    val f = setupMailbox();
    val payload = payloadFixture();
    expectExternalAccepted(f, signedBody(request(f, 0, 0, payload), f.ownerKey), 1, payload);
    expectExternalAccepted(f, signedBody(request(f, 1, 1, payload), f.userKey), 2, payload);
    assertClosedMailbox(f, 72);
}

get fun `test user closes on its own turn and after expiration`() {
    val f = setupMailbox(TEST_NOW + 10);
    val payload = payloadFixture();
    expectExternalAccepted(f, signedBody(request(f, 0, 0, payload), f.ownerKey), 1, payload);
    testing.setNow(TEST_NOW + 10);
    expectExternalRejected(f, signedBody(request(f, 1, 1), f.userKey), Errors.Expired);
    assertClosedMailbox(f, 73);
}

get fun `test uninitialized and malformed close requests cannot delete the mailbox`() {
    val pending = setupMailbox(0, false);
    expect(
        sendMailbox(pending, pending.user.address, ClosePothole { queryId: 1 }.toCell()),
    ).toHaveFailedTx({ to: pending.address, exitCode: Errors.NotInitialized });
    expect(
        sendMailbox(pending, pending.factory.address, initializeBody(pending)),
    ).toHaveSuccessfulTx({ to: pending.address });
    val body = ClosePothole { queryId: 1 }.toCell();
    val malformed: array<cell> = [
        beginCell().storeUint(0x636c6f73, 32).endCell(),
        beginCell().storeSlice(body.beginParse()).storeUint(1, 1).endCell(),
        beginCell().storeSlice(body.beginParse()).storeRef(createEmptyCell()).endCell(),
    ];
    val state = mailboxData(pending.address);
    var index = 0;
    repeat (malformed.size()) {
        expect(
            sendMailbox(pending, pending.user.address, malformed.get(index)),
        ).toHaveFailedTx({ to: pending.address, exitCode: 9 });
        expect(testing.isDeployed(pending.address)).toEqual(true);
        expect(mailboxData(pending.address)).toEqual(state);
        index += 1;
    }
}

get fun `test bounced close messages never execute the close handler`() {
    val f = setupMailbox();
    val state = mailboxData(f.address);
    val body = beginCell()
        .storeUint(0xffffffff, 32)
        .storeSlice(ClosePothole { queryId: 9 }.toCell().beginParse())
        .endCell();
    val bouncedCloseMessage = createMessage({ dest: f.address, value: grams("0.05"), bounce: false, body });
    var encoded = bouncedCloseMessage.messageCell.beginParse();
    val flags = encoded.loadUint(4);
    val bounced = OutMessage {
        messageCell: beginCell().storeUint(flags | 1, 4).storeSlice(encoded).endCell(),
    };
    val result = net.send(f.user.address, bounced);
    expect(result).toHaveSuccessfulTx({ to: f.address, bounced: true });
    expect(result.size()).toEqual(1);
    expect(testing.isDeployed(f.address)).toEqual(true);
    expect(mailboxData(f.address)).toEqual(state);
}

fun assertClosedMailbox(f: MailboxFixture, queryId: uint64): void {
    val before = testing.getAccountBalance(f.address);
    val result = sendMailbox(f, f.user.address, ClosePothole { queryId }.toCell());
    expect(result).toHaveSuccessfulTx<ClosePothole>({ from: f.user.address, to: f.address });
    expect(result).toHaveSuccessfulTx<JettonExcesses>({ from: f.address, to: f
            .user
            .address, bounce: false });
    val close = result.findTransaction<ClosePothole>({ to: f.address })!;
    val refund = result.findTransaction<JettonExcesses>({ from: f.address, to: f.user.address })!;
    expect(refund.loadBody<JettonExcesses>().queryId).toEqual(queryId);
    expect(close.origStatus).toEqual(TlbAccountStatus.Active);
    expect(close.endStatus).toEqual(TlbAccountStatus.NonExisting);
    val description = close.description.load();
    assert (description is TlbTransOrd) throw 700;
    expect(description.destroyed).toEqual(true);
    val incoming = close.loadInMsg<ClosePothole>().info;
    assert (incoming is TlbInternalMessage) throw 702;
    val payout = refund.loadInMsg<JettonExcesses>().info;
    assert (payout is TlbInternalMessage) throw 703;
    expect(payout.value.grams + payout.forwardFee + close.totalFees.grams).toEqual(
        before + incoming.value.grams,
    );
    expect(payout.value.grams).toBeGreater(before);
    val actions = result.at(0).allOutActions();
    expect(actions.size()).toEqual(1);
    val action = actions.at(0);
    assert (action is TlbOutActionSendMessage) throw 701;
    expect(action.mode).toEqual(SEND_MODE_CARRY_ALL_BALANCE | SEND_MODE_DESTROY);
    expect(testing.isDeployed(f.address)).toEqual(false);
    expect(testing.getAccountBalance(f.address)).toEqual(0);
}

fun assertConfirmationRejectedAfterRedeployment(elapsedSeconds: uint32): void {
    val f = setupMailbox();
    val initial = mailboxData(f.address);
    val payload = payloadFixture();
    val confirmation = signedBody(request(f, 0, 0, payload), f.ownerKey);
    expectExternalAccepted(f, confirmation, 1, payload);
    assertClosedMailbox(f, 80);

    testing.setNow(TEST_NOW + elapsedSeconds);
    val next = MailboxFixture {
        address: f.address,
        factory: f.factory,
        owner: f.owner,
        user: testing.treasury("redeployed-mailbox-user"),
        ownerKey: f.ownerKey,
        userKey: crypto.seedToKeyPair(333),
    };
    val destination = AutoDeployAddress {
        stateInit: {
            code: build("Pothole"),
            data: PotholeStorage.initData(initial.potholeId, f.factory.address).toCell(),
        },
    };
    expect(destination.calculateAddress()).toEqual(f.address);
    val redeployed = net.send(
        f.factory.address,
        createMessage({
            dest: destination,
            value: grams("0.3"),
            bounce: false,
            body: initializeBody(next),
        }),
    );
    expect(redeployed).toHaveSuccessfulDeploy({ to: f.address });
    val deployment = redeployed.findTransaction<InternalMintPothole>({ to: f.address })!;
    val state = mailboxData(f.address);
    expect(state.seqno).toEqual(0);
    expect(state.ownerPublicKey).toEqual(initial.ownerPublicKey);
    expect(state.user).toEqual(next.user.address);
    expect(state.user).toNotEqual(initial.user);
    expect(state.userPublicKey).toEqual(next.userKey.publicKey);
    expect(state.userPublicKey).toNotEqual(initial.userPublicKey);
    expect(state.deploymentId).toEqual((deployment.now << 64) | deployment.lt);
    expect(state.deploymentId >> 64).toEqual(TEST_NOW + elapsedSeconds);
    expect(state.deploymentId).toNotEqual(initial.deploymentId);
    expectExternalRejected(next, confirmation, Errors.InvalidDeploymentId);
    expectExternalAccepted(
        next,
        signedBody(request(next, 0, 0, payload), next.ownerKey),
        1,
        payload,
    );
    expectExternalAccepted(
        next,
        signedBody(request(next, 1, 1, payload), next.userKey),
        2,
        payload,
    );
}
