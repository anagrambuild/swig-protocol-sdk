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

## Reservation addresses

Reserve a wallet locally from a direct Ed25519, secp256k1, or P-256 public key,
then activate it with an external payer. Both languages use the canonical
`ReservationV1` package from `swig-wallet`.

```typescript
import { type PublicKey } from '@solana/web3.js';
import {
  AuthorityType,
  ReservationV1,
  SWIG_PROGRAM_ADDRESS_STRING,
} from '@swig-wallet/classic';

export async function reserveWallet(owner: PublicKey) {
  const reservation = ReservationV1.create({
    programId: SWIG_PROGRAM_ADDRESS_STRING,
    authorityType: AuthorityType.Ed25519,
    publicKey: owner.toBytes(),
    addressOptions: { accountIndex: 0 },
  });
  return {
    packageBytes: reservation.toBytes(),
    ...(await reservation.addresses()),
  };
}
```

- Save the exact package bytes and the verified `walletAddress`. Restore with
  `ReservationV1.fromBytes(bytes, expectedProgramId)` and compare the derived
  wallet address with your trusted record.
- Classic and Kit expose `getCreateReservedSwigInstruction({ reservation, payer })`.
  They build an instruction without RPC or submission. For P-256 owners, include
  a 600,000-unit compute-budget instruction in the activation transaction.
- Rust exposes `swig_sdk::reservation::ReservationV1` and
  `SwigWallet::from_reservation` for activation or opening an existing wallet.
- Use `swigAddress` to fetch the config and `walletAddress` for deposits. A
  reservation commitment passed to legacy `findSwigPda` produces a different
  wallet. Reserved wallets require V2 subaccounts; use Rust for that flow.

Activation requires a program deployment supporting `CreateReservedV1`. These
APIs are available from source; verify your package and deployment versions.
See the [reservation guide](https://build.onswig.com/solana/reservation-addresses)
for storage, restoration, activation, and Rust examples.

## Build and check

From `solana/typescript/`:

```bash
bun install --frozen-lockfile
bun run build
bun run typecheck
bun run lint
bun run format
bun run test:unit
bun test packages/lib/tests/reservation packages/classic/tests/reservation.test.ts packages/kit/tests/reservation.test.ts
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
