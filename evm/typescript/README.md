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
signature generation, and upstream v0.9 EIP-712 signing. The account must already
use the canonical v0.9 EntryPoint; older releases are rejected explicitly and
require a governance-controlled fleet upgrade before using this adapter. Existing Viem-compatible
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

`validAfter` is exclusive and `validUntil` inclusive; both are Unix seconds in the uint47 range (the v0.9 block-number flag is unsupported); active session expiration
can shorten the deadline. Encoding reads the role's current direct-authorization
nonce. Role changes, session rotation, or signed direct activity can invalidate
a prepared operation; rebuild and re-estimate it through the existing client.
The EntryPoint nonce key is always `roleId`. The SDK does not reserve sequence
numbers, so coordinate concurrent submissions for the same role. Account-funded
gas, counterfactual deployment, batches, direct P-256/Ed25519/ProgramExec
UserOperations, ERC-1271 message signing, and generic typed-data signing are not
supported by this adapter.

### Verification and deployment policy

Run from the SDK root, with Bun, Foundry, npm, Docker, and Solidity 0.8.28 installed:

```sh
python3 evm/scripts/test-4337.py --contracts-repo /path/to/swig-dev-portal \
  --solc09 /path/to/solc-0.8.28
```

The runner builds the pinned contract revision and deploys the official v0.9
EntryPoint from source, with its release compiler settings and CREATE2 salt.
It verifies the canonical address `0x433709009B8330FDa32311DF1C2AFA402eD8D009`.
Geth 1.15.11 and Rundler 0.11.0 are pinned by image digest. Public development
keys and disposable local funds are used; processes and containers are removed
when the run ends.

Two unmodified Rundler instances run with tracing enabled. Canonical policy
must reject the shared beacon's slot-zero read with the specific RPC error and
storage location. The compatible instance adds a `notStaked` exception for one
explicitly registered Swig account address. It verifies ordinary/capsule/session
operations, stub estimation, real signing, sponsor charges, included-failure
rollback and nonce consumption, invalid-signature rejection, and direct SignV2.
An unregistered account on the same beacon must remain rejected. A submitted
operation is held in the mempool while governance upgrades the shared beacon;
both active and inactive accounts pick up the new modules, and the compatible
pending operation completes after the upgrade.

The account exception is broader than permitting only beacon slot zero: Rundler
treats that registered account as staked for validation/reputation rules. Other
validation checks remain enabled. This is an explicit private/alternative-mempool
policy, not canonical public-mempool support. Register only verified Swig account
addresses, review the trusted beacon governance and each implementation release,
and revalidate pending operations after upgrades. Do not use a wildcard exception,
`--unsafe`, or `--enable_unsafe_fallback` as a production substitute.

The [accepted design](https://app.notion.com/p/3d17eb3c766d8172b6aaef6ccd59aad2)
retains fleet-wide shared-beacon upgrades and accepts compatible-bundler routing.
This local test does not select a hosted provider, deploy a production bundler,
or establish a production paymaster policy. Before rollout, verify the actual
chain's EntryPoint code, register the fleet in the chosen bundler policy, and test
the real sponsor. The fixture sponsor is deliberately unrestricted and is never
suitable for real funds. Changing EntryPoint requires rebuilding and re-signing
pending operations and separately handling old EntryPoint deposits/nonces.
