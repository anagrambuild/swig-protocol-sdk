---
'@swig-wallet/coder': minor
'@swig-wallet/lib': minor
'@swig-wallet/classic': minor
'@swig-wallet/kit': minor
---

Add local reservation V1 packages, canonical owner validation, address derivation,
and CreateReservedV1 instruction builders for Classic and Kit. Activation requires
a Swig deployment supporting CreateReservedV1; P-256 owners require a 600,000-unit
transaction compute budget.

Restrict reservation owner types to direct Ed25519, secp256k1, and P-256 owners.
Classic reservations return Web3.js PublicKey addresses, and Kit reservations
return Kit Address values, including when loading saved packages.

Route native ESM imports and CommonJS requires to their matching runtime and
type declaration entrypoints so the reservation APIs work from packed packages.
