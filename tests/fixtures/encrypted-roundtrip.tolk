import "@acton/crypto"
import "@acton/env"
import "@acton/fmt"
import "@acton/fs"
import "@acton/io"
import "@acton/emulation/network"
import "@acton/emulation/testing"
import "@acton/testing/assert"
import "@acton/testing/expect"
import "@acton/tlb/maybe"
import "@acton/types/big_array"
import "@acton/types/transaction"
import "@pothole/interfaces"
import "@tests/helpers/contracts"

// The host's file-byte snake can use smaller chunks. Repack raw bytes explicitly
// so the transport fixture always uses full 127-byte non-tail cells.
fun packByteSnake(bytes: slice): cell {
    var source = bytes;
    var chunk = beginCell();
    var chunks = BigArray<cell>.createEmpty();
    while (true) {
        expect(source.remainingBitsCount() % 8).toEqual(0);
        expect(source.remainingRefsCount() <= 1).toEqual(true);
        while (source.remainingBitsCount() != 0) {
            val bits = min(source.remainingBitsCount(), 1016 - chunk.bitsCount());
            chunk.storeSlice(source.loadBits(bits));
            if (chunk.bitsCount() == 1016) {
                chunks.push(chunk.endCell());
                chunk = beginCell();
            }
        }
        if (source.remainingRefsCount() == 0) {
            break;
        }
        source = source.loadRef().beginParse();
    }
    if (chunk.bitsCount() != 0 || chunks.size() == 0) {
        chunks.push(chunk.endCell());
    }
    var tail = chunks.last();
    chunks.pop();
    while (chunks.size() != 0) {
        tail = beginCell().storeSlice(chunks.last().beginParse()).storeRef(tail).endCell();
        chunks.pop();
    }
    return tail;
}

// This test-client encoding has no opcode/comment prefix. Each non-tail cell
// contains exactly 127 bytes and one reference to the next chunk.
fun inspectByteSnake(payload: cell): (int, int) {
    var chunk = payload.beginParse();
    var bytes = 0;
    var cells = 0;
    while (true) {
        val bits = chunk.remainingBitsCount();
        val refs = chunk.remainingRefsCount();
        expect(bits % 8).toEqual(0);
        expect(bits <= 1016).toEqual(true);
        expect(refs <= 1).toEqual(true);
        bytes += bits / 8;
        cells += 1;
        if (refs == 0) {
            // An empty root is valid snake data; redundant empty tails are not.
            expect(cells == 1 || bits > 0).toEqual(true);
            break;
        }
        expect(bits).toEqual(1016);
        chunk = chunk.loadRef().beginParse();
    }
    expect(cells).toEqual(bytes == 0 ? 1 : (bytes + 126) / 127);
    return (bytes, cells);
}

fun main() {
    if (net.isBroadcasting()) {
        Assert.fail("Encrypted roundtrip fixture uses public test signing keys; never run with --net");
    }
    val directory = env<string>("POTHOLE_TEST_DIR");
    if (directory == null) {
        Assert.fail("Set POTHOLE_TEST_DIR to a project-relative fixture directory under build/");
    }
    var count = 3;
    if (env<string>("POTHOLE_TEST_COUNT") != null) {
        val configuredCount = env<int>("POTHOLE_TEST_COUNT");
        if (configuredCount == null || configuredCount <= 0) {
            Assert.fail("POTHOLE_TEST_COUNT must be a positive integer");
        }
        count = configuredCount;
    }

    val f = setupMailbox();
    val mailbox = f.address;
    val ownerKey = f.ownerKey;
    val userKey = f.userKey;
    expect(mailboxData(mailbox).expiration).toEqual(0);

    var index = 0;
    repeat (count) {
        // Only encrypted bytes cross this bridge; encryption keys remain in Node.
        val encrypted = fs.readBytes(format("{}/{}.encrypted", directory, index));
        if (encrypted == null) {
            Assert.fail("Cannot read encrypted fixture; POTHOLE_TEST_DIR must stay inside the project");
        }
        // Repack the host byte snake without adding any protocol/comment prefix.
        val payload = packByteSnake(encrypted);
        val (bytes, cells) = inspectByteSnake(payload);
        expect(bytes >= 28).toEqual(true);

        expect(mailboxData(mailbox).seqno).toEqual(index);
        val sender = index & 1;
        val root = request(f, index, sender, payload, blockchain.now() + 300);
        val signature = crypto.rawSign(
            sender == 0 ? ownerKey.privateKey : userKey.privateKey,
            root.hash(),
        );
        val envelope = ExternalMessage {
            signature: signature as bits512,
            message: root,
        };
        val balanceBefore = testing.getAccountBalance(mailbox);
        val sent = net.sendExternal(net.createExternalMessage(mailbox, envelope));
        expect(sent).toBeAccepted();
        val transactions = sent.unwrap();
        expect(transactions.size()).toEqual(1);
        val transaction = transactions.at(0);
        val tx = transaction.tx.load();
        expect(tx.getAccountAddress()).toEqual(mailbox);
        val description = tx.description.load();
        assert (description is TlbTransOrd) throw 700;
        expect(description.aborted).toEqual(false);
        val compute = description.computePh;
        assert (compute is TlbTrComputeVm) throw 701;
        expect(compute.success).toEqual(true);
        val action = description.action.unwrap().load();
        expect(action.success).toEqual(true);
        expect(action.resultCode).toEqual(0);
        expect(transaction.outMessages.size()).toEqual(0);
        expect(transaction.externals.size()).toEqual(0);
        expect(transaction.allOutActions().size()).toEqual(0);
        expect(balanceBefore - testing.getAccountBalance(mailbox)).toEqual(
            tx.totalFees.grams,
        );
        expect(mailboxData(mailbox).seqno).toEqual(index + 1);

        val stored = mailboxData(mailbox).lastMessage;
        expect(stored).toBeNotNull();
        expect(stored!.hash()).toEqual(payload.hash());
        expect(inspectByteSnake(stored!)).toEqual((bytes, cells));
        // writeBytes flattens the snake in order; the Node test checks byte equality
        // and decrypts this getter result, never the original input buffer.
        if (!fs.writeBytes(format("{}/{}.stored", directory, index), stored!.beginParse())) {
            Assert.fail("Cannot export stored payload to the project-relative fixture directory");
        }
        val sizes = format(
            "seqno={} plaintext_bytes={} encrypted_bytes={} snake_cells={}",
            index,
            bytes - 28,
            bytes,
            cells,
        );
        val costs = format(
            "gas={} compute_nanoton={} total_nanoton={}",
            transaction.gasUsed,
            compute.gasFees,
            tx.totalFees.grams,
        );
        println("{} {}", sizes, costs);
        index += 1;
    }
    val closed = sendMailbox(f, f.user.address, ClosePothole { queryId: 99 }.toCell());
    expect(closed).toHaveSuccessfulTx<ClosePothole>({ to: mailbox });
    expect(testing.isDeployed(mailbox)).toEqual(false);
    expect(testing.getAccountBalance(mailbox)).toEqual(0);
}
