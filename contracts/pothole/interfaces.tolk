struct PotholeStorage {
    potholeId: uint32
    factory: Cell<address>
    ownerPublicKey: uint256 = 0
    userPublicKey: uint256 = 0
    user: address? = null
    seqno: uint64 = 0
    lastMessage: cell? = null
    expiration: uint32 = 0
    // Assigned on initialization: Unix seconds (32 bits) followed by transaction LT (64 bits).
    deploymentId: uint96 = 0
}

@overflow1023_policy("suppress")
struct PotholeStorageRuntime {
    potholeId: uint32
    factory: address
    ownerPublicKey: uint256
    userPublicKey: uint256
    user: address?
    seqno: uint64
    lastMessage: cell?
    expiration: uint32
    deploymentId: uint96
}

fun PotholeStorage.initData(
    potholeId: uint32,
    factory: address,
): PotholeStorage {
    return PotholeStorage {
        potholeId,
        factory: factory.toCell(),
    };
}

struct (0x696e6974) InternalMintPothole {
    queryId: uint64
    ownerPublicKey: uint256
    userPublicKey: uint256
    user: address
    expiration: uint32
}

struct (0x706f7468) ExternalMessageData {
    destination: address
    deploymentId: uint96
    seqno: uint64
    validUntil: uint32
    sender: uint1 // 0 = owner (first confirmation), 1 = user.
    ciphertext: cell
}

struct ExternalMessage {
    signature: bits512
    message: Cell<ExternalMessageData>
}

// Only the initialized user may close and receive the remaining balance.
struct (0x636c6f73) ClosePothole {
    queryId: uint64 = 0
}

type PotholeIncomingMessage = InternalMintPothole | ClosePothole
