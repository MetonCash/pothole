import { Address, beginCell, Cell } from "@ton/core";
import { sign } from "@ton/crypto";
import { ExternalMessageData } from "./wrappers/Pothole.gen";
import { requireUint } from "./utils/validation";

export interface MessageParams {
  destination: Address;
  /** uint96 deployment identity from getPotholeData(); binds signatures to this initialization. */
  deploymentId: bigint;
  seqno: bigint;
  /** Absolute Unix timestamp in seconds, exclusive. */
  validUntil: bigint;
  /** Owner = 0, user = 1. The owner sends seqno 0 to confirm the channel. */
  sender: 0 | 1;
  /** Opaque arbitrary root cell; use bufferToSnakeCell for byte payloads. */
  ciphertext: Cell;
}

export function createMessageToSign(params: MessageParams): Cell {
  requireUint(params.deploymentId, 96, "deploymentId");
  requireUint(params.seqno, 64, "seqno");
  requireUint(params.validUntil, 32, "validUntil");
  if (params.sender !== 0 && params.sender !== 1) {
    throw new RangeError("sender must be 0 (owner) or 1 (user).");
  }
  return ExternalMessageData.toCell(ExternalMessageData.create({
    ...params,
    sender: BigInt(params.sender),
  }));
}

/** Sign the complete request root hash, including its referenced payload DAG. */
export function signMessage(params: MessageParams, secretKey: Buffer): Cell {
  if (!Buffer.isBuffer(secretKey) || secretKey.length !== 64) {
    throw new TypeError("secretKey must be a 64-byte Ed25519 secret key; use keyPairFromSeed for a 32-byte seed.");
  }
  const root = createMessageToSign(params);
  return beginCell().storeBuffer(sign(root.hash(), secretKey)).storeRef(root).endCell();
}

/** Convert an Ed25519 public key to the uint256 expected by the contracts. */
export function publicKeyToBigInt(publicKey: Uint8Array): bigint {
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== 32) {
    throw new TypeError("publicKey must contain exactly 32 bytes.");
  }
  return BigInt(`0x${Buffer.from(publicKey).toString("hex")}`);
}
