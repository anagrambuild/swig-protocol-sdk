// Give a delegate a fixed native-currency spending allowance.
import assert from "node:assert/strict";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isHex,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  encodeAuthority,
  encodePermission,
  getSwigConfig,
  swigConfigAbi,
} from "../src/index.js";

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
const { ACCOUNT_ADDRESS, DELEGATE_ADDRESS, LIMIT_WEI } = process.env;
assert(ACCOUNT_ADDRESS && DELEGATE_ADDRESS && LIMIT_WEI);
const address = getAddress(ACCOUNT_ADDRESS);
const config = getSwigConfig(address, { public: client, wallet });
const authority = encodeAuthority({
  type: "secp256k1",
  address: getAddress(DELEGATE_ADDRESS),
});
const hash = await config.write.addRole(
  [
    Number(process.env.MANAGER_ROLE_ID ?? "0"),
    authority.authorityType,
    authority.key,
    authority.keyExtra,
    [encodePermission({ type: "nativeLimit", amount: BigInt(LIMIT_WEI) })],
  ],
  { chain: null },
);
const receipt = await client.waitForTransactionReceipt({ hash });
assert.equal(receipt.status, "success");
// Read the assigned role ID from this transaction, rather than predicting a counter.
const [event] = parseEventLogs({
  abi: swigConfigAbi,
  logs: receipt.logs.filter((log) => getAddress(log.address) === address),
  eventName: "RoleAdded",
});
assert(event, "Missing role creation event");
console.log(
  JSON.stringify({ roleId: event.args.roleId, transactionHash: hash }),
);
