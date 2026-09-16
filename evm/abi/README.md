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
- Commit: [`13594ba7899e5be34121f2c985042716d7893c76`](https://github.com/anagrambuild/swig-dev-portal/tree/13594ba7899e5be34121f2c985042716d7893c76/evm)
- Compiler: Solidity `0.8.35`, with the pinned revision's `evm/foundry.toml`
- Generator: Foundry `forge 1.7.1`, `forge inspect <contract> abi --json`

This snapshot describes the source revision above. Match a deployment's contract
version to the snapshot before using these ABIs against it.

## Regenerate

Requires Git, tar, Python 3, npm, Foundry, and a local clone of `swig-dev-portal` with access to
the pinned commit. Run from the root of `swig-protocol-sdk`, replacing the source
repository path below. The archive isolates generation from local source edits.

```bash
set -euo pipefail

contract_repo=/path/to/swig-dev-portal
contract_revision=$(python3 -c 'import json; print(json.load(open("evm/abi/source.json"))["revision"])')
contract_source_dir=$(mktemp -d)
sdk_abi_dir="$PWD/evm/abi"

git -C "$contract_repo" archive "$contract_revision" evm/src evm/foundry.toml evm/package.json evm/package-lock.json |
  tar -x -C "$contract_source_dir"

npm ci --ignore-scripts --prefix "$contract_source_dir/evm"
forge build --root "$contract_source_dir/evm" --skip test --skip script

for contract in SwigConfigFactory SwigConfig SwigVault SwigCapsule; do
  forge inspect --root "$contract_source_dir/evm" "$contract" abi --json \
    > "$sdk_abi_dir/$contract.json"
done
```

When updating the snapshot, regenerate all four ABIs together and update the
source revision and tool versions here, and the machine-readable revision in
`source.json`. Then run `python3 evm/scripts/sync-abis.py` from the SDK root to
refresh both language packages. Review ABI and codec compatibility together
before merging.
