import "@common/errors"
import "@common/params"
import "@common/utils"
import "@factory/interfaces"
import "@factory/storage"
import "@pothole/interfaces"
import "@tolkbox/Ctx"
import "@tolkbox/Reserves"
import "@tolkbox/Utils"

fun mintHandler(data: MintMessage): void {
    var storage: FactoryStorage = lazy FactoryStorage.load();

    throwIfNotEnoughGas(
        4,
        FACTORY_STORAGE_FEE + POTHOLE_STORAGE_FEE,
        (FactoryGas.MintPothole as int) + (PotholeGas.InternalMintPothole as int),
    );
    assert (data.expiration == 0 || blockchain.now() < data.expiration) throw Errors.Expired;
    assert (
        storage.publicKey != 0 && data.publicKey != 0 && storage.publicKey != data.publicKey
    ) throw Errors.InvalidParams;
    assert (storage.lastPotholeId < 0xffffffff) throw Errors.InvalidOperation;

    val pothole: PotholeStorage = PotholeStorage.initData(
        storage.lastPotholeId,
        contract.getAddress(),
    );

    storage.lastPotholeId += 1;

    FactoryStorage.save(storage);

    val internalMintPotholeMsg: OutMessage = createMessage({
        dest: pothole.getAutoDeployAddress(storage.potholeCode),
        value: 0,
        bounce: BounceMode.Only256BitsOfBody,
        body: InternalMintPothole {
            queryId: data.queryId,
            ownerPublicKey: storage.publicKey,
            userPublicKey: data.publicKey,
            user: Ctx.senderAddress(),
            expiration: data.expiration,
        },
    });

    Reserves.maxBalance(FACTORY_STORAGE_FEE);
    // SAFETY
    internalMintPotholeMsg.send(SEND_MODE_CARRY_ALL_BALANCE);

    return;
}
