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
  python/       reserved
  fixtures/     shared authority and permission wire vectors
  integration/  local contract tests, outside the shipped SDKs
solana/
  typescript/   reserved
  rust/         reserved
  python/       reserved
```

The EVM packages cover `SwigConfig`, `SwigConfigFactory`, `SwigVault`, and
`SwigCapsule`, including reads, writes, digest functions, events, and custom
errors. See the [TypeScript](evm/typescript/README.md),
[Rust](evm/rust/README.md), and [protocol data](evm/README.md) documentation.
Packages are currently unpublished and have publishing disabled.

## Networks

EVM networks share one SDK. Callers supply a Viem client or Alloy provider
configured with their RPC, chain ID, signer, and chain-specific transaction
options, plus the address of a matching Swig deployment. ABI compatibility alone
does not establish that a deployment exists or that every execution path is
supported by a network. Chain selection is separate from protocol encoding.

The type tests check custom EVM clients and Tempo-specific clients/providers;
runtime tests use isolated Anvil. Live Robinhood and Tempo deployments have not
been validated by this repository.

## Development

Requires Python 3, Bun 1.3.13, and Rust 1.97.0 (pinned in `evm`).

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
```

`python3 evm/scripts/sync-abis.py` regenerates the TypeScript ABI constants and
the crate-local JSON copies from `evm/abi`. CI checks exact equality; edit the
canonical snapshot first. Rust packages include their own ABI files, so builds
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
