import { Address, Sender } from "@ton/core";

export function requireBasechain(address: Address, name: string): void {
  if (address.workChain !== 0) {
    throw new RangeError(`${name} must be in the basechain (workchain 0).`);
  }
}

export function requireBasechainSender(sender: Sender): void {
  if (sender.address !== undefined) {
    requireBasechain(sender.address, "sender");
  }
}

export function requireUint(value: bigint, bits: number, name: string): void {
  if (typeof value !== "bigint" || value < 0n || value >= (1n << BigInt(bits))) {
    throw new RangeError(`${name} must be an unsigned ${bits}-bit bigint.`);
  }
}

export function requirePublicKey(publicKey: bigint, name: string): void {
  requireUint(publicKey, 256, name);
  if (publicKey === 0n) {
    throw new RangeError(`${name} must be nonzero.`);
  }
}

export function requireParticipants(ownerPublicKey: bigint, userPublicKey: bigint): void {
  requirePublicKey(ownerPublicKey, "ownerPublicKey");
  requirePublicKey(userPublicKey, "userPublicKey");
  if (ownerPublicKey === userPublicKey) {
    throw new RangeError("Owner and user public keys must be distinct.");
  }
}
