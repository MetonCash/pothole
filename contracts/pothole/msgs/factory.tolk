import "@common/errors"
import "@common/params"
import "@common/utils"
import "@pothole/interfaces"
import "@pothole/storage"
import "@tolkbox/Reserves"
import "@tolkbox/interfaces/Jetton"

fun internalMintPotholeHandler(data: InternalMintPothole): void {
    var storage: PotholeStorageRuntime = PotholeStorage.load();

    storage.factory.throwIfNotSender();
    assert (storage.user == null) throw Errors.AlreadyInitialized;
    data.user.throwIfNotBasechain();
    assert (
        data.ownerPublicKey != 0 && data.userPublicKey != 0 &&
        data.ownerPublicKey != data.userPublicKey
    ) throw Errors.InvalidParams;

    storage.user = data.user;
    storage.expiration = data.expiration;
    storage.ownerPublicKey = data.ownerPublicKey;
    storage.userPublicKey = data.userPublicKey;
    // Timestamp binds the lifetime; LT distinguishes initializations in the same second.
    // Empty predeployment cannot choose the identity of the initialized mailbox.
    storage.deploymentId = (blockchain.now() << 64) | blockchain.logicalTime();

    PotholeStorage.save(storage);

    val excessMessage: OutMessage = createMessage({
        bounce: BounceMode.NoBounce,
        value: 0,
        dest: data.user,
        body: JettonExcesses { queryId: data.queryId },
    });

    Reserves.maxBalance(POTHOLE_STORAGE_FEE);
    // SAFETY
    excessMessage.send(SEND_MODE_CARRY_ALL_BALANCE);

    return;
}
