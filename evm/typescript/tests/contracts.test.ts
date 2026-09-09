import { expect, test } from "bun:test";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from "viem";
import { tempo } from "viem/chains";
import {
  getSwigCapsule,
  getSwigConfig,
  getSwigConfigFactory,
  getSwigVault,
} from "../src/index.js";

const address = "0x1111111111111111111111111111111111111111";
const robinhood = defineChain({
  id: 4663,
  name: "Robinhood",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:1"] } },
});

test("binds the complete contract surfaces without network activity", () => {
  const client = createPublicClient({ chain: robinhood, transport: http() });
  const config = getSwigConfig(address, client);
  expect(
    config.abi.some(
      (entry) =>
        entry.type === "function" && entry.name === "signV2WithCapsule",
    ),
  ).toBe(true);
  expect(getSwigConfigFactory(address, client).address).toBe(address);
  expect(getSwigVault(address, client).address).toBe(address);
  expect(getSwigCapsule(address, client).address).toBe(address);
});

// Compile-time tests preserve Viem's client, ABI, and chain-specific transaction types.
// The function is intentionally not executed; runtime entry points are exercised on Anvil.
function typeContract(): void {
  const publicClient = createPublicClient({
    chain: tempo,
    transport: http("http://127.0.0.1:1"),
  });
  const walletClient = createWalletClient({
    account: address,
    chain: tempo,
    transport: http("http://127.0.0.1:1"),
  });
  const config = getSwigConfig(address, {
    public: publicClient,
    wallet: walletClient,
  });
  const nonce: Promise<bigint> = config.read.authorizationNonce([0]);
  void nonce;
  void config.write.signV2([0, address, 0n, "0x", "0x"], { feeToken: address });
  // @ts-expect-error role IDs are uint32 numbers, not strings
  void config.read.getRole(["0"]);
  // @ts-expect-error this method is not part of the pinned ABI
  void config.read.createSession();
}
void typeContract;
