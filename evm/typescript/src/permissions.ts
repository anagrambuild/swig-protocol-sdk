import {
  type Address,
  bytesToHex,
  type ContractFunctionReturnType,
} from "viem";
import type { swigConfigAbi } from "./abi.js";
import {
  addressWord,
  bytes,
  readAddress,
  readUint64,
  SwigCodecError,
  uint64,
  writeUint64,
} from "./codec.js";

/** Canonical wire discriminants; not every enum value has EVM enforcement. */
export const PermissionKind = {
  None: 0,
  SolLimit: 1,
  SolRecurringLimit: 2,
  Program: 3,
  ProgramScope: 4,
  TokenLimit: 5,
  TokenRecurringLimit: 6,
  All: 7,
  ManageAuthority: 8,
  SubAccount: 9,
  StakeLimit: 10,
  StakeRecurringLimit: 11,
  StakeAll: 12,
  ProgramAll: 13,
  ProgramCurated: 14,
  AllButManageAuthority: 15,
  SolDestinationLimit: 16,
  SolRecurringDestinationLimit: 17,
  TokenDestinationLimit: 18,
  TokenRecurringDestinationLimit: 19,
  CloseSwigAuthority: 20,
  RecoveryAuthority: 21,
} as const;

export type ActionData = ContractFunctionReturnType<
  typeof swigConfigAbi,
  "view",
  "getAction"
>;

/** The full stored state, in base units and timestamp seconds. */
export interface RecurringLimit {
  readonly recurringAmount: bigint;
  readonly window: bigint;
  readonly lastReset: bigint;
  readonly currentAmount: bigint;
}

/** Permissions with enforcement in the pinned EVM contract version. */
export type Permission =
  | {
      readonly type:
        | "all"
        | "manageAuthority"
        | "allButManageAuthority"
        | "programAll";
    }
  | { readonly type: "program"; readonly target: Address }
  | { readonly type: "nativeLimit"; readonly amount: bigint }
  | { readonly type: "nativeRecurringLimit"; readonly limit: RecurringLimit }
  | {
      readonly type: "nativeDestinationLimit";
      readonly destination: Address;
      readonly amount: bigint;
    }
  | {
      readonly type: "nativeRecurringDestinationLimit";
      readonly destination: Address;
      readonly limit: RecurringLimit;
    }
  | {
      readonly type: "tokenLimit";
      readonly token: Address;
      readonly amount: bigint;
    }
  | {
      readonly type: "tokenRecurringLimit";
      readonly token: Address;
      readonly limit: RecurringLimit;
    }
  | {
      readonly type: "tokenDestinationLimit";
      readonly token: Address;
      readonly destination: Address;
      readonly amount: bigint;
    }
  | {
      readonly type: "tokenRecurringDestinationLimit";
      readonly token: Address;
      readonly destination: Address;
      readonly limit: RecurringLimit;
    };

function validateRecurring(limit: RecurringLimit): void {
  for (const value of [
    limit.recurringAmount,
    limit.window,
    limit.lastReset,
    limit.currentAmount,
  ])
    uint64(value);
  if (limit.window === 0n || limit.currentAmount > limit.recurringAmount) {
    throw new SwigCodecError(
      "Recurring window must be positive and currentAmount cannot exceed recurringAmount",
    );
  }
}

/** Initial state for adding a recurring permission. Stored state decodes separately. */
export function createRecurringLimit(
  recurringAmount: bigint,
  window: bigint,
): RecurringLimit {
  const limit = {
    recurringAmount,
    window,
    lastReset: 0n,
    currentAmount: recurringAmount,
  };
  validateRecurring(limit);
  return limit;
}

function writeRecurring(
  data: Uint8Array,
  offset: number,
  limit: RecurringLimit,
): void {
  validateRecurring(limit);
  writeUint64(data, offset, limit.recurringAmount);
  writeUint64(data, offset + 8, limit.window);
  writeUint64(data, offset + 16, limit.lastReset);
  writeUint64(data, offset + 24, limit.currentAmount);
}

function readRecurring(data: Uint8Array, offset: number): RecurringLimit {
  const limit = {
    recurringAmount: readUint64(data, offset),
    window: readUint64(data, offset + 8),
    lastReset: readUint64(data, offset + 16),
    currentAmount: readUint64(data, offset + 24),
  };
  validateRecurring(limit);
  return limit;
}

