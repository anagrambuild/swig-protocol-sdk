# EVM protocol data

The ABI and codecs target the exact contract revision recorded in
[`abi/source.json`](abi/source.json). Review a deployed contract's version before
binding it. The ABI exposes every entry point, including restricted vault and
capsule methods; a binding does not grant permission to call them.

## Authorities and roles

All three packages encode/decode secp256k1 addresses, secp256r1 public-key coordinates,
Ed25519 public keys with verifier addresses, and ProgramExec verifier addresses.
The codecs validate wire shape, canonical address padding, nonzero authority
fields, and the ProgramExec version. Cryptographic key validity, verifier code,
and signature/proof acceptance remain contract responsibilities.

ProgramExec authorization has a small envelope helper for
`abi.encode(uint32(1), bytes(proof))`. Proof generation is supplied by the caller.
The contract ABI supports bounded sessions. The pure authority/role codecs reject
session variants; use the raw typed contract bindings for session creation and inspection.
Each language also provides a thin sponsored ERC-4337 v0.9 adapter for
already deployed accounts and secp256k1 roles or active sessions.

A decoded role contains its ID, decoded authority, and action count. Decoding
performs no RPC calls. Fetch individual actions through `getAction` and decode
them separately. Role IDs are uint32; action indices/counts are uint16.

## Permissions

The typed models cover the permissions enforced by this contract revision:

| Family | Variants |
| --- | --- |
| Management and broad permissions | All, ManageAuthority, AllButManageAuthority |
| Contract execution | Program(target), ProgramAll |
| Native currency | Limit, RecurringLimit, DestinationLimit, RecurringDestinationLimit |
| Tokens | Limit, RecurringLimit, DestinationLimit, RecurringDestinationLimit |

Native permissions retain the protocol's `Sol*` numeric discriminants in
`PermissionKind`, while typed values use `native`/`Native` names. Raw enum values
such as ProgramScope, SubAccount, Stake*, ProgramCurated, CloseSwigAuthority, and
RecoveryAuthority are identifiers, not a promise of EVM enforcement. Typed
codecs reject these unsupported variants. Raw ABI action tuples remain available
for low-level callers who need to inspect them.

Amounts and recurring fields are unsigned 64-bit base-unit integers (`bigint` in
TypeScript, `u64` in Rust, and checked `int` in Python). Windows and reset timestamps are seconds. Amounts
are not decimal token amounts. Payload integers are little-endian; addresses are
left-padded to 32 bytes. TokenRecurringLimit has its own field order, captured in
the shared fixtures.

Recurring codecs preserve the full stored state, including `lastReset` and the
remaining `currentAmount`. Use `createRecurringLimit(amount, window)` or
`RecurringLimit::new(amount, window)` / Python `RecurringLimit.new(amount, window)`
for a fresh permission: reset zero and the
full allowance available. Re-encoding a fetched permission preserves spent
state; it does not reset an allowance or guarantee that the tuple is valid for
new-role creation. In particular, general native/token recurring permissions
require fresh state when added. Zero windows and remaining amounts above the
recurring allowance are rejected by the codecs.

Permission enforcement belongs to the contract. For example, capsule execution
requires explicit Program or ProgramAll permission; All alone does not authorize
that execution path. The SDK performs no permission inference or policy merging.

## Authorization

Digest entry points and `authorizationNonce(roleId)` are exposed directly.
Callers obtain the applicable digest and supply the protocol authorization bytes
to the matching entry point. For secp256k1 authorization, sign the returned raw
digest; `personal_sign` and its message prefix do not produce that signature.
The SDK neither owns keys nor reserves nonces, retries signatures, or combines a
digest query with submission. Concurrent role/state changes can invalidate an
authorization. Direct EOA authorization uses the contract's empty-byte path.

The contract restricts inbound contract calls. Applications must respect that
boundary when choosing transaction senders or aggregation mechanisms.

## Fixtures

`fixtures/permissions.json` uses distinct integer values and independently
specified little-endian bytes, including amounts above JavaScript's safe integer
range, uint64 maximum, and spent recurring state. All three languages consume the
same vectors. `fixtures/authorities.json` covers the four supported wire shapes;
its coordinate/key placeholders are not cryptographic test vectors.
`fixtures/4337.json` pins Viem-generated SignV2/capsule envelopes and canonical
EntryPoint hash-call data, checked by the Rust and Python adapters.

## Networks and verification

Callers configure the RPC, chain ID, signer, transaction options, and a matching
Swig deployment address through Viem, Alloy, or Web3.py. ABI compatibility does
not prove a deployment exists or that every execution path is supported there.
The type checks include custom and Tempo clients; runtime tests use isolated
Anvil. This repository has not validated live Robinhood or Tempo deployments.

Run `python3 evm/scripts/sync-abis.py` from the repository root after editing
`evm/abi`. CI checks the generated TypeScript, Rust, and Python ABI copies
against that canonical snapshot. Check the packages from the repository root:

```bash
cd evm/typescript
bun install --frozen-lockfile
bun run check
bun run typecheck:integration
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

With Foundry 1.7.1 and a local contracts checkout containing the revision in
[`abi/source.json`](abi/source.json), run the integration suite from the
repository root:

```bash
python3 evm/scripts/test-integration.py --contracts-repo /path/to/swig-dev-portal
```

The runner archives the pinned contract revision, compares ABIs, and tests
factory deployment, role operations, limits, digests, and capsule execution on
disposable Anvil. The contracts repository is private, so this runner is local.
Cryptographic runtime coverage currently uses secp256k1; the other authority
variants have wire-format tests.
For ERC-4337 scenarios, use `evm/scripts/test-4337.sh /path/to/swig-dev-portal`
and the [integration guide](typescript/README.md#verification-and-deployment-policy).
