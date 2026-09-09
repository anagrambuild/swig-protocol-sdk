# EVM Swig ABIs

Language-independent JSON ABIs for the EVM Swig wallet contracts. Each JSON file
contains the compiler-generated ABI array, including functions, events, custom
errors, and constructor or receive entries where applicable.

| File | Contract surface |
| --- | --- |
| `SwigConfigFactory.json` | Wallet deployment and config, vault, and capsule address prediction |
| `SwigConfig.json` | Wallet state, roles, authorization digests, and authorized execution |
| `SwigVault.json` | Vault state and config-controlled execution |
| `SwigCapsule.json` | Capsule state and config-controlled restricted execution |

## Source

- Repository: [anagrambuild/swig-dev-portal](https://github.com/anagrambuild/swig-dev-portal)
- Commit: [`fb538bd12d306d8831987164b8c62a5d5ca67e9d`](https://github.com/anagrambuild/swig-dev-portal/tree/fb538bd12d306d8831987164b8c62a5d5ca67e9d/evm)
- Compiler: Solidity `0.8.35`, with the pinned revision's `evm/foundry.toml`
- Generator: Foundry `forge 1.7.1`, `forge inspect <contract> abi --json`

This snapshot describes the source revision above. Match a deployment's contract
version to the snapshot before using these ABIs against it.

## Regenerate

Requires Git, tar, Foundry, and a local clone of `swig-dev-portal` with access to
the pinned commit. Run from the root of `swig-protocol-sdk`, replacing the source
repository path below. The archive isolates generation from local source edits.

```bash
set -euo pipefail

contract_repo=/path/to/swig-dev-portal
contract_revision=fb538bd12d306d8831987164b8c62a5d5ca67e9d
contract_source_dir=$(mktemp -d)
sdk_abi_dir="$PWD/evm/abi"

git -C "$contract_repo" archive "$contract_revision" evm/src evm/foundry.toml |
  tar -x -C "$contract_source_dir"

forge build --root "$contract_source_dir/evm" --skip test --skip script

for contract in SwigConfigFactory SwigConfig SwigVault SwigCapsule; do
  forge inspect --root "$contract_source_dir/evm" "$contract" abi --json \
    > "$sdk_abi_dir/$contract.json"
done
```

When updating the snapshot, regenerate all four ABIs together and update the
source revision and tool versions here. Review the ABI diff for compatibility
changes before merging.
