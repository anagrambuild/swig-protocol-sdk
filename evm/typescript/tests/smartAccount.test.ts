import { expect, test } from "bun:test";
import {
  type Address,
  createPublicClient,
  custom,
  decodeAbiParameters,
  encodeAbiParameters,
  type Hex,
  hashTypedData,
  parseAbiParameters,
  recoverAddress,
  sliceHex,
  toFunctionSelector,
} from "viem";
import {
  entryPoint08Address,
  getUserOperationTypedData,
  type UserOperation,
} from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import { toSwigSmartAccount } from "../src/index.js";

const address: Address = "0x1111111111111111111111111111111111111111";
const paymaster: Address = "0x2222222222222222222222222222222222222222";
const signer = privateKeyToAccount(`0x${"01".repeat(32)}`);
const requestAbi = parseAbiParameters(
  "(uint8 version, uint32 roleId, uint256 directAuthorizationNonce, address signer, uint48 validAfter, uint48 validUntil, uint8 kind, (address target, uint256 value, bytes data, (address token, uint64 amount)[] tokenFunding, address[] sweepTokens) execution)",
);
const client = createPublicClient({
  chain: anvil,
  transport: custom({
    async request({ method, params }) {
      if (method === "eth_getCode") return "0x6000";
      if (method !== "eth_call") throw new Error(`Unexpected RPC ${method}`);
      const [{ data }] = params as [{ data: Hex }];
      if (data === toFunctionSelector("entryPoint()"))
        return encodeAbiParameters(parseAbiParameters("address"), [
          entryPoint08Address,
        ]);
      if (data.startsWith(toFunctionSelector("authorizationNonce(uint32)")))
        return encodeAbiParameters(parseAbiParameters("uint256"), [7n]);
      const [, key] = decodeAbiParameters(
        parseAbiParameters("address,uint192"),
        sliceHex(data, 4),
      );
      return encodeAbiParameters(parseAbiParameters("uint256"), [
        (key << 64n) + 3n,
      ]);
    },
  }),
});
const options = {
  client,
  address,
  roleId: 2,
  signer,
  validAfter: 10,
  validUntil: 1000,
};

function operation(callData: Hex): UserOperation<"0.8"> {
  return {
    sender: address,
    nonce: (2n << 64n) + 3n,
    callData,
    callGasLimit: 100000n,
    verificationGasLimit: 100000n,
    preVerificationGas: 50000n,
    maxFeePerGas: 2n,
    maxPriorityFeePerGas: 1n,
    paymaster,
    paymasterVerificationGasLimit: 100000n,
    paymasterPostOpGasLimit: 10000n,
    signature: "0x",
  };
}

test("standard SmartAccount uses a fixed role nonce lane and reads direct nonce when encoding", async () => {
  const account = await toSwigSmartAccount(options);
  expect(account.type).toBe("smart");
  expect(account.entryPoint.version).toBe("0.8");
  expect(await account.getFactoryArgs()).toEqual({
    factory: undefined,
    factoryData: undefined,
  });
  expect(await account.getNonce()).toBe((2n << 64n) + 3n);
  expect(await account.getNonce()).toBe((2n << 64n) + 3n);
  await expect(account.getNonce({ key: 3n })).rejects.toThrow("nonce key");
  const callData = await account.encodeCalls([
    { to: paymaster, value: 5n, data: "0x1234" },
  ]);
  const [request] = decodeAbiParameters(requestAbi, sliceHex(callData, 4));
  expect(request).toEqual({
    version: 1,
    roleId: 2,
    directAuthorizationNonce: 7n,
    signer: signer.address,
    validAfter: 10,
    validUntil: 1000,
    kind: 0,
    execution: {
      target: paymaster,
      value: 5n,
      data: "0x1234",
      tokenFunding: [],
      sweepTokens: [],
    },
  });
  await expect(account.encodeCalls([])).rejects.toThrow("exactly one");
  await expect(
    account.encodeCalls([{ to: address }, { to: address }]),
  ).rejects.toThrow("exactly one");
});

test("capsule funding and sweep manifests are explicit and uint64 bounded", async () => {
  const capsule = {
    tokenFunding: [{ token: paymaster, amount: 12n }],
    sweepTokens: [address],
  };
  const account = await toSwigSmartAccount({ ...options, capsule });
  const [request] = decodeAbiParameters(
    requestAbi,
    sliceHex(await account.encodeCalls([{ to: address }]), 4),
  );
  expect(request.kind).toBe(1);
  expect(request.execution.tokenFunding).toEqual(capsule.tokenFunding);
  expect(request.execution.sweepTokens).toEqual(capsule.sweepTokens);
  const tooLarge = await toSwigSmartAccount({
    ...options,
    capsule: {
      ...capsule,
      tokenFunding: [{ token: paymaster, amount: 1n << 64n }],
    },
  });
  await expect(tooLarge.encodeCalls([{ to: address }])).rejects.toThrow();
});

test("signing uses upstream v0.8 typed data and rejects a foreign account, chain, role or envelope", async () => {
  const account = await toSwigSmartAccount(options);
  const op = operation(
    await account.encodeCalls([{ to: paymaster, value: 1n }]),
  );
  const signature = await account.signUserOperation(op);
  const hash = hashTypedData(
    getUserOperationTypedData({
      chainId: anvil.id,
      entryPointAddress: entryPoint08Address,
      userOperation: op,
    }),
  );
  expect(await recoverAddress({ hash, signature })).toBe(signer.address);
  const stub = await account.getStubSignature();
  expect(stub.length).toBe(132);
  expect(await recoverAddress({ hash, signature: stub })).not.toBe(
    signer.address,
  );
  await expect(
    account.signUserOperation({ ...op, sender: paymaster }),
  ).rejects.toThrow("sender");
  await expect(
    account.signUserOperation({ ...op, chainId: 1 }),
  ).rejects.toThrow("chain");
  await expect(account.signUserOperation({ ...op, nonce: 0n })).rejects.toThrow(
    "nonce key",
  );
  await expect(
    account.signUserOperation({ ...op, factory: paymaster }),
  ).rejects.toThrow("deployed account");
  await expect(
    account.signUserOperation({ ...op, paymaster: undefined }),
  ).rejects.toThrow("sponsorship");
  await expect(
    account.signUserOperation({ ...op, callData: `${op.callData}00` }),
  ).rejects.toThrow("does not match");
  await expect(account.signMessage({ message: "hello" })).rejects.toThrow(
    "UserOperation signing only",
  );
});

test("adapter requires valid role and time bounds and a deployed account", async () => {
  await expect(toSwigSmartAccount({ ...options, roleId: -1 })).rejects.toThrow(
    "uint32",
  );
  await expect(
    toSwigSmartAccount({ ...options, validUntil: 0 }),
  ).rejects.toThrow("validity window");
  const emptyClient = createPublicClient({
    chain: anvil,
    transport: custom({ request: async () => "0x" }),
  });
  await expect(
    toSwigSmartAccount({ ...options, client: emptyClient }),
  ).rejects.toThrow("already be deployed");
});
