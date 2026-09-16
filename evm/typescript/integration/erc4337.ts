import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type Abi,
  type Address,
  BaseError,
  createClient,
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  getAddress,
  type Hex,
  http,
  parseAbi,
  RpcRequestError,
  rpcSchema,
} from "viem";
import {
  createBundlerClient,
  entryPoint09Abi,
  entryPoint09Address,
  toPackedUserOperation,
  UserOperationSignatureError,
} from "viem/account-abstraction";
import { mnemonicToAccount } from "viem/accounts";
import {
  encodeAuthority,
  encodePermission,
  getSwigConfig,
  toSwigSmartAccount,
} from "../src/index.js";

const rpc = process.env.SWIG_TEST_RPC_URL;
const bundlerRpc = process.env.SWIG_TEST_BUNDLER_URL;
const artifacts = process.env.SWIG_TEST_ARTIFACTS;
const strictRpc = process.env.SWIG_TEST_STRICT_BUNDLER_URL;
const context = process.env.SWIG_TEST_BUNDLER_CONTEXT;
assert(strictRpc && context);
assert.equal(new URL(strictRpc).hostname, "127.0.0.1");
assert(
  rpc && bundlerRpc && artifacts,
  "Set local test RPC, bundler URL, and contract artifacts",
);
assert.equal(new URL(rpc).hostname, "127.0.0.1");
assert.equal(new URL(bundlerRpc).hostname, "127.0.0.1");
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
  return getAddress(receipt.contractAddress);
}
async function mined(hash: Hex): Promise<void> {
  assert.equal(
    (await client.waitForTransactionReceipt({ hash })).status,
    "success",
  );
}

const { address, vault, secondAddress, beacon, sponsor, controller } =
  JSON.parse(await readFile(context, "utf8")) as {
    address: Address;
    vault: Address;
    secondAddress: Address;
    beacon: Address;
    sponsor: Address;
    controller: Address;
  };
const config = getSwigConfig(address, { public: client, wallet });
const authority = encodeAuthority({
  type: "secp256k1",
  address: signer.address,
});
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
const strictBundler = createBundlerClient({
  account,
  client,
  transport: http(strictRpc),
});
// Compose starts both bundlers after the deployed account policy is written.
const startupDeadline = Date.now() + 90_000;
for (;;) {
  try {
    assert.deepEqual(await bundler.getSupportedEntryPoints(), [
      entryPoint09Address,
    ]);
    assert.deepEqual(await strictBundler.getSupportedEntryPoints(), [
      entryPoint09Address,
    ]);
    break;
  } catch (error) {
    if (Date.now() > startupDeadline) throw error;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
async function rejectsBeaconRead(
  action: () => Promise<unknown>,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    if (!(error instanceof BaseError)) return false;
    const cause = error.walk((nested) => nested instanceof RpcRequestError);
    if (!(cause instanceof RpcRequestError) || cause.code !== -32502)
      return false;
    const data = cause.data;
    return (
      typeof data === "object" &&
      data !== null &&
      "accessedAddress" in data &&
      data.accessedAddress === beacon.toLowerCase() &&
      "slot" in data &&
      data.slot === "0x0" &&
      "accessingEntity" in data &&
      data.accessingEntity === "account"
    );
  });
}
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
  address: entryPoint09Address,
  abi: entryPoint09Abi,
  functionName: "getUserOpHash",
  args: [packed],
});
const beforeVault = await client.getBalance({ address: vault });
const beforeSponsor = await client.readContract({
  address: entryPoint09Address,
  abi: entryPoint09Abi,
  functionName: "balanceOf",
  args: [sponsor],
});

