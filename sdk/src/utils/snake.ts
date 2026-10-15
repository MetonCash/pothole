import { beginCell, Cell } from "@ton/core";

const BYTES_PER_CELL = 127;

/**
 * Store raw bytes without a comment/opcode prefix. Every non-tail cell contains
 * 127 bytes and one reference; empty data produces one empty ordinary cell.
 */
export function bufferToSnakeCell(data: Uint8Array): Cell {
  if (!(data instanceof Uint8Array)) {
    throw new TypeError("Snake data must be a Uint8Array or Buffer.");
  }
  const bytes = Buffer.from(data);
  const tailOffset = Math.floor(Math.max(bytes.length - 1, 0) / BYTES_PER_CELL) * BYTES_PER_CELL;
  let tail = beginCell().storeBuffer(bytes.subarray(tailOffset)).endCell();
  for (let offset = tailOffset - BYTES_PER_CELL; offset >= 0; offset -= BYTES_PER_CELL) {
    tail = beginCell()
      .storeBuffer(bytes.subarray(offset, offset + BYTES_PER_CELL))
      .storeRef(tail)
      .endCell();
  }
  return tail;
}

/**
 * Read raw snake bytes in order. Short chunks are accepted; exotic cells,
 * non-byte-aligned data, and branching references are rejected as non-snake data.
 */
export function snakeCellToBuffer(root: Cell): Buffer {
  if (!(root instanceof Cell)) {
    throw new TypeError("Snake root must be a Cell.");
  }
  const chunks: Buffer[] = [];
  let current = root;
  while (true) {
    if (current.isExotic) {
      throw new Error("Snake cells must be ordinary; exotic cells are not supported.");
    }
    const slice = current.beginParse();
    if (slice.remainingBits % 8 !== 0) {
      throw new Error("Snake cell data must be byte-aligned.");
    }
    if (slice.remainingRefs > 1) {
      throw new Error("Snake cells must have at most one reference.");
    }
    chunks.push(slice.loadBuffer(slice.remainingBits / 8));
    if (slice.remainingRefs === 0) {
      return Buffer.concat(chunks);
    }
    current = slice.loadRef();
  }
}
