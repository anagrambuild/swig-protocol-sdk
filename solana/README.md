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

Rust source builds use the pinned `swig-wallet` revision for their on-chain
dependencies. `swig-sdk` is published from this repository; shared protocol
crates, including `swig-interface`, are published from `swig-wallet`.

## Reservation addresses

Derive a wallet address locally, then activate it later with an external payer.
TypeScript and Rust expose `ReservationV1` for direct Ed25519, secp256k1, and
P-256 owners. See the [reservation guide](https://build.onswig.com/solana/reservation-addresses)
for examples, storage, restoration, and activation requirements.

The reservation APIs are published in version **3.0.0**. Choose the TypeScript
package for your Solana client:

```bash
# Web3.js
npm install @swig-wallet/classic@3.0.0 @solana/web3.js@^1.98.0

# Solana Kit
npm install @swig-wallet/kit@3.0.0 @solana/kit@^2.1.0
```

Rust applications can use the published `swig-sdk` and `swig-interface` 3.0.0
crates. The reservation guide includes the complete Rust dependency setup.

Activation requires a Swig program deployment supporting `CreateReservedV1`.
Verify support on your target cluster before funding a reserved address.

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
