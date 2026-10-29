# Swig Protocol SDK

[Documentation](https://build.onswig.com) · [Developer Portal](https://dashboard.onswig.com) · [Developer SDK](https://github.com/anagrambuild/swig-developer-sdk)

Low-level SDKs for building Swig protocol instructions, calling contracts, and
decoding account or contract data. For hosted wallet API flows that prepare
transactions for your application to sign, use the
[Developer SDK](https://github.com/anagrambuild/swig-developer-sdk).

## Packages

| Chain | Language | Packages | Guide |
| --- | --- | --- | --- |
| Solana | TypeScript | `@swig-wallet/classic`, `kit`, `lib`, `coder` | [Solana SDK](solana/README.md) |
| Solana | Rust | `swig-sdk`, `swig-interface` | [Solana SDK](solana/README.md) |
| EVM | TypeScript | `@swig-wallet/evm` | [TypeScript](evm/typescript/README.md) |
| EVM | Rust | `swig-evm` | [Rust](evm/rust/README.md) |
| EVM | Python | `swig-evm` | [Python](evm/python/README.md) |

Each language lives in its own directory under `solana/` or `evm/`. The package
guides cover setup and usage. [EVM protocol notes](evm/README.md) describe
supported authorities, permissions, authorization, and verification.

## Source revisions

- [Solana source mapping](solana/source.json) records the exact `swig-ts` and
  `swig-wallet` revisions copied here. The Rust crates pin their on-chain
  dependencies to the matching `swig-wallet` revision.
- [EVM ABI source](evm/abi/source.json) records the contract revision behind
  the shared ABI snapshot. Update the canonical ABI before regenerating
  language bindings.

Packages are not yet published from this repository. See the chain guides for
local builds and tests.
