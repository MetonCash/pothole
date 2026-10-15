const BASECHAIN_WC: int = 0
const CONTRACT_VERSION: (int, int, string) = (0, 1, ".0")

// Equal fee values are valid; enum members must have distinct values in Tolk.
const FACTORY_STORAGE_FEE: coins = grams("0.01")
const POTHOLE_STORAGE_FEE: coins = grams("0.01")

// message gas
enum FactoryGas: uint64 {
    MintPothole = 100000
}

enum PotholeGas: uint64 {
    InternalMintPothole = 100000
}
