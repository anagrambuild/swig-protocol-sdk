import {
  type Address,
  type ContractFunctionReturnType,
  encodeAbiParameters,
  getAddress,
  type Hex,
  zeroAddress,
  zeroHash,
} from "viem";
import type { swigConfigAbi } from "./abi.js";
import { addressWord, bytes, readAddress, SwigCodecError } from "./codec.js";

export const AuthorityKind = {
  None: 0,
  Ed25519: 1,
  Ed25519Session: 2,
  Secp256k1: 3,
  Secp256k1Session: 4,
  Secp256r1: 5,
  Secp256r1Session: 6,
  ProgramExec: 7,
  ProgramExecSession: 8,
} as const;

export type Authority =
  | { readonly type: "secp256k1"; readonly address: Address }
  | { readonly type: "secp256r1"; readonly x: Hex; readonly y: Hex }
  | {
      readonly type: "ed25519";
      readonly publicKey: Hex;
      readonly verifier: Address;
    }
  | { readonly type: "programExec"; readonly verifier: Address };

export type AuthorityData = ContractFunctionReturnType<
  typeof swigConfigAbi,
  "view",
  "getAuthority"
>;

function nonzeroWord(value: Hex): Hex {
  if (bytes(value, 32).every((byte) => byte === 0)) {
    throw new SwigCodecError("Authority key must be nonzero");
  }
  return value;
}

function nonzeroAddress(value: Address): Hex {
  if (getAddress(value) === zeroAddress)
    throw new SwigCodecError("Authority address must be nonzero");
  return addressWord(value);
}

export function encodeAuthority(authority: Authority): AuthorityData {
  switch (authority.type) {
    case "secp256k1":
      return {
        authorityType: AuthorityKind.Secp256k1,
        key: nonzeroAddress(authority.address),
        keyExtra: zeroHash,
      };
    case "secp256r1":
      return {
        authorityType: AuthorityKind.Secp256r1,
        key: nonzeroWord(authority.x),
        keyExtra: nonzeroWord(authority.y),
      };
    case "ed25519":
      return {
        authorityType: AuthorityKind.Ed25519,
        key: nonzeroWord(authority.publicKey),
        keyExtra: nonzeroAddress(authority.verifier),
      };
    case "programExec":
      return {
        authorityType: AuthorityKind.ProgramExec,
        key: nonzeroAddress(authority.verifier),
        keyExtra: `0x${"0".repeat(63)}1`,
      };
    default:
      throw new SwigCodecError("Unsupported authority type");
  }
}

export function decodeAuthority(data: AuthorityData): Authority {
  const key = bytes(data.key, 32);
  const extra = bytes(data.keyExtra, 32);
  let authority: Authority;
  switch (data.authorityType) {
    case AuthorityKind.Secp256k1:
      if (extra.some((byte) => byte !== 0))
        throw new SwigCodecError("Secp256k1 keyExtra must be zero");
      authority = { type: "secp256k1", address: readAddress(key, 0) };
      break;
    case AuthorityKind.Secp256r1:
      authority = { type: "secp256r1", x: data.key, y: data.keyExtra };
      break;
    case AuthorityKind.Ed25519:
      authority = {
        type: "ed25519",
        publicKey: data.key,
        verifier: readAddress(extra, 0),
      };
      break;
    case AuthorityKind.ProgramExec:
      if (BigInt(data.keyExtra) !== 1n)
        throw new SwigCodecError("Unsupported ProgramExec version");
      authority = { type: "programExec", verifier: readAddress(key, 0) };
      break;
    default:
      throw new SwigCodecError(
        `Unsupported authority discriminant: ${data.authorityType}`,
      );
  }
  encodeAuthority(authority);
  return authority;
}

/** Wrap an application-supplied proof in the current ProgramExec envelope. */
export function encodeProgramExecAuthorization(proof: Hex): Hex {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(proof))
    throw new SwigCodecError("Proof must be hex bytes");
  return encodeAbiParameters(
    [{ type: "uint32" }, { type: "bytes" }],
    [1, proof],
  );
}
