import "@acton/emulation/config"
import "@acton/emulation/network"
import "@acton/emulation/testing"
import "@acton/testing/expect"
import "@acton/tlb/maybe"
import "@acton/types/transaction"
import "@tests/helpers/contracts"

const STORAGE_TEST_SECONDS = 86400

get fun `test opaque empty shared nonbyte and 32 KiB payloads use the same external gas`() {
    val f = setupMailbox();
    val empty = createEmptyCell();
    val leaf = beginCell().storeUint(5, 3).endCell();
    val shared = beginCell()
        .storeUint(1, 1)
        .storeRef(leaf)
        .storeRef(leaf)
        .storeRef(leaf)
        .storeRef(leaf)
        .endCell();
    val large = storageSnakePayload();
    val first = expectExternalAccepted(
        f,
        signedBody(request(f, 0, 0, empty), f.ownerKey),
        1,
        empty,
    );
    val second = expectExternalAccepted(
        f,
        signedBody(request(f, 1, 1, shared), f.userKey),
        2,
        shared,
    );
    val third = expectExternalAccepted(
        f,
        signedBody(request(f, 2, 0, large), f.ownerKey),
        3,
        large,
    );
    expect(first.gasUsed).toEqual(second.gasUsed);
    expect(first.gasUsed).toEqual(third.gasUsed);
    expect(third.gasUsed).toBeLess(10000);
    expect(large.depth()).toEqual(258);
}

get fun `test storing a large payload accounts for its distinct cells and bits`() {
    val f = setupMailbox();
    val account = testing.getAccountState(f.address)!;

    val large = storageSnakePayload();
    expectExternalAccepted(f, signedBody(request(f, 0, 0, large), f.ownerKey), 1, large);
    val withPayload = testing.getAccountState(f.address)!;
    // This fixture has exactly 259 distinct cells and 32796 bytes of data.
    expect(withPayload.storageStat.used.cells - account.storageStat.used.cells).toEqual(259);
    expect(withPayload.storageStat.used.bits - account.storageStat.used.bits).toEqual(32796 * 8);
}

get fun `test an empty top up pays actual large payload rent after 24 hours and preserves storage`() {
    val f = setupMailbox();
    val large = storageSnakePayload();
    val body = signedBody(request(f, 0, 0, large), f.ownerKey);
    expectExternalAccepted(f, body, 1, large);
    val remaining = testing.getAccountBalance(f.address);
    val used = testing.getAccountState(f.address)!.storageStat.used;
    val rent = independentStorageFee(used.bits, used.cells);
    expect(rent).toBeGreater(0);
    expect(rent).toBeLessOrEqual(remaining);
    val state = mailboxData(f.address);

    testing.setNow(TEST_NOW + STORAGE_TEST_SECONDS);
    val paid = sendMailbox(f, f.user.address, createEmptyCell(), grams("0.001"));
    expect(paid).toHaveSuccessfulTx({ to: f.address });
    expect(collectedStorageFee(paid, f.address)).toEqual(rent);
    expect(testing.isDeployed(f.address)).toBeTrue();
    expect(testing.getAccountBalance(f.address)).toBeGreater(0);
    expect(mailboxData(f.address)).toEqual(state);
}

get fun `test shrinking an old large payload cannot avoid already accrued storage rent`() {
    val f = setupMailbox();
    val large = storageSnakePayload();
    expectExternalAccepted(f, signedBody(request(f, 0, 0, large), f.ownerKey), 1, large);
    val small = createEmptyCell();
    val body = signedBody(
        request(f, 1, 1, small, TEST_NOW + STORAGE_TEST_SECONDS + 600),
        f.userKey,
    );
    val used = testing.getAccountState(f.address)!.storageStat.used;
    val rent = independentStorageFee(used.bits, used.cells);

    testing.setNow(TEST_NOW + STORAGE_TEST_SECONDS);
    val paid = expectExternalAccepted(f, body, 2, small);
    val description = paid.tx.load().description.load();
    assert (description is TlbTransOrd) throw 700;
    expect(description.storagePh.unwrap().storageFeesCollected).toEqual(rent);
    val updated = testing.getAccountState(f.address)!.storageStat.used;
    expect(updated.cells).toBeLess(used.cells);
    expect(updated.bits).toBeLess(used.bits);
}

// Read emulator config18 directly instead of using the test VM's GETSTORAGEFEE.
// The fixture's current prices remain unchanged throughout the 24-hour interval.
fun independentStorageFee(bits: int, cells: int): coins {
    val prices = testing.getConfig().getStoragePrices().findKeyLessOrEqual(TEST_NOW).loadValue();
    return ((bits * prices.bitPrice + cells * prices.cellPrice) * STORAGE_TEST_SECONDS + 65535) /
        65536;
}

fun collectedStorageFee(trace: SendResultList, destination: address): coins {
    val tx = trace.findTransaction({ to: destination });
    expect(tx).toBeNotNull();
    val description = tx!.description.load();
    assert (description is TlbTransOrd) throw 700;
    return description.storagePh.unwrap().storageFeesCollected;
}

fun storageSnakePayload(): cell {
    var tail = createEmptyCell();
    var remaining = 32796; // 32 KiB plaintext plus nonce and authentication tag.
    while (remaining > 0) {
        val size = min(remaining, 127);
        var chunk = beginCell();
        repeat (size) {
            chunk.storeUint(0x7b, 8);
        }
        if (remaining != 32796) {
            chunk.storeRef(tail);
        }
        tail = chunk.endCell();
        remaining -= size;
    }
    return tail;
}
