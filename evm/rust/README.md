# EVM Swig for Rust

`swig-evm` provides Alloy-generated RPC bindings and concrete protocol codecs.
The crate is currently unpublished. Use a local path dependency on this directory
and configure Alloy's transport/signer features in your application. The SDK's
Alloy dependency enables only `std` and `contract`.

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
