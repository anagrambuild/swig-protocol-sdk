import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type Abi,
  type Address,
  BaseError,
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  type Hex,
  http,
  parseAbi,
  RpcRequestError,
  stringToHex,
} from "viem";
import {
  createBundlerClient,
  entryPoint08Abi,
  entryPoint08Address,
  toPackedUserOperation,
  UserOperationSignatureError,
} from "viem/account-abstraction";
import { mnemonicToAccount } from "viem/accounts";
import {
  encodeAuthority,
  encodePermission,
  getSwigConfig,
  getSwigConfigFactory,
  toSwigSmartAccount,
} from "../src/index.js";

const rpc = process.env.SWIG_TEST_RPC_URL;
const bundlerRpc = process.env.SWIG_TEST_BUNDLER_URL;
const artifacts = process.env.SWIG_TEST_ARTIFACTS;
assert(
  rpc && bundlerRpc && artifacts,
  "Set local test RPC, bundler URL, and contract artifacts",
);
assert.equal(new URL(rpc).hostname, "127.0.0.1");
assert.equal(new URL(bundlerRpc).hostname, "127.0.0.1");
const chain = defineChain({
  id: 1337,
  name: "Isolated Geth",
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
const recipient = mnemonicToAccount(mnemonic, { addressIndex: 2 }).address;

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
  return receipt.contractAddress;
}
async function mined(hash: Hex): Promise<void> {
  assert.equal(
    (await client.waitForTransactionReceipt({ hash })).status,
    "success",
  );
}

const modules = await deploy("SwigConfigModules", [entryPoint08Address]);
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
const config = getSwigConfig(address, { public: client, wallet });
const sponsor = await deploy("Swig4337Sponsor", [entryPoint08Address]);
await mined(
  await wallet.writeContract({
    address: entryPoint08Address,
    abi: entryPoint08Abi,
    functionName: "depositTo",
    args: [sponsor],
    value: 10n ** 18n,
  }),
);
const validity = {
  validAfter: 0,
  validUntil: Number((await client.getBlock()).timestamp) + 3600,
};
const account = await toSwigSmartAccount({
  client,
  address,
  roleId: 0,
  signer,
  ...validity,
});
const bundler = createBundlerClient({
  account,
  client,
  transport: http(bundlerRpc),
  pollingInterval: 100,
});
const common = {
  maxFeePerGas: 2_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
  paymaster: sponsor,
  paymasterVerificationGasLimit: 100_000n,
  paymasterPostOpGasLimit: 50_000n,
};
const prepared = await bundler.prepareUserOperation({
  calls: [{ to: recipient, value: 25n }],
  ...common,
});
assert(prepared.callGasLimit > 0n && prepared.verificationGasLimit > 0n);
const signature = await account.signUserOperation(prepared);
const packed = toPackedUserOperation({ ...prepared, signature });
const expectedHash = await client.readContract({
  address: entryPoint08Address,
  abi: entryPoint08Abi,
  functionName: "getUserOpHash",
  args: [packed],
});
const beforeVault = await client.getBalance({ address: vault });
const beforeSponsor = await client.readContract({
  address: entryPoint08Address,
  abi: entryPoint08Abi,
  functionName: "balanceOf",
  args: [sponsor],
});

const hash = await bundler.sendUserOperation({ ...prepared, signature });
assert.equal(hash, expectedHash);
const receipt = await bundler.waitForUserOperationReceipt({
  hash,
  timeout: 30_000,
});
assert.equal(receipt.success, true);
assert(receipt.actualGasCost > 0n);
assert.equal(await client.getBalance({ address: vault }), beforeVault - 25n);
assert(
  (await client.readContract({
    address: entryPoint08Address,
    abi: entryPoint08Abi,
    functionName: "balanceOf",
    args: [sponsor],
  })) < beforeSponsor,
);
assert.equal(await config.read.authorizationNonce([0]), 0n);

// Existing direct entrypoint remains usable after a UserOperation.
await mined(await config.write.signV2([0, recipient, 5n, "0x", "0x"]));
assert.equal(await client.getBalance({ address: vault }), beforeVault - 30n);
const target = await deploy("AATarget", [], "Swig4337.t");
const capsuleAccount = await toSwigSmartAccount({
  client,
  address,
  roleId: 0,
  signer,
  ...validity,
  capsule: { tokenFunding: [], sweepTokens: [] },
});
const capsuleHash = await bundler.sendUserOperation({
  account: capsuleAccount,
  calls: [
    {
      to: target,
      data: encodeFunctionData({
        abi: parseAbi(["function record(uint256)"]),
        functionName: "record",
        args: [42n],
      }),
    },
  ],
  ...common,
});
assert.equal(
  (
    await bundler.waitForUserOperationReceipt({
      hash: capsuleHash,
      timeout: 30_000,
    })
  ).success,
  true,
);
assert.equal(
  await client.readContract({
    address: target,
    abi: parseAbi(["function value() view returns(uint256)"]),
    functionName: "value",
  }),
  42n,
);
// A separately keyed session uses the same adapter and its own EntryPoint nonce lane.
const sessionSigner = mnemonicToAccount(mnemonic, { addressIndex: 3 });
const sessionRole = await config.read.roleCounter();
await mined(
  await config.write.addSessionRole([
    0,
    4,
    authority.key,
    authority.keyExtra,
    3600n,
    [encodePermission({ type: "nativeLimit", amount: 100n })],
  ]),
);
await mined(
  await config.write.createSession([
    sessionRole,
    encodeAuthority({ type: "secp256k1", address: sessionSigner.address }).key,
    300n,
    "0x",
  ]),
);
const sessionAccount = await toSwigSmartAccount({
  client,
  address,
  roleId: sessionRole,
  signer: sessionSigner,
  ...validity,
});
const sessionHash = await bundler.sendUserOperation({
  account: sessionAccount,
  calls: [{ to: recipient, value: 5n }],
  ...common,
});
assert.equal(
  (
    await bundler.waitForUserOperationReceipt({
      hash: sessionHash,
      timeout: 30_000,
    })
  ).success,
  true,
);
assert.equal(
  await sessionAccount.getNonce(),
  (BigInt(sessionRole) << 64n) + 1n,
);
assert.equal(await config.read.authorizationNonce([sessionRole]), 1n);
// Supply gas explicitly so the bundler includes an operation whose policy check
// will fail during execution. Included failure still consumes a nonce and pays gas.
const failureBefore = await client.getBalance({ address: vault });
const failureSponsorBefore = await client.readContract({
  address: entryPoint08Address,
  abi: entryPoint08Abi,
  functionName: "balanceOf",
  args: [sponsor],
});
const failedHash = await bundler.sendUserOperation({
  account: sessionAccount,
  calls: [{ to: recipient, value: 101n }],
  ...common,
  callGasLimit: 200_000n,
  verificationGasLimit: 200_000n,
  preVerificationGas: 100_000n,
});
const failedReceipt = await bundler.waitForUserOperationReceipt({
  hash: failedHash,
  timeout: 30_000,
});
assert.equal(failedReceipt.success, false);
assert(failedReceipt.actualGasCost > 0n);
assert.equal(await client.getBalance({ address: vault }), failureBefore);
assert.equal(
  await sessionAccount.getNonce(),
  (BigInt(sessionRole) << 64n) + 2n,
);
assert.equal(await config.read.authorizationNonce([sessionRole]), 1n);
assert(
  (await client.readContract({
    address: entryPoint08Address,
    abi: entryPoint08Abi,
    functionName: "balanceOf",
    args: [sponsor],
  })) < failureSponsorBefore,
);
// Real submission must reject the estimation stub without spending custody or gas deposit.
const invalid = await bundler.prepareUserOperation({
  account: sessionAccount,
  calls: [{ to: recipient, value: 5n }],
  ...common,
});
const invalidBefore = await client.getBalance({ address: vault });
const invalidSponsorBefore = await client.readContract({
  address: entryPoint08Address,
  abi: entryPoint08Abi,
  functionName: "balanceOf",
  args: [sponsor],
});
await assert.rejects(
  async () =>
    bundler.sendUserOperation({
      ...invalid,
      account: sessionAccount,
      signature: await sessionAccount.getStubSignature(),
    }),
  (error: unknown) => {
    if (!(error instanceof BaseError)) return false;
    const cause = error.walk(
      (nested) =>
        (nested instanceof RpcRequestError && nested.code === -32507) ||
        nested instanceof UserOperationSignatureError,
    );
    return (
      (cause instanceof RpcRequestError && cause.code === -32507) ||
      cause instanceof UserOperationSignatureError
    );
  },
);
assert.equal(await client.getBalance({ address: vault }), invalidBefore);
assert.equal(
  await client.readContract({
    address: entryPoint08Address,
    abi: entryPoint08Abi,
    functionName: "balanceOf",
    args: [sponsor],
  }),
  invalidSponsorBefore,
);
console.log(
  JSON.stringify({
    entryPoint: entryPoint08Address,
    account: address,
    userOpHash: hash,
    capsuleUserOpHash: capsuleHash,
    estimation: "stub signature",
    sessionUserOpHash: sessionHash,
    failedUserOpHash: failedHash,
    inclusion: "normal, capsule, and session",
    invalidSignature: "rejected",
    direct: "passed",
    actualGasCost: receipt.actualGasCost.toString(),
  }),
);
