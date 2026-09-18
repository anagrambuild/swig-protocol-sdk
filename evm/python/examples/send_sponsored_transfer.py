"""Sponsored native transfer on the disposable Compose chain."""

import os
import time

from eth_account import Account
from web3 import Web3

from swig_evm.contracts import get_contract
from swig_evm.smart_account import ENTRY_POINT_V09, CallExecution, SwigSmartAccount, UserOperation

web3 = Web3(Web3.HTTPProvider(os.environ["RPC_URL"]))
bundler = Web3(Web3.HTTPProvider(os.environ["BUNDLER_URL"]))
if web3.eth.chain_id != 1337:
    raise RuntimeError("This example requires the disposable chain and its fixture paymaster")
signer = Account.from_key(os.environ["SIGNER_PRIVATE_KEY"])
address = Web3.to_checksum_address(os.environ["ACCOUNT_ADDRESS"])
role_id = int(os.environ.get("ROLE_ID", "0"))
config = get_contract(web3, "SwigConfig", address)
block = web3.eth.get_block("latest")
account = SwigSmartAccount(address, 1337, role_id, signer.address, 0, block["timestamp"] + 600)
calldata = account.encode_call(
    config.functions.authorizationNonce(role_id).call(),
    CallExecution(
        Web3.to_checksum_address(os.environ["RECIPIENT"]),
        value=int(os.environ.get("VALUE_WEI", "1")),
    ),
)
priority_fee = web3.eth.max_priority_fee
operation: UserOperation = {
    "sender": address,
    "nonce": hex(account.get_nonce(web3)),
    "callData": Web3.to_hex(calldata),
    "callGasLimit": hex(500_000),
    "verificationGasLimit": hex(200_000),
    "preVerificationGas": hex(100_000),
    "maxFeePerGas": hex(2 * block["baseFeePerGas"] + priority_fee),
    "maxPriorityFeePerGas": hex(priority_fee),
    "paymaster": Web3.to_checksum_address(os.environ["TEST_PAYMASTER_ADDRESS"]),
    "paymasterVerificationGasLimit": hex(100_000),
    "paymasterPostOpGasLimit": hex(50_000),
    "paymasterData": "0x",
    "signature": "0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
    + "22" * 32
    + "1b",
}
# Use Web3.py's existing JSON-RPC manager, not a Swig transport or retry client.
estimate = bundler.manager.request_blocking(
    "eth_estimateUserOperationGas", [operation, ENTRY_POINT_V09]
)
operation["callGasLimit"] = estimate["callGasLimit"]
operation["preVerificationGas"] = estimate["preVerificationGas"]
operation["verificationGasLimit"] = hex(max(200_000, int(estimate["verificationGasLimit"], 16)))
digest = account.user_operation_hash(web3, operation)
# Only sign this locally prepared operation's verified EntryPoint digest, without a message prefix.
operation["signature"] = Web3.to_hex(signer.unsafe_sign_hash(digest).signature)
hash_value = bundler.manager.request_blocking("eth_sendUserOperation", [operation, ENTRY_POINT_V09])
if hash_value.lower() != Web3.to_hex(digest).lower():
    raise RuntimeError("Bundler hash differs from EntryPoint")
for _ in range(120):
    receipt = bundler.manager.request_blocking("eth_getUserOperationReceipt", [hash_value])
    if receipt is not None:
        if not receipt["success"] or receipt["userOpHash"].lower() != hash_value.lower():
            raise RuntimeError("UserOperation receipt did not confirm success")
        print(f"UserOperation included: {hash_value}")
        break
    time.sleep(0.25)
else:
    raise TimeoutError("UserOperation receipt timed out")
