import "@acton/env"
import "@acton/io"
import "@acton/emulation/network"
import "@acton/emulation/scripts"
import "@acton/testing/assert"
import "@pothole/interfaces"
import "@wrappers/Pothole.gen"
import "message"
import "transactions"

fun main() {
    if (!net.isBroadcasting()) {
        Assert.fail("Use --net testnet/mainnet with a configured signing wallet");
    }
    val destination = env<address>("POTHOLE_ADDRESS");
    val ciphertext = payloadFromEnvironment();
    if (destination == null || ciphertext == null) {
        Assert.fail("Set POTHOLE_ADDRESS and one of POTHOLE_PAYLOAD_BOC or POTHOLE_CIPHERTEXT");
    }
    val contract = Pothole.fromAddress(destination);
    val wallet = scripts.wallet(env<string>("POTHOLE_WALLET") ?? "alice");
    val data = contract.getPotholeData();
    if (data.user == null) {
        Assert.fail("The mailbox has not been initialized");
    }
    val seqno = data.seqno;
    val sender = seqno & 1;
    if (wallet.publicKey() != (sender == 0 ? data.ownerPublicKey : data.userPublicKey)) {
        Assert.fail("The selected wallet is not the participant whose turn it is (0 = owner, 1 = user)");
    }
    val request = ExternalMessageData {
        destination,
        deploymentId: data.deploymentId,
        seqno,
        // Acton initializes script time from the wall clock; expires after five minutes.
        validUntil: blockchain.now() + 300,
        sender,
        ciphertext,
    };
    val root = request.toCell();
    val signature = wallet.rawSign(root.hash()) as bits512;
    val body = ExternalMessage {
        signature,
        message: root,
    };
    val res = contract.sendAnyExternal(body.toCell());
    val transaction = res.waitForFirstTransaction();
    if (transaction == null) {
        Assert.fail("External message was submitted, but its transaction was not confirmed");
    }
    assertMessageStored(transaction);
    println("Message seqno {} confirmed. Next seqno: {}", seqno, contract.getPotholeData().seqno);
}
