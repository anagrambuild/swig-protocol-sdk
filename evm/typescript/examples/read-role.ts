import assert from "node:assert/strict";
import { createPublicClient, getAddress, http } from "viem";
import { decodeRole, getSwigConfig } from "../src/index.js";

const { RPC_URL, ACCOUNT_ADDRESS } = process.env;
assert(RPC_URL && ACCOUNT_ADDRESS);
const config = getSwigConfig(
  getAddress(ACCOUNT_ADDRESS),
  createPublicClient({ transport: http(RPC_URL) }),
);
const role = decodeRole(
  await config.read.getRole([Number(process.env.ROLE_ID ?? "0")]),
);
console.log(
  JSON.stringify(role, (_, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  ),
);
