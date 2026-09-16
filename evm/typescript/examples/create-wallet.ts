// Create a wallet whose root authority is the caller, and fund its vault.
import assert from "node:assert/strict";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isHex,
  keccak256,
  parseEventLogs,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  encodeAuthority,
  encodePermission,
  getSwigConfigFactory,
  swigConfigFactoryAbi,
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
const { FACTORY_ADDRESS, WALLET_NAME, INITIAL_BALANCE_WEI } = process.env;
assert(FACTORY_ADDRESS && WALLET_NAME && INITIAL_BALANCE_WEI);
const factoryAddress = getAddress(FACTORY_ADDRESS);
const factory = getSwigConfigFactory(factoryAddress, {
  public: client,
  wallet,
});
const authority = encodeAuthority({
  type: "secp256k1",
  address: signer.address,
});
// The name is public. Reusing the same name and root settings predicts the same wallet.
const id = keccak256(toBytes(WALLET_NAME));
const args = [
  id,
  id,
  authority.authorityType,
  authority.key,
  authority.keyExtra,
  [encodePermission({ type: "all" })],
] as const;
const predicted = await factory.read.computeConfigAddress(args);
const hash = await factory.write.deploy(args, {
  chain: null,
  value: BigInt(INITIAL_BALANCE_WEI),
});
const receipt = await client.waitForTransactionReceipt({ hash });
assert.equal(receipt.status, "success");
const [deployment] = parseEventLogs({
  abi: swigConfigFactoryAbi,
  logs: receipt.logs.filter(
    (log) => getAddress(log.address) === factoryAddress,
  ),
  eventName: "SwigDeployed",
});
assert(deployment, "Missing wallet deployment event");
assert.equal(getAddress(deployment.args.config), getAddress(predicted));
console.log(
  JSON.stringify({
    accountAddress: deployment.args.config,
    vaultAddress: deployment.args.vault,
    capsuleAddress: deployment.args.capsule,
    transactionHash: hash,
  }),
);
