import { describe, expect, test } from "bun:test";
import {
  bytesToHex,
  decodeAbiParameters,
  type Hex,
  zeroAddress,
  zeroHash,
} from "viem";
import authorityVectors from "../../fixtures/authorities.json" with {
  type: "json",
};
import permissionVectors from "../../fixtures/permissions.json" with {
  type: "json",
};
import {
  AuthorityKind,
  createRecurringLimit,
  decodeAuthority,
  decodePermission,
  decodeRole,
  encodeAuthority,
  encodePermission,
  encodeProgramExecAuthorization,
  PermissionKind,
  SwigCodecError,
} from "../src/index.js";

function hex(value: string): Hex {
  if (!value.startsWith("0x")) throw new Error("Fixture is not hex");
  return `0x${value.slice(2)}`;
}

describe("shared permission vectors", () => {
  for (const vector of permissionVectors) {
    test(vector.name, () => {
      const action = { permission: vector.permission, data: hex(vector.data) };
      const permission = decodePermission(action);
      const decoded: unknown = JSON.parse(
        JSON.stringify(permission, (_key, value: unknown) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      );
      expect(decoded).toEqual(vector.decoded);
      expect(encodePermission(permission)).toEqual(action);
    });
  }

  test("initializes fresh recurring state without changing decoded state", () => {
    expect(createRecurringLimit(100n, 30n)).toEqual({
      recurringAmount: 100n,
      window: 30n,
      lastReset: 0n,
      currentAmount: 100n,
    });
  });

  test("rejects malformed lengths, unsupported permissions, padding, and amounts", () => {
    expect(() => decodePermission({ permission: 7, data: "0x00" })).toThrow(
      SwigCodecError,
    );
    expect(() => decodePermission({ permission: 1, data: "0x01" })).toThrow(
      SwigCodecError,
    );
    expect(() =>
      decodePermission({
        permission: PermissionKind.ProgramScope,
        data: bytesToHex(new Uint8Array(144)),
      }),
    ).toThrow("Unsupported permission discriminant");
    expect(() => decodePermission({ permission: 255, data: "0x" })).toThrow(
      "Unsupported permission discriminant",
    );
    expect(() =>
      decodePermission({ permission: 3, data: `0x01${"00".repeat(31)}` }),
    ).toThrow("canonically padded");
    expect(() =>
      encodePermission({ type: "nativeLimit", amount: -1n }),
    ).toThrow(SwigCodecError);
    expect(() =>
      encodePermission({ type: "nativeLimit", amount: 1n << 64n }),
    ).toThrow(SwigCodecError);
    expect(() => createRecurringLimit(100n, 0n)).toThrow(SwigCodecError);
    expect(() =>
      encodePermission({
        type: "nativeRecurringLimit",
        limit: {
          recurringAmount: 1n,
          window: 1n,
          lastReset: 0n,
          currentAmount: 2n,
        },
      }),
    ).toThrow(SwigCodecError);
  });
});

describe("shared authority vectors", () => {
  for (const vector of authorityVectors) {
    test(vector.name, () => {
      const data = {
        authorityType: vector.authorityType,
        key: hex(vector.key),
        keyExtra: hex(vector.keyExtra),
      };
      const decoded: unknown = decodeAuthority(data);
      expect(decoded).toEqual(vector.decoded);
      expect(encodeAuthority(decodeAuthority(data))).toEqual(data);
    });
  }

  test("rejects unsupported sessions and malformed authority state", () => {
    for (const authorityType of [0, 2, 4, 6, 8, 255]) {
      expect(() =>
        decodeAuthority({ authorityType, key: zeroHash, keyExtra: zeroHash }),
      ).toThrow("Unsupported authority discriminant");
    }
    expect(() =>
      encodeAuthority({ type: "secp256k1", address: zeroAddress }),
    ).toThrow(SwigCodecError);
    expect(() =>
      encodeAuthority({ type: "secp256r1", x: "0x01", y: zeroHash }),
    ).toThrow(SwigCodecError);
    expect(() =>
      decodeAuthority({
        authorityType: 3,
        key: zeroHash,
        keyExtra: `0x${"00".repeat(31)}01`,
      }),
    ).toThrow(SwigCodecError);
    expect(() =>
      decodeAuthority({
        authorityType: 7,
        key: `0x${"00".repeat(31)}01`,
        keyExtra: zeroHash,
      }),
    ).toThrow("Unsupported ProgramExec version");
    expect(() =>
      decodeAuthority({
        authorityType: 3,
        key: `0x01${"00".repeat(31)}`,
        keyExtra: zeroHash,
      }),
    ).toThrow("canonically padded");
  });

  test("wraps ProgramExec proof with the exact v1 ABI envelope", () => {
    const encoded = encodeProgramExecAuthorization("0x123456");
    expect(
      decodeAbiParameters([{ type: "uint32" }, { type: "bytes" }], encoded),
    ).toEqual([1, "0x123456"]);
    expect(encoded).toBe(
      `0x${"0".repeat(63)}1${"0".repeat(62)}40${"0".repeat(63)}3123456${"0".repeat(58)}`,
    );
    expect(() => encodeProgramExecAuthorization("0x1")).toThrow(SwigCodecError);
  });

  test("decodes a role without additional network reads", () => {
    const authority = encodeAuthority({
      type: "secp256k1",
      address: "0x1111111111111111111111111111111111111111",
    });
    expect(authority.authorityType).toBe(AuthorityKind.Secp256k1);
    expect(decodeRole({ id: 7, authority, actionCount: 2 })).toEqual({
      id: 7,
      authority: {
        type: "secp256k1",
        address: "0x1111111111111111111111111111111111111111",
      },
      actionCount: 2,
    });
    expect(() => decodeRole({ id: -1, authority, actionCount: 2 })).toThrow(
      SwigCodecError,
    );
  });
});