// The same signed operation is rejected by canonical policy for the beacon slot.
await rejectsBeaconRead(() =>
  strictBundler.sendUserOperation({ ...prepared, signature }),
);
assert.equal(await account.getNonce(), prepared.nonce);
assert.equal(await client.getBalance({ address: vault }), beforeVault);
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
    address: entryPoint09Address,
    abi: entryPoint09Abi,
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
  verificationGasLimit: 200_000n,
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
  address: entryPoint09Address,
  abi: entryPoint09Abi,
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
    address: entryPoint09Address,
    abi: entryPoint09Abi,
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
  address: entryPoint09Address,
  abi: entryPoint09Abi,
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
    address: entryPoint09Address,
    abi: entryPoint09Abi,
    functionName: "balanceOf",
    args: [sponsor],
  }),
  invalidSponsorBefore,
);
// An account on the same beacon without an explicit exception remains rejected.
const unlisted = await toSwigSmartAccount({
  client,
  address: secondAddress,
  roleId: 0,
  signer,
  ...validity,
});
await rejectsBeaconRead(() =>
  bundler.sendUserOperation({
    account: unlisted,
    calls: [{ to: recipient, value: 1n }],
    ...common,
    callGasLimit: 200_000n,
    verificationGasLimit: 300_000n,
    preVerificationGas: 100_000n,
  }),
);
assert.equal(await unlisted.getNonce(), 0n);

