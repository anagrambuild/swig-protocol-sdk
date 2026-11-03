---
'@swig-wallet/coder': major
'@swig-wallet/lib': major
'@swig-wallet/kit': major
'@swig-wallet/classic': major
---

Add authorization lock support: the `AddAuthorizationLockV1` (25) and `RemoveAuthorizationLockV1` (26) instructions for Ed25519, Secp256k1, Secp256r1, ProgramExec and session authorities, the `ManageAuthorizationLocks` permission (27) with its `maxDurationSlots` data, and a decoder for the locks stored in the swig config account's tail. Kit and classic gain `getAddAuthorizationLockInstructions`, `getAddSolAuthorizationLockInstructions`, `getAddTokenAuthorizationLockInstructions`, `getRemoveAuthorizationLockInstructions`, `fetchSwigAuthorizationLocks` and `fetchActiveSwigAuthorizationLocks`. Locks follow card-authorization semantics: a lock's `amount` is what is still reserved, other roles may not spend below the locks they do not hold, and the holder's spending captures its locks. Fully captured (amount 0) and expired locks are inactive and prunable; `isAuthorizationLockPrunable`, `getAuthorizationLockReservedAmount` and `getAuthorizationLockAvailableAmount` help apply these rules client-side.

Low-level `removeAuthorizationLock` callers (including `Authority.removeAuthorizationLock`) must now supply `swigSystemAddress`, the derived wallet address. The high-level remove instruction helpers continue to derive it automatically. ProgramExec preinstructions for add/remove must bind that wallet address as their second account. This aligns the previously published lock builders with the current protocol account order and requires a major release of the fixed package group.
