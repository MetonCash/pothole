import "@stdlib/strings"
import "@acton/boc"
import "@acton/env"
import "@acton/testing/assert"

// Presence and decoding are separate: malformed BoC input must not select a fallback.
fun payloadFromEnvironment(): cell? {
    val encodedBoc = env<string>("POTHOLE_PAYLOAD_BOC");
    val ciphertextHex = env<string>("POTHOLE_CIPHERTEXT");
    if (encodedBoc != null && ciphertextHex != null) {
        Assert.fail("Set only one of POTHOLE_PAYLOAD_BOC or POTHOLE_CIPHERTEXT");
    }
    if (encodedBoc != null) {
        val payload = env<cell>("POTHOLE_PAYLOAD_BOC");
        if (payload == null) {
            Assert.fail("POTHOLE_PAYLOAD_BOC must be a valid single-root BoC encoded as hex or base64");
        }
        return payload;
    }
    return ciphertextHex == null ? null : ciphertextFromHex(ciphertextHex);
}

// env<slice> contains ASCII, not decoded hexadecimal. Strings may span snake cells.
fun loadHexDigit(mutate source: slice): int {
    while (source.remainingBitsCount() == 0) {
        source = source.loadRef().beginParse();
    }
    val c = source.loadUint(8);
    if (c >= 48 && c <= 57) {
        return c - 48;
    }
    if (c >= 65 && c <= 70) {
        return c - 55;
    }
    if (c >= 97 && c <= 102) {
        return c - 87;
    }
    Assert.fail("POTHOLE_CIPHERTEXT must contain hexadecimal digits only, without 0x or whitespace");
}

fun ciphertextFromHex(hex: string): cell {
    val length = hex.calculateLength();
    if (length < 56 || length > 254 || length % 2 != 0) {
        Assert.fail("POTHOLE_CIPHERTEXT must encode 28..127 bytes: nonce(12) || tag(16) || ciphertext(0..99)");
    }
    var source = hex.beginParse();
    var output = beginCell();
    repeat (length / 2) {
        val high = loadHexDigit(mutate source);
        val low = loadHexDigit(mutate source);
        output.storeUint(high * 16 + low, 8);
    }
    source.assertEnd();
    return output.endCell();
}

fun ciphertextToHex(data: cell): string {
    val source = data.beginParse();
    if (source.remainingRefsCount() != 0 || source.remainingBitsCount() % 8 != 0) {
        Assert.fail("Hex output requires a byte-aligned leaf cell; set POTHOLE_OUTPUT=boc for arbitrary payloads");
    }
    return snakeBytesToHex(source);
}

// Serialize raw BoC bytes too, including byte snakes larger than a single cell.
fun snakeBytesToHex(bytes: slice): string {
    var source = bytes;
    var output = StringBuilder.create().append("");
    var chunk = beginCell();
    while (true) {
        repeat (source.remainingBitsCount() / 8) {
            val byte = source.loadUint(8);
            val high = byte >> 4;
            val low = byte & 15;
            chunk.storeUint(high < 10 ? high + 48 : high + 87, 8);
            chunk.storeUint(low < 10 ? low + 48 : low + 87, 8);
            if (chunk.bitsCount() == 1008) {
                output.append(chunk.endCell() as unknown as string);
                chunk = beginCell();
            }
        }
        if (source.remainingRefsCount() == 0) {
            break;
        }
        source = source.loadRef().beginParse();
    }
    if (chunk.bitsCount() != 0) {
        output.append(chunk.endCell() as unknown as string);
    }
    return output.build();
}

fun payloadToText(payload: cell): string {
    val format = env<string>("POTHOLE_OUTPUT") ?? "hex";
    if (format.equalTo("boc")) {
        return snakeBytesToHex(boc.encode(payload));
    }
    if (format.equalTo("hex")) {
        return ciphertextToHex(payload);
    }
    Assert.fail("POTHOLE_OUTPUT must be hex (raw leaf bytes) or boc (serialized BoC hex)");
}
