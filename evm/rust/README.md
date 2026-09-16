# EVM Swig for Rust

`swig-evm` provides Alloy-generated RPC bindings and concrete protocol codecs.
The crate is currently unpublished. Use a local path dependency on this directory
and configure Alloy's transport/signer features in your application. The SDK's
Alloy dependency enables `std`, `contract`, and `rpc-types`.

With your own configured `provider` and typed contract/delegate addresses:

```rust
use swig_evm::{
    authorities::Authority,
    contracts::config::SwigConfig,
    permissions::Permission,
    roles::Role,
};

let config = SwigConfig::new(config_address, provider);
let role = Role::decode(&config.getRole(0).call().await?)?;
let authority = Authority::Secp256k1 { address: delegate_address }.encode()?;
let action = Permission::NativeLimit { amount: 1_000_000 }.encode()?;

// One entry point. The provider's wallet must control authority role 0.
let pending = config.addRole(
    0, authority.authorityType, authority.key, authority.keyExtra, vec![action],
).send().await?;
```

Other bindings live in `contracts::factory::SwigConfigFactory`,
`contracts::vault::SwigVault`, and `contracts::capsule::SwigCapsule`. Each exposes
Alloy's native builders (`call`, `send`, transaction options, event filters,
generated calldata and custom-error types). Network and transport types remain
those of the supplied provider, including a caller-configured Tempo provider.

Alloy names the factory's Solidity `deploy` entry point **`deploy_call`** to
avoid a generated API name collision. Its action tuple is a distinct generated
type: pass `Permission::All.encode()?.into()` when building a factory action
list. This conversion preserves the tuple exactly. Config entry points consume
the encoder result directly.

`Authority::encode/decode`, `Permission::encode/decode`, `RecurringLimit::new`,
`Role::decode`, and `encode_program_exec_authorization` perform no I/O. They
return `CodecError` for unsupported variants or malformed data. Contract call
errors retain Alloy's standard error types. All role/action IDs and amounts use
the protocol's fixed-width integer types.

See the [shared protocol notes](https://github.com/anagrambuild/swig-protocol-sdk/blob/main/evm/README.md)
for supported permissions/authorities, recurring state, and signing semantics.
The crate does not orchestrate transactions, manage nonce races, or select
deployment addresses. ABI JSON is included in the Cargo package; building it
does not require Solidity tooling or another repository.

## ERC-4337 v0.9

`smart_account::SwigSmartAccount` adds ordinary SignV2 and explicit capsule
UserOperation encoding for deployed secp256k1 roles and active EVM sessions.
`encode_call` takes a fresh direct-authorization nonce and one `CallExecution`.
Read the EntryPoint nonce using `getNonceCall` with the role ID as its key.
`pack_user_operation` converts Alloy's native unpacked RPC operation into the
contract tuple, checking uint128 gas fields and requiring sponsorship.

`user_operation_hash` accepts an Alloy `DynProvider`, verifies the configured
chain and live account EntryPoint, validates the operation envelope, and calls
canonical v0.9 `getUserOpHash`. The caller signs its raw digest with its existing
signer and submits through its bundler client. This keeps v0.9 hashing, including
paymaster suffix handling, in EntryPoint. There is no custom hash implementation,
RPC transport, key custody, nonce reservation, or automatic retry in the SDK.

Validity is Unix seconds within uint47: exclusive start and inclusive nonzero
end. One operation executes one call; capsule funding/sweep manifests are explicit.
Factory creation and account-funded gas are outside this adapter's current scope.
See [runnable examples](examples/README.md) and the TypeScript package's
[deployment policy](../typescript/README.md#verification-and-deployment-policy).
