import "@stdlib/gas-payments"
import "@common/errors"
import "@common/params"
import "@tolkbox/Ctx"

fun address.throwIfNotBasechain(self): void {
    assert(self.getWorkchain() == BASECHAIN_WC, Errors.InvalidWorkchain);
}

fun address.throwIfNotSender(self): void {
    assert(Ctx.senderAddress() == self, Errors.WrongSender);
}

fun throwIfNotEnoughGas(msgCount: int, requiredRawTon: coins, requiredGasUnits: uint256): void {
    assert (
        Ctx.msgValue() >
        (mulDivCeil(Ctx.msgFwdFee(), 3, 2) * msgCount) + requiredRawTon +
        calculateGasFeeWithoutFlatPrice(
            BASECHAIN_WC,
            requiredGasUnits,
        )
    ) throw Errors.NotEnoughGas;
}
