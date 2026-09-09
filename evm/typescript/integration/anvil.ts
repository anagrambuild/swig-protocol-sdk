import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type Address,
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getContract,
  type Hex,
  http,
  isHex,
  keccak256,
  parseAbi,
  stringToHex,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import vectors from "../../fixtures/permissions.json" with { type: "json" };
import {
  decodePermission,
  decodeRole,
  encodeAuthority,
  encodePermission,
  getSwigCapsule,
  getSwigConfig,
  getSwigConfigFactory,
  getSwigVault,
  swigCapsuleAbi,
  swigConfigAbi,
  swigConfigFactoryAbi,
  swigVaultAbi,
} from "../dist/index.js";

const rpc = process.env.SWIG_TEST_RPC_URL;
const artifacts = process.env.SWIG_TEST_ARTIFACTS;
const context = process.env.SWIG_TEST_CONTEXT;
assert(rpc && artifacts && context, "Run scripts/test-integration.py");
assert(new URL(rpc).hostname === "127.0.0.1");
// Public, disposable Anvil accounts. These must never hold real assets.
const mnemonic = "test test test test test test test test test test test junk";
const root = mnemonicToAccount(mnemonic);
const delegate = mnemonicToAccount(mnemonic, { addressIndex: 1 });
const recipient = mnemonicToAccount(mnemonic, { addressIndex: 2 }).address;
const publicClient = createPublicClient({ chain: anvil, transport: http(rpc) });
assert.equal(await publicClient.getChainId(), 31337);
const wallet = createWalletClient({
  account: root,
  chain: anvil,
  transport: http(rpc),
});
const delegateWallet = createWalletClient({
  account: delegate,
  chain: anvil,
  transport: http(rpc),
});

async function bytecode(file: string, name: string): Promise<Hex> {
  assert(artifacts);
  const artifact: unknown = JSON.parse(
    await readFile(join(artifacts, `${file}.sol`, `${name}.json`), "utf8"),
  );
  assert(artifact && typeof artifact === "object" && "bytecode" in artifact);
  const code = artifact.bytecode;
  assert(
    code &&
      typeof code === "object" &&
      "object" in code &&
      typeof code.object === "string" &&
      isHex(code.object),
  );
  return code.object;
}

async function mined(hash: Hex): Promise<void> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
}

async function deployed(hash: Hex): Promise<Address> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  assert(receipt.contractAddress);
  return receipt.contractAddress;
}

const configImpl = await deployed(
  await wallet.deployContract({
    abi: swigConfigAbi,
    bytecode: await bytecode("SwigConfig", "SwigConfig"),
  }),
);
const vaultImpl = await deployed(
  await wallet.deployContract({
    abi: swigVaultAbi,
    bytecode: await bytecode("SwigVault", "SwigVault"),
  }),
);
const capsuleImpl = await deployed(
  await wallet.deployContract({
    abi: swigCapsuleAbi,
    bytecode: await bytecode("SwigCapsule", "SwigCapsule"),
  }),
);
const controller = await deployed(
  await wallet.deployContract({
    abi: parseAbi(["constructor(address owner)"]),
    bytecode: await bytecode("SwigBeaconController", "SwigBeaconController"),
    args: [root.address],
  }),
);
const factoryAddress = await deployed(
  await wallet.deployContract({
    abi: swigConfigFactoryAbi,
    bytecode: await bytecode("SwigConfigFactory", "SwigConfigFactory"),
    args: [
      configImpl,
      vaultImpl,
      capsuleImpl,
      "0x0000000000000000000000000000000000000100",
      controller,
    ],
  }),
);
const target = await deployed(
  await wallet.deployContract({
    abi: [],
    bytecode: await bytecode("SdkFixtures", "SdkTarget"),
  }),
);
const token = await deployed(
  await wallet.deployContract({
    abi: [],
    bytecode: await bytecode("SdkFixtures", "SdkToken"),
  }),
);
const harness = await deployed(
  await wallet.deployContract({
    abi: [],
    bytecode: await bytecode("SdkFixtures", "SdkCodecHarness"),
  }),
);

const codec = getContract({
  address: harness,
  abi: parseAbi(["function validateAction(uint8 permission, bytes data) pure"]),
  client: publicClient,
});
for (const vector of vectors.filter((v) => !v.name.startsWith("stored"))) {
  assert(isHex(vector.data));
  const action = encodePermission(
    decodePermission({ permission: vector.permission, data: vector.data }),
  );
  await codec.read.validateAction([action.permission, action.data]);
}

const authority = encodeAuthority({ type: "secp256k1", address: root.address });
const factory = getSwigConfigFactory(factoryAddress, {
  public: publicClient,
  wallet,
});
const creation = [
  stringToHex("typescript", { size: 32 }),
  stringToHex("sdk-test", { size: 32 }),
  authority.authorityType,
  authority.key,
  authority.keyExtra,
  [encodePermission({ type: "all" })],
] as const;
const configAddress = await factory.read.computeConfigAddress(creation);
const vaultAddress = await factory.read.computeVaultAddress(creation);
const capsuleAddress = await factory.read.computeCapsuleAddress(creation);
await mined(await factory.write.deploy(creation, { value: 10_000n }));
const config = getSwigConfig(configAddress, { public: publicClient, wallet });
const delegated = getSwigConfig(configAddress, {
  public: publicClient,
  wallet: delegateWallet,
});
assert.equal(
  (await config.read.vault()).toLowerCase(),
  vaultAddress.toLowerCase(),
);
assert.equal(
  (await config.read.capsule()).toLowerCase(),
  capsuleAddress.toLowerCase(),
);
assert.equal(
  (
    await getSwigVault(vaultAddress, publicClient).read.swigAccount()
  ).toLowerCase(),
  configAddress.toLowerCase(),
);
assert.equal(
  (
    await getSwigCapsule(capsuleAddress, publicClient).read.vault()
  ).toLowerCase(),
  vaultAddress.toLowerCase(),
);
assert.equal(decodeRole(await config.read.getRole([0])).actionCount, 1);
assert.equal(await config.read.roleCount(), 1);

