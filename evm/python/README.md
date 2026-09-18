# EVM Swig for Python

Thin Web3.py contract bindings, protocol codecs, and a sponsored ERC-4337 v0.9
adapter. This package is currently unpublished. Install from this directory
with `uv sync`, or use `pip install /path/to/evm/python` in your environment.

Your Web3 instance owns the RPC transport and account configuration. Contract
functions return native Web3 contract calls for reading, building transactions,
simulation, events, and submission. Signers and bundler/paymaster workflows stay
in the application and standard Ethereum libraries.

## Bindings and codecs

```python
from web3 import Web3
from swig_evm import get_contract
from swig_evm.roles import decode_role
from swig_evm.permissions import NativeLimit, encode_permission

web3 = Web3(Web3.HTTPProvider("http://127.0.0.1:8545"))
config = get_contract(web3, "SwigConfig", deployed_account_address)
role = decode_role(config.functions.getRole(0).call())
action = encode_permission(NativeLimit(1_000_000))  # base units, uint64
```

Bindings include `SwigConfig`, `SwigConfigFactory`, `SwigVault`, and
`SwigCapsule`. Their JSON ABIs are shipped in the wheel and generated from the
shared snapshot. Use native Web3 contract functions to build and submit direct
transactions; the package does not own keys or transaction orchestration.

Authority, permission, and role codecs share the TypeScript and Rust golden
vectors. See [protocol data](../README.md) for supported variants, recurring
allowance state, and the contract's enforcement boundary. Numeric inputs are
Python integers with checked protocol widths. Unsupported variants and malformed
wire shapes are rejected.

## ERC-4337 v0.9

`swig_evm.smart_account.SwigSmartAccount` encodes SignV2 or capsule execution,
reads the role's EntryPoint nonce, validates a standard JSON-RPC UserOperation
dictionary, and asks the live canonical EntryPoint for its EIP-712 digest.
It checks the configured chain, deployed account code, and the account's current
EntryPoint before returning a digest. Sign it raw with your existing signer;
`personal_sign` adds an incompatible prefix. Web3/ABI errors remain visible to
the caller, while Swig envelope and deployment mismatches raise `CodecError`.

The adapter targets already deployed accounts, sponsored operations, and
secp256k1 roles or active secp256k1 sessions. It accepts standard paymaster fields,
including the optional v0.9 paymaster signature suffix. Obtain current gas and
sponsorship fields through your bundler and paymaster client before hashing.
Counterfactual deployment, self-pay, and other authority signing adapters are
separate work.

Shared-beacon accounts require the agreed compatible mempool policy. A fleet
upgrade can evict queued operations and affect account reputation; the operator
coordinates maintenance, then callers prepare and submit again. The SDK does
not reset reputation or retry an authorization. See the
[integration guide](../typescript/README.md#verification-and-deployment-policy) for the observed Rundler behavior.

## Examples and checks

The [examples folder](examples/README.md) covers wallet creation, adding and reading roles, and direct/sponsored transfers
using standard Web3.py calls. The shared integration
runner executes every scenario against Anvil and Rundler alongside the other languages.

```bash
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run pytest
uv build
```
