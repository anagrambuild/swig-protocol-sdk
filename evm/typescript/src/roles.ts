import type { ContractFunctionReturnType } from "viem";
import type { swigConfigAbi } from "./abi.js";
import { type Authority, decodeAuthority } from "./authorities.js";
import { uint } from "./codec.js";

export const ROOT_ROLE_ID = 0;
export type RoleData = ContractFunctionReturnType<
  typeof swigConfigAbi,
  "view",
  "getRole"
>;

export interface Role {
  readonly id: number;
  readonly authority: Authority;
  readonly actionCount: number;
}

/** Decode one getRole result without fetching actions or other wallet state. */
export function decodeRole(data: RoleData): Role {
  uint(data.id, 0xffffffff);
  uint(data.actionCount, 0xffff);
  return {
    id: data.id,
    authority: decodeAuthority(data.authority),
    actionCount: data.actionCount,
  };
}
