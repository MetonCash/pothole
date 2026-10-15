import "@pothole/interfaces"

fun PotholeStorage.load(): PotholeStorageRuntime {
    val st = PotholeStorage.fromCell(contract.getData());
    return PotholeStorageRuntime {
        potholeId: st.potholeId,
        factory: st.factory.load(),
        ownerPublicKey: st.ownerPublicKey,
        userPublicKey: st.userPublicKey,
        user: st.user,
        seqno: st.seqno,
        lastMessage: st.lastMessage,
        expiration: st.expiration,
        deploymentId: st.deploymentId,
    };
}

fun PotholeStorageRuntime.toStorage(self): PotholeStorage {
    return PotholeStorage {
        potholeId: self.potholeId,
        factory: self.factory.toCell(),
        ownerPublicKey: self.ownerPublicKey,
        userPublicKey: self.userPublicKey,
        user: self.user,
        seqno: self.seqno,
        lastMessage: self.lastMessage,
        expiration: self.expiration,
        deploymentId: self.deploymentId,
    };
}

fun PotholeStorage.save(st: PotholeStorageRuntime): void {
    contract.setData(st.toStorage().toCell());
}
