import "@acton/env"
import "@acton/fmt"
import "@acton/testing/assert"

fun scriptUint(name: string, maximum: int, fallback: int = 0): int {
    if (env<string>(name) == null) {
        return fallback;
    }
    val value = env<int>(name);
    if (value == null || value < 0 || value > maximum) {
        Assert.fail(format("{} must be an unsigned integer no greater than {}", name, maximum));
    }
    return value;
}

fun scriptPublicKey(name: string): int {
    val key = env<int>(name);
    if (
        key == null || key <= 0 ||
        key > 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
    ) {
        Assert.fail(
            format("Set {} to a nonzero uint256 Ed25519 public key (0x-prefixed hex)", name),
        );
    }
    return key;
}

fun scriptExpiration(): int {
    return scriptUint("POTHOLE_EXPIRATION", 0xffffffff);
}

fun scriptQueryId(): int {
    return scriptUint("POTHOLE_QUERY_ID", 0xffffffffffffffff);
}

fun scriptAddress(name: string, fallback: address, basechainOnly: bool = true): address {
    val value = env<string>(name) == null ? fallback : env<address>(name);
    if (value == null) {
        Assert.fail(format("{} must be a valid TON address", name));
    }
    if (basechainOnly && value.getWorkchain() != 0) {
        Assert.fail(format("{} must be a valid basechain address", name));
    }
    return value;
}
