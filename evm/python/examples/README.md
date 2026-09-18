# Python examples

From `evm/python`, run `uv sync --locked` once.

- `uv run --locked python examples/read_role.py`: reads a role. Set `RPC_URL`,
  `ACCOUNT_ADDRESS`, and optional `ROLE_ID` (default `0`).
- `uv run --locked python examples/erc4337.py`: submits a sponsored one-wei transfer
  on the disposable Compose chain (1337). Also set `BUNDLER_URL`,
  `SIGNER_PRIVATE_KEY`, `RECIPIENT`, and `TEST_PAYMASTER_ADDRESS`.

`../scripts/test-4337.sh /path/to/swig-dev-portal` creates and funds the fixture,
sets the public development key/addresses, and runs both examples. It also runs
the TypeScript and Rust examples, so install Bun, Foundry, Docker, Rust, and uv.

Web3.py owns contract calls and JSON-RPC. `eth-account` owns signing. The adapter
validates the Swig envelope and asks canonical EntryPoint v0.9 for its digest.
The example signs only that prepared operation's digest without a message prefix;
private keys remain in the application and are never printed.

The fixture paymaster is unrestricted. For production, acquire current sponsored
operation fields from your paymaster's supported client before signing, and use
the agreed compatible bundler. The config must already exist and the authority
key must control its chosen secp256k1 role or active session. Nonce coordination
and fleet-upgrade maintenance are explicit caller/operator responsibilities.
