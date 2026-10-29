# Solana protocol SDK

[Swig developer portal](https://build.onswig.com) · [Source revisions](source.json)

These packages build transactions and decode accounts for the Swig Solana program.
They are source copies from [`swig-ts`](https://github.com/anagrambuild/swig-ts)
and [`swig-wallet`](https://github.com/anagrambuild/swig-wallet). The exact
revisions and path mappings are in [`source.json`](source.json).

| Directory | Packages | Purpose |
| --- | --- | --- |
| [`typescript/`](typescript/) | `@swig-wallet/classic`, `kit`, `lib`, `coder` | TypeScript clients, builders, and codecs |
| [`rust/`](rust/) | `swig-sdk`, `swig-interface` | Rust wallet API and instruction builders |

The Rust crates use the pinned `swig-wallet` revision for their on-chain
dependencies. They are not published from this repository.

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
