import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type Abi,
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  type Hex,
  http,
  stringToHex,
} from "viem";
import { entryPoint09Abi, entryPoint09Address } from "viem/account-abstraction";
import { mnemonicToAccount } from "viem/accounts";
import {
  encodeAuthority,
  encodePermission,
  getSwigConfigFactory,
} from "../src/index.js";

const rpc = process.env.SWIG_TEST_RPC_URL;
const artifacts = process.env.SWIG_TEST_ARTIFACTS;
const context = process.env.SWIG_TEST_BUNDLER_CONTEXT;
assert(context);
assert(
  rpc && artifacts,
  "Set local test RPC, bundler URL, and contract artifacts",
);
assert.equal(new URL(rpc).hostname, "127.0.0.1");

const chain = defineChain({
  id: 1337,
  name: "Isolated Anvil",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const client = createPublicClient({
  chain,
  transport: http(rpc),
  pollingInterval: 100,
});
assert.equal(await client.getChainId(), chain.id);
// Public disposable development keys, never real funds.
const mnemonic = "test test test test test test test test test test test junk";
const signer = mnemonicToAccount(mnemonic, { addressIndex: 1 });
const wallet = createWalletClient({
  account: signer,
  chain,
  transport: http(rpc),
});

async function deploy(
  name: string,
  args: readonly unknown[] = [],
  file: string = name,
): Promise<Address> {
  assert(artifacts);
  const artifact = JSON.parse(
    await readFile(join(artifacts, `${file}.sol`, `${name}.json`), "utf8"),
  ) as { abi: Abi; bytecode: { object: Hex } };
  const hash = await wallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  assert(receipt.contractAddress);
  return getAddress(receipt.contractAddress);
}
async function mined(hash: Hex): Promise<void> {
  assert.equal(
    (await client.waitForTransactionReceipt({ hash })).status,
    "success",
  );
}

const entryArtifactPath = process.env.SWIG_TEST_ENTRYPOINT_ARTIFACT;
assert(entryArtifactPath);
const entryArtifact = JSON.parse(await readFile(entryArtifactPath, "utf8")) as {
  bytecode: { object: Hex };
};
await mined(
  await wallet.sendTransaction({
    to: "0x4e59b44847b379578588920ca78fbf26c0b4956c",
    data: `0x7702864008ddeab30aa67b7adc3d2653bc8d162714b1fe8fe4582df814f3bf61${entryArtifact.bytecode.object.slice(2)}`,
    gas: 8_000_000n,
  }),
);
assert(
  await client.getCode({ address: entryPoint09Address }),
  "EntryPoint build did not reproduce its canonical address",
);
const modules = await deploy("SwigConfigModules", [entryPoint09Address]);
const configImpl = await deploy("SwigConfig", [modules]);
const vaultImpl = await deploy("SwigVault");
const capsuleImpl = await deploy("SwigCapsule");
const controller = await deploy("SwigBeaconController", [signer.address]);
const factoryAddress = await deploy("SwigConfigFactory", [
  configImpl,
  vaultImpl,
  capsuleImpl,
  "0x0000000000000000000000000000000000000100",
  controller,
]);
const factory = getSwigConfigFactory(factoryAddress, {
  public: client,
  wallet,
});
const authority = encodeAuthority({
  type: "secp256k1",
  address: signer.address,
});
const creation = [
  stringToHex("4337", { size: 32 }),
  stringToHex("adapter", { size: 32 }),
  authority.authorityType,
  authority.key,
  authority.keyExtra,
  [encodePermission({ type: "all" }), encodePermission({ type: "programAll" })],
] as const;
const address = await factory.read.computeConfigAddress(creation);
const vault = await factory.read.computeVaultAddress(creation);
await mined(await factory.write.deploy(creation, { value: 1_000_000n }));
const secondArgs = [
  stringToHex("inactive", { size: 32 }),
  creation[1],
  creation[2],
  creation[3],
  creation[4],
  creation[5],
] as const;
const secondAddress = await factory.read.computeConfigAddress(secondArgs);
await mined(await factory.write.deploy(secondArgs, { value: 1_000_000n }));
const beacon = await factory.read.configBeacon();
const sponsor = await deploy("Swig4337Sponsor", [entryPoint09Address]);
await mined(
  await wallet.writeContract({
    address: entryPoint09Address,
    abi: entryPoint09Abi,
    functionName: "depositTo",
    args: [sponsor],
    value: 10n ** 18n,
  }),
);
await writeFile(
  context,
  JSON.stringify({
    address,
    vault,
    secondAddress,
    beacon,
    sponsor,
    controller,
  }),
);
await writeFile(
  join(context, "..", "mempool.json"),
  JSON.stringify({
    [`0x${"01".repeat(32)}`]: {
      entryPoint: entryPoint09Address,
      allowlist: [{ entity: address, rule: "notStaked" }],
    },
  }),
);
console.log(
  JSON.stringify({
    entryPoint: entryPoint09Address,
    account: address,
    sponsor,
  }),
);