// Hold a real submitted operation in the mempool while governance upgrades the fleet.
const debug = createClient({
  transport: http(bundlerRpc),
  rpcSchema:
    rpcSchema<
      [
        {
          Method: "debug_bundler_setBundlingMode";
          Parameters: ["manual" | "auto"];
          ReturnType: string;
        },
        {
          Method: "debug_bundler_dumpMempool";
          Parameters: [Address];
          ReturnType: { sender: Address; nonce: Hex }[];
        },
        {
          Method: "debug_bundler_dumpReputation";
          Parameters: [Address];
          ReturnType: {
            address: Address;
            opsSeen: number;
            opsIncluded: number;
            status: number;
          }[];
        },
        {
          Method: "debug_bundler_setReputation";
          Parameters: [
            { address: Address; opsSeen: number; opsIncluded: number }[],
            Address,
          ];
          ReturnType: string;
        },
        {
          Method: "debug_bundler_dumpPaymasterBalances";
          Parameters: [Address];
          ReturnType: { address: Address; confirmedBalance: Hex }[];
        },
        {
          Method: "debug_bundler_sendBundleNow";
          Parameters: [];
          ReturnType: Hex;
        },
      ]
    >(),
});
await debug.request({
  method: "debug_bundler_setBundlingMode",
  params: ["manual"],
});
const pending = await bundler.prepareUserOperation({
  calls: [{ to: recipient, value: 7n }],
  ...common,
  verificationGasLimit: 200_000n,
});
const reputationBefore = await debug.request({
  method: "debug_bundler_dumpReputation",
  params: [entryPoint09Address],
});
const accountReputation = reputationBefore.find(
  (item) => item.address.toLowerCase() === address.toLowerCase(),
);
assert(accountReputation);
console.log("Queueing operation before fleet upgrade");
const pendingHash = await bundler.sendUserOperation({
  ...pending,
  signature: await account.signUserOperation(pending),
});
const queued = await debug.request({
  method: "debug_bundler_dumpMempool",
  params: [entryPoint09Address],
});
assert(
  queued.some(
    (op) =>
      op.sender.toLowerCase() === address.toLowerCase() &&
      BigInt(op.nonce) === pending.nonce,
  ),
);
console.log(JSON.stringify({ pendingUpgradeUserOpHash: pendingHash }));
const upgradeBalance = await client.getBalance({ address: vault });
const newModules = await deploy("SwigConfigModules", [entryPoint09Address]);
const replacement = await deploy("SwigConfig", [newModules]);
await mined(
  await wallet.writeContract({
    address: controller,
    abi: parseAbi(["function upgradeBeacon(address,address)"]),
    functionName: "upgradeBeacon",
    args: [beacon, replacement],
  }),
);
assert.equal(
  await client.readContract({
    address: beacon,
    abi: parseAbi(["function implementation() view returns(address)"]),
    functionName: "implementation",
  }),
  replacement,
);
const replacementSignV2 = await client.readContract({
  address: replacement,
  abi: parseAbi(["function signV2Module() view returns(address)"]),
  functionName: "signV2Module",
});
for (const upgraded of [address, secondAddress]) {
  assert.equal(
    await client.readContract({
      address: upgraded,
      abi: parseAbi(["function signV2Module() view returns(address)"]),
      functionName: "signV2Module",
    }),
    replacementSignV2,
  );
}
// Observe a post-upgrade chain update in the pool, rather than racing its head polling.
await mined(
  await wallet.writeContract({
    address: entryPoint09Address,
    abi: entryPoint09Abi,
    functionName: "depositTo",
    args: [sponsor],
    value: 1n,
  }),
);
const deposit = await client.readContract({
  address: entryPoint09Address,
  abi: entryPoint09Abi,
  functionName: "balanceOf",
  args: [sponsor],
});
const headDeadline = Date.now() + 30_000;
for (;;) {
  const balances = await debug.request({
    method: "debug_bundler_dumpPaymasterBalances",
    params: [entryPoint09Address],
  });
  if (
    balances.some(
      (item) =>
        item.address.toLowerCase() === sponsor.toLowerCase() &&
        BigInt(item.confirmedBalance) === deposit,
    )
  )
    break;
  assert(
    Date.now() < headDeadline,
    "Bundler did not observe post-upgrade deposit",
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
}
// Rundler revalidation rejects a changed validation code hash. A timeout is not evidence of rejection.
const droppedBundle = await debug.request({
  method: "debug_bundler_sendBundleNow",
  params: [],
});
assert.equal(droppedBundle, `0x${"00".repeat(32)}`);
assert.deepEqual(
  await debug.request({
    method: "debug_bundler_dumpMempool",
    params: [entryPoint09Address],
  }),
  [],
);
assert.equal(await account.getNonce(), pending.nonce);
assert.equal(await client.getBalance({ address: vault }), upgradeBalance);
console.log(
  "Queued operation removed after upgrade; rebuilding against the current fleet",
);
const rebuilt = await bundler.prepareUserOperation({
  calls: [{ to: recipient, value: 7n }],
  ...common,
  verificationGasLimit: 200_000n,
});
const rebuiltSignature = await account.signUserOperation(rebuilt);
await assert.rejects(
  () => bundler.sendUserOperation({ ...rebuilt, signature: rebuiltSignature }),
  (error: unknown) => {
    if (!(error instanceof BaseError)) return false;
    const cause = error.walk((item) => item instanceof RpcRequestError);
    return cause instanceof RpcRequestError && cause.code === -32504;
  },
);
// Operator maintenance after this verified governance upgrade, scoped to this account.
await debug.request({
  method: "debug_bundler_setReputation",
  params: [
    [
      {
        address,
        opsSeen: accountReputation.opsSeen,
        opsIncluded: accountReputation.opsIncluded,
      },
    ],
    entryPoint09Address,
  ],
});
const rebuiltHash = await bundler.sendUserOperation({
  ...rebuilt,
  signature: rebuiltSignature,
});
const rebuiltBundle = await debug.request({
  method: "debug_bundler_sendBundleNow",
  params: [],
});
assert.notEqual(rebuiltBundle, `0x${"00".repeat(32)}`);
assert.equal(
  (
    await bundler.waitForUserOperationReceipt({
      hash: rebuiltHash,
      timeout: 30_000,
    })
  ).success,
  true,
);
assert.equal(await client.getBalance({ address: vault }), upgradeBalance - 7n);
assert.equal(await account.getNonce(), pending.nonce + 1n);
await debug.request({
  method: "debug_bundler_setBundlingMode",
  params: ["auto"],
});
console.log(
  JSON.stringify({
    entryPoint: entryPoint09Address,
    canonicalPolicy: "beacon slot rejected",
    alternativePolicy: "per-account notStaked exception; tracing enabled",
    unlistedAccount: "rejected",
    pendingUpgradeUserOpHash: pendingHash,
    pendingUpgrade:
      "removed without execution; account reputation restored by operator; rebuilt operation included",
    rebuiltUserOpHash: rebuiltHash,
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
