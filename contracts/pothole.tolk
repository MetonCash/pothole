import "@stdlib/gas-payments"
import "@common/errors"
import "@common/utils"
import "@pothole/interfaces"
import "@pothole/storage"
import "@pothole/msgs/factory"
import "@pothole/msgs/user"

contract Pothole {
    author: "@metoncash/pothole"
    version: "0.1.0"
    description: "A two-party, alternating encrypted messaging protocol"
    storage: PotholeStorage
    incomingMessages: PotholeIncomingMessage
    incomingExternal: ExternalMessage
}

fun onExternalMessage(inMsg: slice) {
    // Eager decoding checks the entire envelope and signed request before ACCEPT.
    val envelope = ExternalMessage.fromSlice(inMsg);
    val msg: ExternalMessageData = envelope.message.load();
    var storage: PotholeStorageRuntime = PotholeStorage.load();

    assert (storage.user != null) throw Errors.NotInitialized;
    assert (storage.expiration == 0 || blockchain.now() < storage.expiration) throw Errors.Expired;
    assert (msg.destination == contract.getAddress()) throw Errors.WrongSender;
    assert (msg.deploymentId == storage.deploymentId) throw Errors.InvalidDeploymentId;
    assert (msg.validUntil > blockchain.now()) throw Errors.Expired;
    assert (msg.seqno == storage.seqno) throw Errors.InvalidSeqno;
    assert (storage.seqno < 0xFFFFFFFFFFFFFFFF) throw Errors.InvalidSeqno;
    assert (msg.sender == (storage.seqno & 1)) throw Errors.WrongTurn;
    assert (
        storage.userPublicKey != 0 && storage.ownerPublicKey != 0 &&
        storage.ownerPublicKey != storage.userPublicKey
    ) throw Errors.InvalidParams;

    // The request root hash commits to the deployment identity, all request fields
    // and the entire referenced payload DAG.
    // Keep the payload opaque: arbitrary bits and references, with no application format.
    // The owner's first signed message confirms the mailbox. Until then, seqno
    // remains zero and the user cannot publish; subsequent turns alternate.
    val publicKey = msg.sender == 0 ? storage.ownerPublicKey : storage.userPublicKey;
    assert (
        isSignatureValid(envelope.message.hash(), envelope.signature as slice, publicKey)
    ) throw Errors.InvalidSignature;

    // Serialize before accepting too: no fallible parsing/validation after ACCEPT.
    storage.seqno += 1;
    storage.lastMessage = msg.ciphertext;
    val nextData: Cell<PotholeStorage> = storage.toStorage().toCell();
    acceptExternalMessage();
    contract.setData(nextData);
}

fun onInternalMessage(inMsg: InMessage): void {
    inMsg.senderAddress.throwIfNotBasechain();

    val msg = lazy PotholeIncomingMessage.fromSlice(inMsg.body);

    match (msg) {
        InternalMintPothole => {
            return internalMintPotholeHandler(InternalMintPothole.fromSlice(inMsg.body));
        }
        ClosePothole => {
            // Eager decoding rejects truncated or trailing data before any send.
            return closePotholeHandler(ClosePothole.fromSlice(inMsg.body));
        }
        else => {
            assert (inMsg.body.isEmpty()) throw Errors.WrongOp;
        }
    }
}

fun onBouncedMessage(_inMsg: InMessageBounced): void {}

get fun getPotholeData(): PotholeStorageRuntime {
    return PotholeStorage.load();
}
