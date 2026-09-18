# TypeScript examples

From `evm/typescript`, install with `bun install --frozen-lockfile`.

- `bun run examples/read-role.ts`: reads a role using Viem. Set `RPC_URL`,
  `ACCOUNT_ADDRESS`, and optional `ROLE_ID` (default `0`).
- `bun run examples/erc4337.ts`: submits a sponsored native transfer using Viem's
  standard bundler/paymaster clients. Also set `BUNDLER_URL`, `PAYMASTER_URL`,
  `SIGNER_PRIVATE_KEY`, `RECIPIENT`, and optional `VALUE_WEI` (default `1`).

The key must control the chosen secp256k1 role or active session. The config must
already use canonical EntryPoint v0.9 and be registered with the compatible
bundler. Set secrets through your local environment; never commit or log them.
The authority key signs the operation; the paymaster pays its gas.

`TEST_PAYMASTER_ADDRESS` is only for our disposable chain (chain ID 1337). It
uses the unrestricted local fixture sponsor in place of a paymaster service.
`test-4337.sh` runs both examples against that fixture.
