import "@acton/env"
import "@acton/io"
import "@acton/emulation/network"
import "@acton/emulation/scripts"
import "@acton/testing/assert"
import "@acton/testing/expect"
import "@acton/types/transaction"
import "@pothole/interfaces"
import "@wrappers/Pothole.gen"
import "configuration"

fun main() {
    if (!net.isBroadcasting()) {
        Assert.fail("Use --net testnet/mainnet with the stored user wallet");
    }
    val destination = env<address>("POTHOLE_ADDRESS");
    if (destination == null) {
        Assert.fail("Set POTHOLE_ADDRESS to the mailbox to close");
    }
    val wallet = scripts.wallet(env<string>("POTHOLE_WALLET") ?? "alice");
    val contract = Pothole.fromAddress(destination);
    val user = contract.getPotholeData().user;
    if (user == null || user != wallet.address) {
        Assert.fail("Only the stored user wallet can close this mailbox");
    }
    val queryId = scriptQueryId();
    val trace = contract
        .sendClosePothole(wallet.address, queryId, { value: grams("0.05"), bounce: true })
        .waitForTrace();
    if (trace == null) {
        Assert.fail("Close was submitted, but its transaction trace was not confirmed");
    }
    expect(trace).toHaveSuccessfulTx<ClosePothole>({ from: wallet.address, to: destination });
    val transaction = trace.findTransaction<ClosePothole>({ to: destination });
    if (transaction == null) {
        Assert.fail("Missing close transaction");
    }
    val description = transaction.description.load();
    if (description !is TlbTransOrd || !description.destroyed) {
        Assert.fail("The transaction completed, but the mailbox was not deleted");
    }
    println("Mailbox closed; remaining TON returned to {}", wallet.address);
}
