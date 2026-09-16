"""Send native currency from the vault, directly as the role's authority."""

import json
import os

from eth_account import Account
from web3 import Web3
from web3.middleware import SignAndSendRawMiddlewareBuilder

from swig_evm import get_contract

web3 = Web3(Web3.HTTPProvider(os.environ["RPC_URL"]))
signer = Account.from_key(os.environ["SIGNER_PRIVATE_KEY"])
web3.middleware_onion.inject(SignAndSendRawMiddlewareBuilder.build(signer), layer=0)
web3.eth.default_account = signer.address
config = get_contract(web3, "SwigConfig", os.environ["ACCOUNT_ADDRESS"])
# Empty authorization selects direct EOA authentication; the caller pays gas.
hash_value = config.functions.signV2(
    int(os.environ.get("ROLE_ID", "0")),
    Web3.to_checksum_address(os.environ["RECIPIENT"]),
    int(os.environ["VALUE_WEI"]),
    b"",
    b"",
).transact()
receipt = web3.eth.wait_for_transaction_receipt(hash_value)
if receipt["status"] != 1:
    raise RuntimeError("Transfer reverted")
print(json.dumps({"transactionHash": Web3.to_hex(hash_value)}))
