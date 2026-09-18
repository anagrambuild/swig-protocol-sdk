// Run with Bun. Supply a deployed account, its authorized key, and a compatible bundler.
import assert from "node:assert/strict";
import { createSmartAccountClient } from "permissionless";
import {
  createPublicClient,
  defineChain,
  getAddress,
  type Hex,
  http,
} from "viem";
import { createPaymasterClient } from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { toSwigSmartAccount } from "../src/index.js";

const {
  RPC_URL,
  BUNDLER_URL,
  PAYMASTER_URL,
  ACCOUNT_ADDRESS,
  SIGNER_PRIVATE_KEY,
  RECIPIENT,
} = process.env;
assert(
  RPC_URL && BUNDLER_URL && ACCOUNT_ADDRESS && SIGNER_PRIVATE_KEY && RECIPIENT,
);
assert(
  /^0x[0-9a-fA-F]{64}$/.test(SIGNER_PRIVATE_KEY),
  "Invalid signer private key",
);
const transport = http(RPC_URL);
const chainId = await createPublicClient({ transport }).getChainId();
const chain = defineChain({
  id: chainId,
  name: "Configured EVM chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
const client = createPublicClient({ chain, transport });
const account = await toSwigSmartAccount({
  client,
  address: getAddress(ACCOUNT_ADDRESS),
  roleId: Number(process.env.ROLE_ID ?? "0"),
  signer: privateKeyToAccount(SIGNER_PRIVATE_KEY as Hex),
  validAfter: 0,
  validUntil: Number((await client.getBlock()).timestamp) + 600,
});
const smartAccountClient = createSmartAccountClient({
  account,
  chain,
  client,
  bundlerTransport: http(BUNDLER_URL),
  ...(PAYMASTER_URL
    ? { paymaster: createPaymasterClient({ transport: http(PAYMASTER_URL) }) }
    : {}),
});
// For the disposable Compose fixture only. A real sponsor supplies its own ERC-7677 data.
const localPaymaster = process.env.TEST_PAYMASTER_ADDRESS;
assert(
  (PAYMASTER_URL && !localPaymaster) ||
    (!PAYMASTER_URL && chainId === 1337 && localPaymaster),
  "Supply PAYMASTER_URL, or only TEST_PAYMASTER_ADDRESS on the disposable chain",
);
const fees = await client.estimateFeesPerGas();
const hash = await smartAccountClient.sendUserOperation({
  calls: [
    { to: getAddress(RECIPIENT), value: BigInt(process.env.VALUE_WEI ?? "1") },
  ],
  ...fees,
  verificationGasLimit: 200_000n,
  ...(localPaymaster
    ? {
        paymaster: getAddress(localPaymaster),
        paymasterVerificationGasLimit: 100_000n,
        paymasterPostOpGasLimit: 50_000n,
      }
    : {}),
});
const receipt = await smartAccountClient.waitForUserOperationReceipt({ hash });
assert(receipt.success, "UserOperation was included but execution failed");
console.log(
  JSON.stringify({
    userOperationHash: hash,
    transactionHash: receipt.receipt.transactionHash,
  }),
);
