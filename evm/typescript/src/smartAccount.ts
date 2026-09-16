import {
  type Address,
  type Chain,
  concatHex,
  decodeAbiParameters,
  encodeAbiParameters,
  isAddressEqual,
  type LocalAccount,
  type PublicClient,
  parseAbiParameters,
  sliceHex,
  type Transport,
  toFunctionSelector,
  zeroAddress,
} from "viem";
import {
  entryPoint09Abi,
  entryPoint09Address,
  getUserOperationTypedData,
  type SmartAccount,
  type SmartAccountImplementation,
  toSmartAccount,
} from "viem/account-abstraction";
import { swigConfigAbi } from "./abi.js";

const requestAbi = parseAbiParameters(
  "(uint8 version, uint32 roleId, uint256 directAuthorizationNonce, address signer, uint48 validAfter, uint48 validUntil, uint8 kind, (address target, uint256 value, bytes data, (address token, uint64 amount)[] tokenFunding, address[] sweepTokens) execution)",
);
const executeSelector = toFunctionSelector(
  "executeUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32)",
);
// Well-formed ECDSA placeholder, never an authorization for the requested operation.
const stubSignature =
  `0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798${"22".repeat(32)}1b` as const;

export type SwigSmartAccount = SmartAccount<
  SmartAccountImplementation<typeof entryPoint09Abi, "0.9">
>;

export type ToSwigSmartAccountParameters = {
  client: PublicClient<Transport, Chain>;
  address: Address;
  roleId: number;
  signer: Pick<LocalAccount, "address" | "signTypedData">;
  /** Unix seconds: exclusive start, inclusive nonzero deadline. */
  validAfter: number;
  validUntil: number;
  /** Omit for ordinary SignV2. Capsule manifests must be explicit. */
  capsule?: {
    tokenFunding: readonly { token: Address; amount: bigint }[];
    sweepTokens: readonly Address[];
  };
};

/** Adapt an already deployed Swig config to Viem's standard bundler/paymaster clients. */
export async function toSwigSmartAccount(
  parameters: ToSwigSmartAccountParameters,
): Promise<SwigSmartAccount> {
  const { client, address, roleId, signer, validAfter, validUntil, capsule } =
    parameters;
  if (!Number.isInteger(roleId) || roleId < 0 || roleId > 0xffffffff)
    throw new Error("Swig roleId must fit uint32");
  if (
    !Number.isInteger(validAfter) ||
    !Number.isInteger(validUntil) ||
    validAfter < 0 ||
    validUntil <= validAfter ||
    validUntil > 0x7fffffffffff
  )
    throw new Error(
      "Swig requires an explicit uint47 timestamp validity window",
    );
  if (!(await client.getCode({ address })))
    throw new Error("Swig account must already be deployed");
  const entryPoint = await client.readContract({
    address,
    abi: swigConfigAbi,
    functionName: "entryPoint",
  });
  if (!isAddressEqual(entryPoint, entryPoint09Address))
    throw new Error(
      "Swig account must use the canonical EntryPoint v0.9 release",
    );
  const roleKey = BigInt(roleId);
  const unsupported = async (): Promise<never> => {
    throw new Error("Swig account supports UserOperation signing only");
  };
  return toSmartAccount({
    client,
    entryPoint: { address: entryPoint, abi: entryPoint09Abi, version: "0.9" },
    getAddress: async () => address,
    getFactoryArgs: async () => ({}),
    // Viem defaults to independent time-based keys. Swig deliberately has one lane per role.
    nonceKeyManager: {
      consume: async () => roleId,
      get: async () => roleId,
      increment: () => {},
      reset: () => {},
    },
    async getNonce({ key } = {}) {
      if (key !== undefined && key !== roleKey)
        throw new Error("Swig nonce key must equal roleId");
      return client.readContract({
        address: entryPoint,
        abi: entryPoint09Abi,
        functionName: "getNonce",
        args: [address, roleKey],
      });
    },
    async encodeCalls(calls) {
      if (calls.length !== 1 || !calls[0])
        throw new Error("Swig supports exactly one call per UserOperation");
      const call = calls[0];
      const directAuthorizationNonce = await client.readContract({
        address,
        abi: swigConfigAbi,
        functionName: "authorizationNonce",
        args: [roleId],
      });
      return concatHex([
        executeSelector,
        encodeAbiParameters(requestAbi, [
          {
            version: 1,
            roleId,
            directAuthorizationNonce,
            signer: signer.address,
            validAfter,
            validUntil,
            kind: capsule ? 1 : 0,
            execution: {
              target: call.to,
              value: call.value ?? 0n,
              data: call.data ?? "0x",
              tokenFunding: capsule?.tokenFunding ?? [],
              sweepTokens: capsule?.sweepTokens ?? [],
            },
          },
        ]),
      ]);
    },
    getStubSignature: async () => stubSignature,
    signMessage: unsupported,
    signTypedData: unsupported,
    async signUserOperation(operation) {
      if (
        operation.chainId !== undefined &&
        operation.chainId !== client.chain.id
      )
        throw new Error(
          "Swig UserOperation chain differs from the configured client",
        );
      if (operation.sender && !isAddressEqual(operation.sender, address))
        throw new Error("Swig UserOperation sender differs from this account");
      if (
        operation.factory ||
        operation.authorization ||
        operation.nonce >> 64n !== roleKey
      )
        throw new Error(
          "Swig requires a deployed account and its role nonce key",
        );
      if (!operation.paymaster || operation.paymaster === zeroAddress)
        throw new Error("Swig UserOperation requires sponsorship");
      if (sliceHex(operation.callData, 0, 4) !== executeSelector)
        throw new Error("Invalid Swig execution selector");
      const payload = sliceHex(operation.callData, 4);
      const [request] = decodeAbiParameters(requestAbi, payload);
      if (
        encodeAbiParameters(requestAbi, [request]).toLowerCase() !==
          payload.toLowerCase() ||
        request.version !== 1 ||
        request.roleId !== roleId ||
        !isAddressEqual(request.signer, signer.address) ||
        request.validAfter !== validAfter ||
        request.validUntil !== validUntil ||
        request.kind !== (capsule ? 1 : 0)
      )
        throw new Error("UserOperation does not match this Swig adapter");
      return signer.signTypedData(
        getUserOperationTypedData({
          chainId: client.chain.id,
          entryPointAddress: entryPoint,
          userOperation: { ...operation, sender: address },
        }),
      );
    },
  });
}
