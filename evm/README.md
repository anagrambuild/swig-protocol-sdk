# EVM protocol data

The ABI and codecs target the exact contract revision recorded in
[`abi/source.json`](abi/source.json). Review a deployed contract's version before
binding it. The ABI exposes every entry point, including restricted vault and
capsule methods; a binding does not grant permission to call them.

## Authorities and roles

Both packages encode/decode secp256k1 addresses, secp256r1 public-key coordinates,
Ed25519 public keys with verifier addresses, and ProgramExec verifier addresses.
The codecs validate wire shape, canonical address padding, nonzero authority
fields, and the ProgramExec version. Cryptographic key validity, verifier code,
and signature/proof acceptance remain contract responsibilities.

ProgramExec authorization has a small envelope helper for
`abi.encode(uint32(1), bytes(proof))`. Proof generation is supplied by the caller.
The contract ABI supports bounded sessions. The pure authority/role codecs retain
session discriminants for identification but still reject session variants;
use the raw typed contract bindings for session creation and inspection. The
TypeScript Smart Account adapter accepts an already active EVM session key.

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
TypeScript and `u64` in Rust). Windows and reset timestamps are seconds. Amounts
are not decimal token amounts. Payload integers are little-endian; addresses are
left-padded to 32 bytes. TokenRecurringLimit has its own field order, captured in
the shared fixtures.

Recurring codecs preserve the full stored state, including `lastReset` and the
remaining `currentAmount`. Use `createRecurringLimit(amount, window)` or
`RecurringLimit::new(amount, window)` for a fresh permission: reset zero and the
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
range, uint64 maximum, and spent recurring state. Both languages consume the
same vectors. `fixtures/authorities.json` covers the four supported wire shapes;
its coordinate/key placeholders are not cryptographic test vectors.
