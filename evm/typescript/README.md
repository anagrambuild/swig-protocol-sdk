# EVM Swig for TypeScript

`@swig-wallet/evm` provides typed Viem contract bindings plus pure protocol
codecs. Build locally with `bun install --frozen-lockfile && bun run build`.
Viem is a peer dependency; the package is currently unpublished.

Supply your own configured clients and the address of a matching deployment:

```ts
import { getSwigConfig, decodeRole, encodeAuthority, encodePermission } from "@swig-wallet/evm";

const config = getSwigConfig(configAddress, {
  public: publicClient,
  wallet: walletClient,
});
const role = decodeRole(await config.read.getRole([0]));
const authority = encodeAuthority({ type: "secp256k1", address: delegateAddress });
const action = encodePermission({ type: "nativeLimit", amount: 1_000_000n });

// One entry point. The caller's wallet must control authority role 0.
const hash = await config.write.addRole([
  0, authority.authorityType, authority.key, authority.keyExtra, [action],
]);
```

`getSwigConfigFactory`, `getSwigVault`, and `getSwigCapsule` use the same
`(address, client)` form. Bindings return Viem's native contract objects, so
`read`, `write`, `simulate`, event access, ABI-inferred arguments, and
chain-specific transaction options stay available as supported by the supplied
client. The SDK does not simulate automatically or wait for receipts.

The ABI constants are exported from the package root and `@swig-wallet/evm/abi`.
Use ordinary Viem functions such as `encodeFunctionData` or `decodeErrorResult`
for offline calldata and error handling. There is no separate Swig RPC client or
deployment registry.

`encodeAuthority`/`decodeAuthority`, `encodePermission`/`decodePermission`,
`createRecurringLimit`, `decodeRole`, and `encodeProgramExecAuthorization` are
pure helpers. Malformed protocol data and unsupported variants are rejected;
Viem errors and transaction results otherwise propagate unchanged. See the
[shared protocol notes](https://github.com/anagrambuild/swig-protocol-sdk/blob/main/evm/README.md) for supported variants, recurring state,
authorization bytes, and units. Protocol enums include unsupported wire IDs for
identification; the typed models intentionally exclude those variants.
