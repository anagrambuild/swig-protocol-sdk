import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bytesToHex, createPublicClient, getAddress, http } from "viem";
import { entryPoint09Abi, entryPoint09Address } from "viem/account-abstraction";
import { mnemonicToAccount } from "viem/accounts";
import { decodePermission, decodeRole, getSwigConfig } from "../src/index.js";

type Language = "typescript" | "rust" | "python";
const evm = fileURLToPath(new URL("../../", import.meta.url));
const { RPC_URL, ACCOUNT_ADDRESS, SWIG_TEST_BUNDLER_CONTEXT } = process.env;
assert(RPC_URL && ACCOUNT_ADDRESS && SWIG_TEST_BUNDLER_CONTEXT);
const deployment: unknown = JSON.parse(
  await readFile(SWIG_TEST_BUNDLER_CONTEXT, "utf8"),
);
assert(
  deployment &&
    typeof deployment === "object" &&
    "factory" in deployment &&
    typeof deployment.factory === "string",
);
const factory = getAddress(deployment.factory);
const registeredAccount = getAddress(ACCOUNT_ADDRESS);
const client = createPublicClient({ transport: http(RPC_URL) });
assert.equal(await client.getChainId(), 1337);
// Public, disposable development accounts. No user key is used by this test.
const mnemonic = "test test test test test test test test test test test junk";
const owner = mnemonicToAccount(mnemonic, { addressIndex: 1 });
const delegate = mnemonicToAccount(mnemonic, { addressIndex: 2 });
const recipient = mnemonicToAccount(mnemonic, { addressIndex: 3 }).address;
const ownerKey = owner.getHdKey().privateKey;
const delegateKey = delegate.getHdKey().privateKey;
assert(ownerKey && delegateKey);
const ownerKeyHex = bytesToHex(ownerKey);
const delegateKeyHex = bytesToHex(delegateKey);

async function runExample(
  language: Language,
  scenario: string,
  environment: Record<string, string>,
): Promise<string> {
  const command =
    language === "typescript"
      ? ["bun", "run", `examples/${scenario.replaceAll("_", "-")}.ts`]
      : language === "rust"
        ? [
            "cargo",
            "run",
            "--quiet",
            "--locked",
            "-p",
            "swig-evm",
            "--example",
            scenario,
          ]
        : ["uv", "run", "--locked", "python", `examples/${scenario}.py`];
  const child = Bun.spawn(command, {
    cwd: language === "rust" ? evm : `${evm}/${language}`,
    env: { ...process.env, ...environment },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert.equal(code, 0, `${language}/${scenario} failed:\n${stderr}`);
  return stdout;
}

const languages: Language[] = ["typescript", "rust", "python"];
test.each(languages)(
  "%s wallet scenarios",
  async (language) => {
    const environment = {
      FACTORY_ADDRESS: factory,
      WALLET_NAME: `${language}-wallet-example`,
      INITIAL_BALANCE_WEI: "1000000",
      SIGNER_PRIVATE_KEY: ownerKeyHex,
      DELEGATE_ADDRESS: delegate.address,
      LIMIT_WEI: "100",
      MANAGER_ROLE_ID: "0",
      RECIPIENT: recipient,
      VALUE_WEI: "7",
    };
    const created: unknown = JSON.parse(
      await runExample(language, "create_wallet", environment),
    );
    assert(
      created &&
        typeof created === "object" &&
        "accountAddress" in created &&
        typeof created.accountAddress === "string",
    );
    const accountAddress = getAddress(created.accountAddress);
    const config = getSwigConfig(accountAddress, client);
    assert.deepEqual(decodeRole(await config.read.getRole([0])).authority, {
      type: "secp256k1",
      address: owner.address,
    });
    const vault = await config.read.vault();
    assert.equal(await client.getBalance({ address: vault }), 1_000_000n);
    const added: unknown = JSON.parse(
      await runExample(language, "add_role", {
        ...environment,
        ACCOUNT_ADDRESS: accountAddress,
      }),
    );
    assert(
      added &&
        typeof added === "object" &&
        "roleId" in added &&
        typeof added.roleId === "number",
    );
    const roleId = added.roleId;
    assert.deepEqual(
      decodeRole(await config.read.getRole([roleId])).authority,
      { type: "secp256k1", address: delegate.address },
    );
    assert.deepEqual(
      decodePermission(await config.read.getAction([roleId, 0])),
      { type: "nativeLimit", amount: 100n },
    );
    const roleEnvironment = {
      ...environment,
      ACCOUNT_ADDRESS: accountAddress,
      ROLE_ID: String(roleId),
      SIGNER_PRIVATE_KEY: delegateKeyHex,
    };
    await runExample(language, "read_role", roleEnvironment);
    const before = await client.getBalance({ address: recipient });
    await runExample(language, "send_transfer", roleEnvironment);
    assert.equal(await client.getBalance({ address: recipient }), before + 7n);
    assert.equal(await client.getBalance({ address: vault }), 999_993n);
    assert.deepEqual(
      decodePermission(await config.read.getAction([roleId, 0])),
      { type: "nativeLimit", amount: 93n },
    );
    // Sponsored submission additionally needs operator registration. Use the registered fixture.
    await runExample(language, "send_sponsored_transfer", {
      ...environment,
      ACCOUNT_ADDRESS: registeredAccount,
      ROLE_ID: "0",
    });
    assert.equal(await client.getBalance({ address: recipient }), before + 14n);
  },
  120_000,
);

test("permissionless sponsored transfer", async () => {
  const sponsor = process.env.TEST_PAYMASTER_ADDRESS;
  assert(sponsor);
  const paymaster = getAddress(sponsor);
  const config = getSwigConfig(registeredAccount, client);
  const vault = await config.read.vault();
  const recipientBefore = await client.getBalance({ address: recipient });
  const vaultBefore = await client.getBalance({ address: vault });
  const nonceBefore = await client.readContract({
    address: entryPoint09Address,
    abi: entryPoint09Abi,
    functionName: "getNonce",
    args: [registeredAccount, 0n],
  });
  const sponsorBefore = await client.readContract({
    address: entryPoint09Address,
    abi: entryPoint09Abi,
    functionName: "balanceOf",
    args: [paymaster],
  });
  await runExample("typescript", "send_sponsored_transfer_permissionless", {
    ACCOUNT_ADDRESS: registeredAccount,
    SIGNER_PRIVATE_KEY: ownerKeyHex,
    ROLE_ID: "0",
    RECIPIENT: recipient,
    VALUE_WEI: "7",
  });
  assert.equal(
    await client.getBalance({ address: recipient }),
    recipientBefore + 7n,
  );
  assert.equal(await client.getBalance({ address: vault }), vaultBefore - 7n);
  assert.equal(
    await client.readContract({
      address: entryPoint09Address,
      abi: entryPoint09Abi,
      functionName: "getNonce",
      args: [registeredAccount, 0n],
    }),
    nonceBefore + 1n,
  );
  assert(
    (await client.readContract({
      address: entryPoint09Address,
      abi: entryPoint09Abi,
      functionName: "balanceOf",
      args: [paymaster],
    })) < sponsorBefore,
  );
}, 120_000);
