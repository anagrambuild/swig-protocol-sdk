# Solana protocol SDK

[Swig developer portal](https://build.onswig.com) · [Source revisions](source.json)

These packages build transactions and decode accounts for the Swig Solana program.
They are source copies from [`swig-ts`](https://github.com/anagrambuild/swig-ts)
and [`swig-wallet`](https://github.com/anagrambuild/swig-wallet). The exact
revisions and path mappings are in [`source.json`](source.json).

| Directory | Packages | Purpose |
| --- | --- | --- |
| [`typescript/`](typescript/) | `@swig-wallet/classic`, `kit`, `lib`, `coder` | TypeScript clients, builders, and codecs |
| [`rust/`](rust/) | `swig-sdk` | Rust wallet API and instruction builders |

`swig-sdk` is owned and published by this repository. Its `swig-interface` and
`swig-state` dependencies are owned by `swig-wallet`.

### Rust authorization-lock draft

This branch ports the SDK from wallet PR #240 (`24d2969`) and pins the canonical
protocol dependencies to wallet PR #226 (`4628591`). It adds lock permissions,
SOL/token helpers, state reads, and builders for Ed25519, secp256k1, secp256r1,
sessions, and ProgramExec. The holder's spending captures its own holds; other
roles cannot spend their reserved balance. Fully captured and expired records
remain readable until pruned.

The published protocol crates at version 3.0.0 do not contain these APIs. Use
this branch through Git or a local path for review. A registry release needs
matching protocol dependency releases and a major SDK version bump first:
adding a variant to the public `Permission` enum affects exhaustive matches.

CI and `source.json` remain unchanged for this draft. Their Rust fixture pin
still points to the earlier protocol revision, so the existing Rust compatibility
and candidate-package checks do not validate this port. Build local fixtures
from `4628591963a1f6d9196bae67b25fba6c4a9fb0ab` to exercise its tests; record the
fixture revision with any result. Wallet #240's CLI commands remain in
`swig-wallet`; this port does not replace those changes.

## Reservation addresses

Derive a wallet address locally, then activate it later with an external payer.
TypeScript and Rust expose `ReservationV1` for direct Ed25519, secp256k1, and
P-256 owners. See the [reservation guide](https://build.onswig.com/solana/reservation-addresses)
for examples, storage, restoration, and activation requirements.

The TypeScript reservation APIs require a source build. Activation requires a
Swig program deployment supporting `CreateReservedV1`.

## Build and check

From `solana/typescript/`:

```bash
bun install --frozen-lockfile
bun run build
bun run typecheck
bun run lint
bun run format
bun run test:unit
```

From `solana/rust/`:

```bash
cargo check --workspace --locked
cargo fmt --all -- --check
cargo test --workspace --locked
```

The full SDK test suites need Solana program fixtures built from the Rust
revision in `source.json`. From the repository root, with `cargo build-sbf`
installed and a local `swig-wallet` checkout:

```bash
python3 solana/scripts/build-test-programs.py --program-repo /path/to/swig-wallet
cd solana/typescript && bun run test
cd ../rust && cargo test --workspace --locked --features rust_sdk_test
```

The fixture script writes ignored binaries to each language's test workspace.