/** Encode exact state; use createRecurringLimit for fresh role permissions. */
export function encodePermission(permission: Permission): ActionData {
  let kind: number;
  let data: Uint8Array;
  switch (permission.type) {
    case "all":
      return { permission: PermissionKind.All, data: "0x" };
    case "manageAuthority":
      return { permission: PermissionKind.ManageAuthority, data: "0x" };
    case "allButManageAuthority":
      return { permission: PermissionKind.AllButManageAuthority, data: "0x" };
    case "programAll":
      return { permission: PermissionKind.ProgramAll, data: "0x" };
    case "program":
      return {
        permission: PermissionKind.Program,
        data: addressWord(permission.target),
      };
    case "nativeLimit":
      kind = PermissionKind.SolLimit;
      data = new Uint8Array(8);
      writeUint64(data, 0, permission.amount);
      break;
    case "nativeRecurringLimit":
      kind = PermissionKind.SolRecurringLimit;
      data = new Uint8Array(32);
      writeRecurring(data, 0, permission.limit);
      break;
    case "nativeDestinationLimit":
      kind = PermissionKind.SolDestinationLimit;
      data = new Uint8Array(40);
      data.set(bytes(addressWord(permission.destination), 32));
      writeUint64(data, 32, permission.amount);
      break;
    case "nativeRecurringDestinationLimit":
      kind = PermissionKind.SolRecurringDestinationLimit;
      data = new Uint8Array(64);
      data.set(bytes(addressWord(permission.destination), 32));
      writeRecurring(data, 32, permission.limit);
      break;
    case "tokenLimit":
      kind = PermissionKind.TokenLimit;
      data = new Uint8Array(40);
      data.set(bytes(addressWord(permission.token), 32));
      writeUint64(data, 32, permission.amount);
      break;
    case "tokenRecurringLimit":
      kind = PermissionKind.TokenRecurringLimit;
      data = new Uint8Array(64);
      data.set(bytes(addressWord(permission.token), 32));
      validateRecurring(permission.limit);
      // TokenRecurringLimit has a different field order from the other recurring layouts.
      writeUint64(data, 32, permission.limit.window);
      writeUint64(data, 40, permission.limit.recurringAmount);
      writeUint64(data, 48, permission.limit.currentAmount);
      writeUint64(data, 56, permission.limit.lastReset);
      break;
    case "tokenDestinationLimit":
      kind = PermissionKind.TokenDestinationLimit;
      data = new Uint8Array(72);
      data.set(bytes(addressWord(permission.token), 32));
      data.set(bytes(addressWord(permission.destination), 32), 32);
      writeUint64(data, 64, permission.amount);
      break;
    case "tokenRecurringDestinationLimit":
      kind = PermissionKind.TokenRecurringDestinationLimit;
      data = new Uint8Array(96);
      data.set(bytes(addressWord(permission.token), 32));
      data.set(bytes(addressWord(permission.destination), 32), 32);
      writeRecurring(data, 64, permission.limit);
      break;
    default:
      throw new SwigCodecError("Unsupported permission type");
  }
  return { permission: kind, data: bytesToHex(data) };
}

/** Decode stored action state. Unsupported wire variants fail explicitly. */
export function decodePermission(action: ActionData): Permission {
  switch (action.permission) {
    case PermissionKind.All:
      bytes(action.data, 0);
      return { type: "all" };
    case PermissionKind.ManageAuthority:
      bytes(action.data, 0);
      return { type: "manageAuthority" };
    case PermissionKind.AllButManageAuthority:
      bytes(action.data, 0);
      return { type: "allButManageAuthority" };
    case PermissionKind.ProgramAll:
      bytes(action.data, 0);
      return { type: "programAll" };
    case PermissionKind.Program:
      return {
        type: "program",
        target: readAddress(bytes(action.data, 32), 0),
      };
    case PermissionKind.SolLimit:
      return {
        type: "nativeLimit",
        amount: readUint64(bytes(action.data, 8), 0),
      };
    case PermissionKind.SolRecurringLimit:
      return {
        type: "nativeRecurringLimit",
        limit: readRecurring(bytes(action.data, 32), 0),
      };
    case PermissionKind.SolDestinationLimit: {
      const data = bytes(action.data, 40);
      return {
        type: "nativeDestinationLimit",
        destination: readAddress(data, 0),
        amount: readUint64(data, 32),
      };
    }
    case PermissionKind.SolRecurringDestinationLimit: {
      const data = bytes(action.data, 64);
      return {
        type: "nativeRecurringDestinationLimit",
        destination: readAddress(data, 0),
        limit: readRecurring(data, 32),
      };
    }
    case PermissionKind.TokenLimit: {
      const data = bytes(action.data, 40);
      return {
        type: "tokenLimit",
        token: readAddress(data, 0),
        amount: readUint64(data, 32),
      };
    }
    case PermissionKind.TokenRecurringLimit: {
      const data = bytes(action.data, 64);
      const limit = {
        window: readUint64(data, 32),
        recurringAmount: readUint64(data, 40),
        currentAmount: readUint64(data, 48),
        lastReset: readUint64(data, 56),
      };
      validateRecurring(limit);
      return {
        type: "tokenRecurringLimit",
        token: readAddress(data, 0),
        limit,
      };
    }
    case PermissionKind.TokenDestinationLimit: {
      const data = bytes(action.data, 72);
      return {
        type: "tokenDestinationLimit",
        token: readAddress(data, 0),
        destination: readAddress(data, 32),
        amount: readUint64(data, 64),
      };
    }
    case PermissionKind.TokenRecurringDestinationLimit: {
      const data = bytes(action.data, 96);
      return {
        type: "tokenRecurringDestinationLimit",
        token: readAddress(data, 0),
        destination: readAddress(data, 32),
        limit: readRecurring(data, 64),
      };
    }
    default:
      throw new SwigCodecError(
        `Unsupported permission discriminant: ${action.permission}`,
      );
  }
}
