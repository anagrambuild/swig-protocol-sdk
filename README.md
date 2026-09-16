# Swig protocol SDK

Thin bindings for Swig contract entry points, with typed authority, permission,
and role codecs. The protocol SDK exposes individual calls. Applications and the
developer SDK own orchestration, composite use cases, signing policy, retries,
transaction submission policy, and deployment selection.

```text
evm/
  abi/          canonical, version-pinned contract ABIs
  typescript/   @swig-wallet/evm, using Viem
  rust/         swig-evm, using Alloy
  python/       swig-evm, using Web3.py
  fixtures/     shared authority, permission, and ERC-4337 wire vectors
  integration/  local contract tests, outside the shipped SDKs
solana/
  typescript/   reserved
  rust/         reserved
  python/       reserved
```

The EVM packages cover `SwigConfig`, `SwigConfigFactory`, `SwigVault`, and
`SwigCapsule`, including reads, writes, digest functions, events, and custom
errors. See the [TypeScript](evm/typescript/README.md),
[Rust](evm/rust/README.md), [Python](evm/python/README.md), and
[protocol data](evm/README.md) documentation. Each language has an `examples/`
folder for reading roles and submitting sponsored ERC-4337 operations.
Packages are currently unpublished.

## Networks

EVM networks share one SDK. Callers supply a Viem client, Alloy provider, or Web3 instance
configured with their RPC, chain ID, signer, and chain-specific transaction
options, plus the address of a matching Swig deployment. ABI compatibility alone
does not establish that a deployment exists or that every execution path is
supported by a network. Chain selection is separate from protocol encoding.

The type tests check custom EVM clients and Tempo-specific clients/providers;
runtime tests use isolated Anvil. Live Robinhood and Tempo deployments have not
been validated by this repository.

## Development

Requires Python 3.11+ with uv, Bun 1.3.13, and Rust 1.97.0 (pinned in `evm`).

```bash
cd evm/typescript
bun install --frozen-lockfile
bun run check
python3 ../scripts/test-typescript-package.py
cd ..
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo package -p swig-evm --locked
cd python
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run pytest
uv build
```

`python3 evm/scripts/sync-abis.py` regenerates the TypeScript ABI constants and
the Rust and Python JSON copies from `evm/abi`. CI checks exact equality; edit the
canonical snapshot first. Both packages include their own ABI files, so builds
do not depend on the source repository or a parent directory.

For runtime tests, install Foundry 1.7.1 and provide a clone of the contracts
repository containing the revision in `evm/abi/source.json`:

```bash
python3 evm/scripts/test-integration.py --contracts-repo /path/to/swig-dev-portal
```

The runner archives that exact revision into a temporary directory, compiles it,
compares all four ABIs, and starts a disposable localhost Anvil node. Both
languages exercise factory address prediction/deployment, role reads and
mutations, native and ERC-20 limits, an exact over-limit rejection, per-role
authorization digests/nonces, and capsule execution. TypeScript also validates
fresh shared permission vectors through the actual Solidity validation library.
Authority cryptographic runtime coverage currently uses secp256k1; the other
authority variants have wire-format tests. Test accounts are public Anvil
accounts and must never hold real assets.

CI runs codec, network type, formatting, lint, build, and package checks. The
runtime runner is local because the pinned contracts repository is private;
the SDK CI has no credential for it.

For ERC-4337 and all three languages' examples, use the Compose runner with
Anvil and Rundler described in the [integration guide](evm/integration/README.md):

```bash
evm/scripts/test-4337.sh /path/to/swig-dev-portal
```
