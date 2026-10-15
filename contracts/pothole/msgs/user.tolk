import "@common/errors"
import "@common/utils"
import "@pothole/interfaces"
import "@pothole/storage"
import "@tolkbox/interfaces/Jetton"

fun closePotholeHandler(data: ClosePothole): void {
    val storage = PotholeStorage.load();
    val user = storage.user;
    assert (user != null) throw Errors.NotInitialized;
    user.throwIfNotSender();

    // Closing is available before confirmation and after expiration too.
    // The stored user receives the full remaining TON balance, less network fees.
    val withdrawalMessage = createMessage({
        bounce: BounceMode.NoBounce,
        value: 0,
        dest: user,
        body: JettonExcesses { queryId: data.queryId },
    });
    // SAFETY: only the stored user can drain to their own address. No reserve or
    // IGNORE_ERRORS: deletion occurs only when this full-balance send succeeds.
    withdrawalMessage.send(SEND_MODE_CARRY_ALL_BALANCE | SEND_MODE_DESTROY);
}
