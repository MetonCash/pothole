import { beginCell, Cell } from "@ton/core";
import { bufferToSnakeCell, snakeCellToBuffer } from "../src/utils/snake";

describe("raw byte snake cells", () => {
  it.each([0, 1, 127, 128, 254, 32768])("round trips %i bytes with canonical 127-byte chunks and no prefix", (length) => {
    const bytes = Buffer.from(Array.from({ length }, (_, i) => (i * 31 + 73) % 256));
    const root = bufferToSnakeCell(bytes);
    expect(snakeCellToBuffer(root)).toEqual(bytes);
    expect(snakeCellToBuffer(Cell.fromBoc(root.toBoc())[0])).toEqual(bytes);

    let cell = root;
    let offset = 0;
    let cells = 0;
    while (true) {
      const slice = cell.beginParse();
      const chunkLength = Math.min(127, length - offset);
      expect(slice.remainingBits).toBe(chunkLength * 8);
      expect(slice.loadBuffer(chunkLength)).toEqual(bytes.subarray(offset, offset + chunkLength));
      offset += chunkLength;
      cells += 1;
      expect(slice.remainingRefs).toBe(offset < length ? 1 : 0);
      if (slice.remainingRefs === 0) break;
      cell = slice.loadRef();
    }
    expect(cells).toBe(Math.max(1, Math.ceil(length / 127)));
  });

  it("accepts Uint8Array views without including surrounding bytes or retaining mutable input", () => {
    const bytes = new Uint8Array([7, 0, 255, 128, 9]);
    const cell = bufferToSnakeCell(bytes.subarray(1, 4));
    bytes.fill(42);
    expect(snakeCellToBuffer(cell)).toEqual(Buffer.from([0, 255, 128]));
  });

  it("decodes short chunks and empty intermediate cells", () => {
    const tail = beginCell().storeBuffer(Buffer.from("world")).endCell();
    const middle = beginCell().storeRef(tail).endCell();
    const root = beginCell().storeBuffer(Buffer.from("hello ")).storeRef(middle).endCell();
    expect(snakeCellToBuffer(root).toString()).toBe("hello world");
  });

  it("rejects branching references and non-byte-aligned data at any depth", () => {
    const branch = beginCell().storeRef(Cell.EMPTY).storeRef(Cell.EMPTY).endCell();
    const unaligned = beginCell().storeUint(1, 1).endCell();
    for (const [invalid, message] of [[branch, "at most one reference"], [unaligned, "byte-aligned"]] as const) {
      expect(() => snakeCellToBuffer(invalid)).toThrow(message);
      expect(() => snakeCellToBuffer(beginCell().storeRef(invalid).endCell())).toThrow(message);
    }
  });

  it("rejects exotic cells as root or continuation", () => {
    const libraryRef = new Cell({
      exotic: true,
      bits: beginCell().storeUint(2, 8).storeBuffer(Buffer.alloc(32)).endCell().bits,
    });
    expect(() => snakeCellToBuffer(libraryRef)).toThrow("exotic");
    expect(() => snakeCellToBuffer(beginCell().storeRef(libraryRef).endCell())).toThrow("exotic");
  });

  it("rejects invalid input types", () => {
    expect(() => bufferToSnakeCell("data" as unknown as Uint8Array)).toThrow("Uint8Array or Buffer");
    expect(() => snakeCellToBuffer(null as unknown as Cell)).toThrow("root must be a Cell");
  });
});
