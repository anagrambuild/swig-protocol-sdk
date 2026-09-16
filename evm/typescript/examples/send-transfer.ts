// Send native currency from the wallet vault, directly as the role's authority.
import assert from "node:assert/strict";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getSwigConfig } from "../src/index.js";

const { RPC_URL, SIGNER_PRIVATE_KEY } = process.env;
assert(RPC_URL && SIGNER_PRIVATE_KEY);
assert(
  isHex(SIGNER_PRIVATE_KEY) && SIGNER_PRIVATE_KEY.length === 66,
  "Invalid signer private key",
);
const signer = privateKeyToAccount(SIGNER_PRIVATE_KEY);
const client = createPublicClient({ transport: http(RPC_URL) });
const wallet = createWalletClient({
  account: signer,
  transport: http(RPC_URL),
});
const { ACCOUNT_ADDRESS, RECIPIENT, VALUE_WEI } = process.env;
assert(ACCOUNT_ADDRESS && RECIPIENT && VALUE_WEI);
const config = getSwigConfig(getAddress(ACCOUNT_ADDRESS), {
  public: client,
  wallet,
});
// Empty authorization selects the direct EOA-authority path; this caller pays gas.
const hash = await config.write.signV2(
  [
    Number(process.env.ROLE_ID ?? "0"),
    getAddress(RECIPIENT),
    BigInt(VALUE_WEI),
    "0x",
    "0x",
  ],
  { chain: null },
);
const receipt = await client.waitForTransactionReceipt({ hash });
assert.equal(receipt.status, "success");
console.log(JSON.stringify({ transactionHash: hash }));
