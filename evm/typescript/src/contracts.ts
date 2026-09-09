import {
  type Address,
  type GetContractParameters,
  type GetContractReturnType,
  getContract,
} from "viem";
import {
  swigCapsuleAbi,
  swigConfigAbi,
  swigConfigFactoryAbi,
  swigVaultAbi,
} from "./abi.js";

/** Bind exactly the SwigConfig ABI to the caller's configured Viem client(s). */
export function getSwigConfig<TClient extends GetContractParameters["client"]>(
  address: Address,
  client: TClient,
): GetContractReturnType<typeof swigConfigAbi, TClient> {
  return getContract({ address, abi: swigConfigAbi, client });
}

export function getSwigConfigFactory<
  TClient extends GetContractParameters["client"],
>(
  address: Address,
  client: TClient,
): GetContractReturnType<typeof swigConfigFactoryAbi, TClient> {
  return getContract({ address, abi: swigConfigFactoryAbi, client });
}

export function getSwigVault<TClient extends GetContractParameters["client"]>(
  address: Address,
  client: TClient,
): GetContractReturnType<typeof swigVaultAbi, TClient> {
  return getContract({ address, abi: swigVaultAbi, client });
}

export function getSwigCapsule<TClient extends GetContractParameters["client"]>(
  address: Address,
  client: TClient,
): GetContractReturnType<typeof swigCapsuleAbi, TClient> {
  return getContract({ address, abi: swigCapsuleAbi, client });
}