const delegateAuthority = encodeAuthority({
  type: "secp256k1",
  address: delegate.address,
});
const nativeRole = await config.read.roleCounter();
await mined(
  await config.write.addRole([
    0,
    delegateAuthority.authorityType,
    delegateAuthority.key,
    delegateAuthority.keyExtra,
    [encodePermission({ type: "nativeLimit", amount: 100n })],
  ]),
);
assert.equal(await config.read.hasRole([nativeRole]), true);
const before = await publicClient.getBalance({ address: recipient });
await mined(
  await delegated.write.signV2([nativeRole, recipient, 40n, "0x", "0x"]),
);
assert.equal(
  await publicClient.getBalance({ address: recipient }),
  before + 40n,
);
assert.deepEqual(
  decodePermission(await config.read.getAction([nativeRole, 0])),
  { type: "nativeLimit", amount: 60n },
);
await assert.rejects(
  delegated.simulate.signV2([nativeRole, recipient, 61n, "0x", "0x"]),
  (error: unknown) => {
    assert(error instanceof BaseError);
    const revert = error.walk(
      (cause) => cause instanceof ContractFunctionRevertedError,
    );
    assert(revert instanceof ContractFunctionRevertedError);
    assert.equal(revert.data?.errorName, "UnauthorizedSignV2");
    return true;
  },
);
assert.deepEqual(
  decodePermission(await config.read.getAction([nativeRole, 0])),
  { type: "nativeLimit", amount: 60n },
);

const nonce = await config.read.authorizationNonce([0]);
const delegatedNonce = await config.read.authorizationNonce([nativeRole]);
const digest = await config.read.signV2AuthorizationDigest([
  0,
  recipient,
  1n,
  keccak256("0x"),
  nonce,
]);
const signature = await root.sign({ hash: digest });
await mined(await delegated.write.signV2([0, recipient, 1n, "0x", signature]));
assert.equal(await config.read.authorizationNonce([0]), nonce + 1n);
assert.equal(
  await config.read.authorizationNonce([nativeRole]),
  delegatedNonce,
);

const tokenAbi = parseAbi([
  "function mint(address account, uint256 amount)",
  "function transfer(address recipient, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);
const erc20 = getContract({
  address: token,
  abi: tokenAbi,
  client: { public: publicClient, wallet },
});
await mined(await erc20.write.mint([vaultAddress, 100n]));
const tokenRole = await config.read.roleCounter();
await mined(
  await config.write.addRole([
    0,
    delegateAuthority.authorityType,
    delegateAuthority.key,
    delegateAuthority.keyExtra,
    [encodePermission({ type: "tokenLimit", token, amount: 50n })],
  ]),
);
const transfer = encodeFunctionData({
  abi: tokenAbi,
  functionName: "transfer",
  args: [recipient, 20n],
});
await mined(
  await delegated.write.signV2([tokenRole, token, 0n, transfer, "0x"]),
);
assert.equal(await erc20.read.balanceOf([recipient]), 20n);
const remaining = decodePermission(await config.read.getAction([tokenRole, 0]));
assert(remaining.type === "tokenLimit");
assert.equal(remaining.amount, 30n);

const programRole = await config.read.roleCounter();
await mined(
  await config.write.addRole([
    0,
    delegateAuthority.authorityType,
    delegateAuthority.key,
    delegateAuthority.keyExtra,
    [encodePermission({ type: "program", target })],
  ]),
);
const targetAbi = parseAbi([
  "function ping()",
  "function count() view returns (uint256)",
]);
await mined(
  await delegated.write.signV2WithCapsule([
    programRole,
    {
      target,
      value: 0n,
      data: encodeFunctionData({ abi: targetAbi, functionName: "ping" }),
      tokenFunding: [],
      sweepTokens: [],
    },
    "0x",
  ]),
);
assert.equal(
  await publicClient.readContract({
    address: target,
    abi: targetAbi,
    functionName: "count",
  }),
  1n,
);

// Each authorization entry point remains directly accessible; the caller owns signing.
const removalNonce = await config.read.authorizationNonce([0]);
const removalDigest = await config.read.removeRoleAuthorizationDigest([
  0,
  nativeRole,
  removalNonce,
]);
await mined(
  await delegated.write.removeRoleWithAuthorization([
    0,
    nativeRole,
    await root.sign({ hash: removalDigest }),
  ]),
);
assert.equal(await config.read.hasRole([nativeRole]), false);
await mined(await config.write.removeRole([0, tokenRole]));
assert.equal(await config.read.hasRole([tokenRole]), false);

await writeFile(
  context,
  JSON.stringify({ factory: factoryAddress, target, token, harness }),
);
console.log(
  "TypeScript: factory predictions, role reads/mutations, native/token limits, exact rejection, raw digest authorization, capsule execution, Solidity codec validation passed",
);
