import "@common/errors"
import "@common/params"
import "@common/utils"
import "@factory/interfaces"
import "@factory/storage"
import "@pothole/interfaces"
import "@tolkbox/Utils"
import "@factory/msgs/any"

contract PotholeFactory {
    author: "@metoncash/pothole"
    version: "0.1.0"
    description: "A two-party, alternating encrypted messaging protocol"
    storage: FactoryStorage
    incomingMessages: FactoryIncomingMessage
}

fun onInternalMessage(inMsg: InMessage): void {
    inMsg.senderAddress.throwIfNotBasechain();

    val msg = lazy FactoryIncomingMessage.fromSlice(inMsg.body);

    match (msg) {
        MintMessage => {
            return mintHandler(MintMessage.fromSlice(inMsg.body));
        }
        else => {
            assert (inMsg.body.isEmpty()) throw Errors.WrongOp;
        }
    }
}

fun onExternalMessage(_inMsg: slice): void {
    throw Errors.WrongOp;
}

// Failed child deployments must not be interpreted as new mint requests.
fun onBouncedMessage(_inMsg: InMessageBounced): void {}

get fun getFactoryData(): FactoryStorage {
    return FactoryStorage.load();
}

get fun getPotholeAddress(
    potholeId: int,
): address {
    val storage: FactoryStorage = FactoryStorage.load();

    val pothole: PotholeStorage = PotholeStorage.initData(
        potholeId,
        contract.getAddress(),
    );

    return pothole.getAddress(storage.potholeCode);
}

get fun getVersion(): (int, int, string) {
    return CONTRACT_VERSION;
}
