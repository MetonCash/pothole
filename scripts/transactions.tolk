import "@acton/emulation/network"
import "@acton/testing/assert"
import "@acton/types/transaction"

fun assertMessageStored(transaction: SendResult): void {
    val description = transaction.tx.load().description.load();
    if (description !is TlbTransOrd || description.aborted) {
        Assert.fail("External transaction failed; check the contract balance and current seqno");
    }
    val compute = description.computePh;
    if (compute !is TlbTrComputeVm || !compute.success || transaction.outMessages.size() != 0) {
        Assert.fail("The external message did not complete successfully without outgoing messages");
    }
}
