import "@acton/build"
import "@acton/io"
import "@acton/emulation/network"
import "@acton/emulation/scripts"
import "@acton/testing/assert"
import "@acton/testing/expect"
import "@wrappers/PotholeFactory.gen"
import "configuration"

fun main() {
    val factoryId = scriptUint("POTHOLE_FACTORY_ID", 0xffffffffffffffff);
    val publicKey = scriptPublicKey("POTHOLE_OWNER_PUBLIC_KEY");
    val deployer = scripts.wallet("deployer");
    val owner = scriptAddress("POTHOLE_OWNER_ADDRESS", deployer.address, false);
    val factory = PotholeFactory.fromStorage({
        factoryId,
        owner,
        publicKey,
        potholeCode: build("Pothole"),
    });
    val trace = factory.deploy(deployer.address, { value: grams("0.1") }).waitForTrace();
    if (trace == null) {
        Assert.fail("Factory deployment transaction was not confirmed");
    }
    expect(trace).toHaveSuccessfulDeploy({ to: factory.address });
    println("POTHOLE_FACTORY_ADDRESS={}", factory.address);
    println(
        "Factory owner: {}; next pothole id: {}",
        owner,
        factory.getFactoryData().lastPotholeId,
    );
}
