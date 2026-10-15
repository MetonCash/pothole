import "@acton/emulation/network"
import "@acton/testing/assert"
import "@pothole/interfaces"
import "@wrappers/Pothole.gen"

// Standalone deployment: the configured factory is the sending wallet. The
// participant keys, user and expiration arrive in its authenticated init.
fun Pothole.deployAndInitialize(
    self,
    from: address,
    data: InternalMintPothole,
    config: SendParams = {},
): SendResultList {
    if (self.stateInit == null) {
        Assert.fail("Cannot deploy without StateInit; use sendInternalMintPothole for an existing account");
    }
    val storage = PotholeStorage.fromCell(self.stateInit.data);
    if (
        storage.user != null || storage.ownerPublicKey != 0 || storage.userPublicKey != 0 ||
        storage.seqno != 0 ||
        storage.lastMessage != null ||
        storage.expiration != 0 ||
        storage.deploymentId != 0
    ) {
        Assert.fail("Use PotholeStorage.initData for an uninitialized deployment StateInit");
    }
    if (storage.factory.load() != from) {
        Assert.fail("Deployment sender must match the factory fixed in StateInit");
    }
    if (from.getWorkchain() != 0 || data.user.getWorkchain() != 0) {
        Assert.fail("The factory sender and user must have basechain addresses");
    }
    if (
        data.ownerPublicKey == 0 || data.userPublicKey == 0 ||
        data.ownerPublicKey == data.userPublicKey
    ) {
        Assert.fail("Owner and user must have distinct, nonzero public keys");
    }
    return net.send(
        from,
        createMessage({
            bounce: config.bounce,
            value: config.value,
            dest: {
                workchain: self.address.getWorkchain(),
                stateInit: self.stateInit,
                toShard: self.toShard,
            },
            body: data,
        }),
    );
}
