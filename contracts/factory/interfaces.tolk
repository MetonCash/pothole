struct FactoryStorage {
    factoryId: uint64 = 0
    lastPotholeId: uint32 = 0
    owner: address
    publicKey: uint256
    potholeCode: cell
}

struct (0x78beff58) MintMessage {
    queryId: uint64
    publicKey: uint256
    expiration: uint32
}

type FactoryIncomingMessage = MintMessage
