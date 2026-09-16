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

## ERC-4337 adapter

`toSwigSmartAccount` implements Viem's standard Smart Account interface for a
matching, already deployed Swig config and a secp256k1 role or active EVM session
key. Supply your existing signer, public client, and explicit validity window:

```ts
import { toSwigSmartAccount } from "@swig-wallet/evm";
import { createBundlerClient } from "viem/account-abstraction";
import { http } from "viem";

const account = await toSwigSmartAccount({
  client: publicClient,
  address: configAddress,
  roleId: 0,
  signer,
  validAfter: 0,
  validUntil: Math.floor(Date.now() / 1000) + 600,
});
const bundler = createBundlerClient({
  account,
  client: publicClient,
  transport: http(bundlerUrl),
  paymaster: paymasterClient,
});
const hash = await bundler.sendUserOperation({
  calls: [{ to: recipient, value: 1_000n }],
});
const receipt = await bundler.waitForUserOperationReceipt({ hash });
```

The adapter only owns Swig calldata encoding, role-keyed nonce access, stub
signature generation, and upstream v0.8 EIP-712 signing. Existing Viem-compatible
bundler and paymaster clients own fee/gas estimation, sponsorship, submission,
and receipts. There is no Swig bundler client, custom gas estimator, retry loop,
or replacement UserOperation model. Explicit paymaster fields also work through
Viem's ordinary API. Sponsorship is required by the contract.

Each operation contains exactly one call. Omit `capsule` for ordinary SignV2;
provide `capsule: { tokenFunding: [{ token, amount }], sweepTokens: [...] }` for
a capsule call. Manifests are explicit, amounts are uint64 token base units, and
the contract enforces permissions and cleanup. The adapter never infers token
outputs or approvals. Both forms still use `account.encodeCalls` and the same
standard bundler methods.

`validAfter` is exclusive and `validUntil` inclusive; active session expiration
can shorten the deadline. Encoding reads the role's current direct-authorization
nonce. Role changes, session rotation, or signed direct activity can invalidate
a prepared operation; rebuild and re-estimate it through the existing client.
The EntryPoint nonce key is always `roleId`. The SDK does not reserve sequence
numbers, so coordinate concurrent submissions for the same role. Account-funded
gas, counterfactual deployment, batches, direct P-256/Ed25519/ProgramExec
UserOperations, ERC-1271 message signing, and generic typed-data signing are not
supported by this adapter.

### Verification and deployment gate

Run `python3 evm/scripts/test-4337.py --contracts-repo /path/to/swig-dev-portal
--mode alternative` from the SDK root, with Bun, Foundry, npm, and Docker on PATH.
The runner builds the pinned contract revision, starts disposable Geth 1.15.11
and Alto 1.2.7 containers pinned by image digest, deploys the canonical v0.8
EntryPoint, and verifies estimation, signing, submission, receipts, sponsor
charging, normal/capsule/session execution, invalid-signature rejection, and
continued direct SignV2 use. Only public development keys and local funds are
used, and containers are removed afterward.

**Alternative mode disables Alto's ERC-7562 trace checks; it does not prove
public-bundler acceptance.** Strict mode is the default and remains a release
gate. The current beacon proxy reads shared beacon storage during validation.
A separate deployment decision is required before claiming standard-mempool
compatibility. On the tested Alto version, strict submission first failed with
an upstream simulator-result decoding error (`0x99410554`); that failure is not
counted as an expected storage rejection or as a passing test. Gas estimation
with a stub signature succeeded. The runner fails visibly in strict mode and
never falls back automatically.
