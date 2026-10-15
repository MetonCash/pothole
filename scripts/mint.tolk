import "@acton/env"
import "@acton/io"
import "@acton/emulation/network"
import "@acton/emulation/scripts"
import "@acton/testing/assert"
import "@acton/testing/expect"
import "@acton/types/message"
import "@acton/types/transaction"
import "@factory/interfaces"
import "@pothole/interfaces"
import "@wrappers/Pothole.gen"
import "@wrappers/PotholeFactory.gen"
import "configuration"

fun main() {
    if (!net.isBroadcasting()) {
        Assert.fail("Use --net testnet/mainnet with an existing factory");
    }
    val factoryAddress = env<address>("POTHOLE_FACTORY_ADDRESS");
    if (factoryAddress == null) {
        Assert.fail("Set POTHOLE_FACTORY_ADDRESS to the deployed factory address");
    }
    val publicKey = scriptPublicKey("POTHOLE_USER_PUBLIC_KEY");
    val expiration = scriptExpiration();
    val queryId = scriptQueryId();
    val value = scriptUint("POTHOLE_MINT_VALUE", 0xffffffffffffffffffffffffffffff, grams("0.2"));
    if (value == 0) {
        Assert.fail("POTHOLE_MINT_VALUE must be positive integer nanotons covering the factory's dynamic gas guard");
    }
    val wallet = scripts.wallet(env<string>("POTHOLE_WALLET") ?? "alice");
    val factory = PotholeFactory.fromAddress(factoryAddress);
    val factoryData = factory.getFactoryData();
    if (publicKey == factoryData.publicKey) {
        Assert.fail("The user public key must differ from the factory owner's public key");
    }
    val trace = factory
        .sendMintMessage(wallet.address, queryId, publicKey, expiration, { value, bounce: true })
        .waitForTrace();
    if (trace == null) {
        Assert.fail("Mint was submitted, but its complete transaction trace was not confirmed");
    }
    expect(trace).toHaveSuccessfulTx<MintMessage>({ from: wallet.address, to: factory.address });
    // Discover the actual allocation in our trace: concurrent mints can advance
    // lastPotholeId between a preflight getter and the submitted request.
    val childTransaction = trace.findTransaction<InternalMintPothole>({ from: factory.address });
    if (childTransaction == null) {
        Assert.fail("The mint trace contains no child initialization transaction");
    }
    val childMessage = childTransaction.loadInMsg<InternalMintPothole>();
    val info = childMessage.info;
    if (info !is TlbInternalMessage) {
        Assert.fail("The child initialization was not an internal message");
    }
    val child = Pothole.fromAddress(info.dest);
    // Anyone may predeploy the canonical, still-uninitialized StateInit. The
    // authenticated factory initialization is the success criterion either way.
    expect(
        trace,
    ).toHaveSuccessfulTx<InternalMintPothole>({ from: factory.address, to: child.address });
    val data = child.getPotholeData();
    expect(data.factory).toEqual(factory.address);
    expect(data.ownerPublicKey).toEqual(factoryData.publicKey);
    expect(data.user).toEqual(wallet.address);
    expect(data.userPublicKey).toEqual(publicKey);
    expect(data.expiration).toEqual(expiration);
    expect(child.address).toEqual(factory.getPotholeAddress(data.potholeId));
    println("POTHOLE_ADDRESS={}", child.address);
    println("Pothole id: {}; user wallet: {}", data.potholeId, wallet.address);
    println("Expiration: {} (UNIX seconds; 0 = never)", data.expiration);
    println("Next seqno: {}; owner confirms first", data.seqno);
}
