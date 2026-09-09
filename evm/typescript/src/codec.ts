import { type Address, getAddress, type Hex, hexToBytes, padHex } from "viem";

export class SwigCodecError extends Error {
  override readonly name = "SwigCodecError";
}

export function uint64(value: bigint): void {
  if (typeof value !== "bigint" || value < 0n || value > 0xffffffffffffffffn) {
    throw new SwigCodecError("Expected an unsigned 64-bit integer");
  }
}

export function uint(value: number, maximum: number): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new SwigCodecError("Integer is outside its protocol range");
  }
}

export function bytes(value: Hex, length: number): Uint8Array {
  if (
    !/^0x(?:[0-9a-fA-F]{2})*$/.test(value) ||
    value.length !== 2 + length * 2
  ) {
    throw new SwigCodecError(`Expected exactly ${length} bytes`);
  }
  return hexToBytes(value);
}

export function addressWord(value: Address): Hex {
  return padHex(getAddress(value), { size: 32 });
}

export function readAddress(data: Uint8Array, offset: number): Address {
  const word = data.slice(offset, offset + 32);
  if (word.length !== 32 || word.slice(0, 12).some((byte) => byte !== 0)) {
    throw new SwigCodecError("Address must be canonically padded to 32 bytes");
  }
  let address = "0x";
  for (const byte of word.slice(12))
    address += byte.toString(16).padStart(2, "0");
  return getAddress(address);
}

export function readUint64(data: Uint8Array, offset: number): bigint {
  if (offset + 8 > data.length) throw new SwigCodecError("Truncated uint64");
  return new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength,
  ).getBigUint64(offset, true);
}

export function writeUint64(
  data: Uint8Array,
  offset: number,
  value: bigint,
): void {
  uint64(value);
  new DataView(data.buffer, data.byteOffset, data.byteLength).setBigUint64(
    offset,
    value,
    true,
  );
}
