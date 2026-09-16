# TypeScript wallet examples

Run from `evm/typescript` after `bun install --frozen-lockfile`. Every example is standalone and uses the
language's native Ethereum library. Set `RPC_URL` to your chain and provide a
`SIGNER_PRIVATE_KEY` for writes. Keep that key in your environment, outside source
and logs. Direct transactions require gas in the signer's EOA.

## 1. Create a wallet

```bash
bun run examples/create-wallet.ts
```

Set `FACTORY_ADDRESS`, `WALLET_NAME`, and `INITIAL_BALANCE_WEI` (zero is allowed).
Use a factory matching the SDK's pinned contracts. The signer becomes root role
0 with All permission; the initial native balance goes into the wallet vault.
The example predicts the config address, waits for creation, checks the emitted
address, and prints `accountAddress`, `vaultAddress`, and `capsuleAddress`.

The name is public and hashed into the wallet ID and deployment salt. Choose a
fresh name for each wallet: identical name/root settings target the same address,
and deploying it twice reverts. Set `ACCOUNT_ADDRESS` to the printed config
address for the next scenarios.

## 2. Add a spending role

```bash
bun run examples/add-role.ts
```

Keep the root signer selected. Set `DELEGATE_ADDRESS` to the new authority's EOA
and `LIMIT_WEI` to its total native-currency allowance (uint64 base units).
`MANAGER_ROLE_ID` defaults to 0 and must authorize role management. The role has
a native spending limit and no management permission. The example reads the
assigned `roleId` from the mined event; set `ROLE_ID` to that value.

## 3. Read a role

```bash
bun run examples/read-role.ts
```

Set `ACCOUNT_ADDRESS` and `ROLE_ID` (default 0). This read needs no signing key
and prints the authority and action count. Individual permissions are available
through the native config binding's `getAction` method and the permission codec.

## 4. Send a transfer

```bash
bun run examples/send-transfer.ts
```

Select the delegate's `SIGNER_PRIVATE_KEY`, retain its `ROLE_ID`, and set
`RECIPIENT` and `VALUE_WEI`. This sends native currency from the wallet's vault
through SignV2 and consumes the role's allowance. The delegate EOA pays gas;
fund its EOA separately from the vault. The example waits for a successful
transaction receipt.

## 5. Send a sponsored transfer

```bash
bun run examples/send-sponsored-transfer.ts
```

Use a deployed account registered with the compatible bundler and a key for its
selected secp256k1 role or active session. Set `BUNDLER_URL`, `ACCOUNT_ADDRESS`,
`ROLE_ID`, `RECIPIENT`, and optional `VALUE_WEI` (default 1). This version uses
ERC-4337 v0.9: the authority signs, and the paymaster pays gas.
Set `PAYMASTER_URL` for the standard Viem paymaster client. On the disposable
chain (1337), use only `TEST_PAYMASTER_ADDRESS` instead; supplying both is rejected.

## Run every scenario locally

From the repository root:

```bash
evm/scripts/test-4337.sh /path/to/swig-dev-portal
```

Install Bun, Foundry, Docker, Rust, and uv first. The runner owns a disposable
Anvil/Rundler deployment and public development keys. It creates a fresh wallet
per language, adds a limited delegate, reads that role, sends as the delegate,
and verifies balances and remaining allowance. Sponsored transfers use the
separately registered fixture account and verify successful inclusion. All 15
examples run; no real wallet or production paymaster is used.
