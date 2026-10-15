import "@acton/build"
import "@acton/crypto"
import "@acton/fmt"
import "@acton/io"
import "@acton/emulation/network"
import "@acton/emulation/testing"
import "@acton/testing/expect"
import "@acton/types/big_array"
import "@acton/types/transaction"
import "@pothole/interfaces"

get fun `test gas deployment`() {
    val (mailbox, _, _, deployment) = setupGasTest();
    // Measure only Pothole, excluding the funding wallet's transaction.
    val tx = deployment.findTransaction({ to: mailbox, deploy: true });
    expect(tx).toBeNotNull();
    printGas("Deploy Pothole", tx!);
}

get fun `test gas close returns the remaining balance and deletes the mailbox`() {
    val (mailbox, _, _, _) = setupGasTest();
    val user = testing.treasury("gas-user");
    val trace = net.send(
        user.address,
        createMessage({
            dest: mailbox,
            value: grams("0.05"),
            bounce: false,
            body: ClosePothole { queryId: 88 },
        }),
    );
    val closed = trace.findTransaction<ClosePothole>({ to: mailbox });
    expect(closed).toBeNotNull();
    printGas("Close Pothole", closed!);
    expect(closed!.endStatus).toEqual(TlbAccountStatus.NonExisting);
    expect(testing.isDeployed(mailbox)).toEqual(false);
    expect(testing.getAccountBalance(mailbox)).toEqual(0);
}

get fun `test gas owner user owner with payload 28 bytes`() {
    measureExchange(28);
}

get fun `test gas owner user owner with payload 127 bytes`() {
    measureExchange(127);
}

get fun `test gas owner user owner with payload 1024 bytes across nine cells`() {
    measureExchange(1024);
}

fun setupGasTest(): (address, KeyPair, KeyPair, SendResultList) {
    testing.setNow(1700000000);
    testing.setChecksigIgnore(false);
    val keyA = crypto.seedToKeyPair(1);
    val keyB = crypto.seedToKeyPair(2);
    val factory = testing.treasury("gas-factory");
    val user = testing.treasury("gas-user");
    val destination = AutoDeployAddress {
        stateInit: {
            code: build("Pothole"),
            data: PotholeStorage.initData(0, factory.address).toCell(),
        },
    };
    val mailbox = destination.calculateAddress();
    val deployment = net.send(
        factory.address,
        createMessage({
            dest: destination,
            value: grams("0.3"),
            bounce: false,
            body: InternalMintPothole {
                queryId: 0,
                ownerPublicKey: keyA.publicKey,
                userPublicKey: keyB.publicKey,
                user: user.address,
                expiration: 0,
            },
        }),
    );
    expect(deployment).toHaveSuccessfulDeploy({ to: mailbox });
    return (mailbox, keyA, keyB, deployment);
}

fun measureExchange(payloadBytes: int) {
    val (mailbox, keyA, keyB, _) = setupGasTest();
    val deploymentId = net
        .runGetMethod<PotholeStorageRuntime>(mailbox, "getPotholeData")
        .deploymentId;
    var seqno = 0;
    repeat (3) {
        // Opaque bytes: encryption runs off-chain and does not consume contract gas.
        val message = ExternalMessageData {
            destination: mailbox,
            deploymentId,
            seqno,
            validUntil: blockchain.now() + 60,
            sender: seqno & 1,
            ciphertext: gasPayload(payloadBytes, seqno + 1),
        };
        val key = (seqno & 1) == 0 ? keyA : keyB;
        val root = message.toCell();
        val signature = crypto.rawSign(key.privateKey, root.hash()) as bits512;
        val balanceBefore = testing.getAccountBalance(mailbox);
        val sent = net.sendExternal(
            net.createExternalMessage(
                mailbox,
                ExternalMessage {
                    signature,
                    message: root,
                },
            ),
        );
        expect(sent).toBeAccepted();
        val trace = sent.unwrap();
        expect(trace.size()).toEqual(1);
        val result = trace.at(0);
        val tx = result.tx.load();
        expect(tx.getAccountAddress()).toEqual(mailbox);
        expect(result.outMessages.size()).toEqual(0);
        val stored = net.runGetMethod<PotholeStorageRuntime>(mailbox, "getPotholeData");
        expect(stored.seqno).toEqual(seqno + 1);
        expect(stored.lastMessage!.hash()).toEqual(message.ciphertext.hash());
        expect(balanceBefore - testing.getAccountBalance(mailbox)).toEqual(
            tx.totalFees.grams,
        );
        printGas(
            format(
                "{} seqno={} payload={} B",
                (seqno & 1) == 0 ? "owner" : "user",
                seqno,
                payloadBytes,
            ),
            tx,
        );
        seqno += 1;
    }
}

// Build a snake of cells, each carrying up to 127 data bytes and a reference to the tail.
fun gasPayload(bytes: int, value: uint8): cell {
    var tail = createEmptyCell();
    var remaining = bytes;
    while (remaining > 0) {
        val chunkBytes = min(remaining, 127);
        var chunk = beginCell();
        repeat (chunkBytes) {
            chunk.storeUint(value, 8);
        }
        if (remaining != bytes) {
            chunk.storeRef(tail);
        }
        tail = chunk.endCell();
        remaining -= chunkBytes;
    }
    return tail;
}

fun printGas(label: string, tx: TlbTransaction) {
    val description = tx.description.load();
    assert (description is TlbTransOrd) throw 700;
    expect(description.aborted).toBeFalse();
    val compute = description.computePh;
    assert (compute is TlbTrComputeVm) throw 701;
    expect(compute.success).toBeTrue();
    println(
        "{} | gas={} | compute={} TON | total={} TON",
        label,
        tx.getUsedGas(),
        gasFeeInTon(compute.gasFees),
        gasFeeInTon(tx.totalFees.grams),
    );
}

fun gasFeeInTon(nanoton: coins): string {
    return format("{}.{:09}", nanoton / 1000000000, nanoton % 1000000000);
}
