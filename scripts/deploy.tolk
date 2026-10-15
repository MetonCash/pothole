import "@acton/io"
import "@acton/emulation/network"
import "@acton/emulation/scripts"
import "@acton/testing/assert"
import "@acton/testing/expect"
import "@pothole/interfaces"
import "@wrappers/Pothole"
import "@wrappers/Pothole.gen"
import "configuration"

fun main() {
    // Public configuration is mandatory in emulation too.
    val ownerPublicKey = scriptPublicKey("POTHOLE_OWNER_PUBLIC_KEY");
    val userPublicKey = scriptPublicKey("POTHOLE_USER_PUBLIC_KEY");
    if (ownerPublicKey == userPublicKey) {
        Assert.fail("POTHOLE_OWNER_PUBLIC_KEY and POTHOLE_USER_PUBLIC_KEY must be different");
    }
    val expiration = scriptExpiration();
    val deployer = scripts.wallet("deployer");
    val user = scriptAddress("POTHOLE_USER_ADDRESS", deployer.address);
    val potholeId = scriptUint("POTHOLE_ID", 0xffffffff);
    val contract = Pothole.fromStorage(PotholeStorage.initData(potholeId, deployer.address));
    val deployment = contract.deployAndInitialize(
        deployer.address,
        {
            queryId: scriptQueryId(),
            ownerPublicKey,
            userPublicKey,
            user,
            expiration,
        },
        { value: grams("0.1") },
    );
    val trace = deployment.waitForTrace();
    if (trace == null) {
        Assert.fail("Deployment transaction was not confirmed");
    }
    // The empty StateInit may already have been deployed by another sender.
    expect(trace).toHaveSuccessfulTx<InternalMintPothole>({
        from: deployer.address,
        to: contract.address,
    });
    val data = contract.getPotholeData();
    expect(data.user).toEqual(user);
    expect(data.ownerPublicKey).toEqual(ownerPublicKey);
    expect(data.userPublicKey).toEqual(userPublicKey);
    expect(data.expiration).toEqual(expiration);
    println("POTHOLE_ADDRESS={}", contract.address);
    println("Pothole id: {}; user wallet: {}", data.potholeId, user);
    println("Expiration: {} (UNIX seconds; 0 = never)", data.expiration);
    println("Next seqno: {}; owner confirms first", data.seqno);
}
