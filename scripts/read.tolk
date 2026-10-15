import "@acton/env"
import "@acton/io"
import "@acton/testing/assert"
import "@wrappers/Pothole.gen"
import "message"

fun main() {
    val destination = env<address>("POTHOLE_ADDRESS");
    if (destination == null) {
        Assert.fail("Set POTHOLE_ADDRESS; use --fork-net testnet/mainnet to read the network");
    }
    val ciphertext = Pothole.fromAddress(destination).getPotholeData().lastMessage;
    if (ciphertext == null) {
        Assert.fail("No message has been posted yet");
    }
    // Default: raw leaf hex. POTHOLE_OUTPUT=boc prints serialized BoC hex instead.
    // The Acton runner may add its own logs around the payload line.
    println("{}", payloadToText(ciphertext));
}
