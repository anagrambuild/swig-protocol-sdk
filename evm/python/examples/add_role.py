"""Give a delegate a fixed native-currency spending allowance."""

import json
import os

from eth_account import Account
from web3 import Web3
from web3.middleware import SignAndSendRawMiddlewareBuilder

from swig_evm import get_contract
from swig_evm.authorities import Secp256k1, encode_authority
from swig_evm.permissions import NativeLimit, encode_permission

web3 = Web3(Web3.HTTPProvider(os.environ["RPC_URL"]))
signer = Account.from_key(os.environ["SIGNER_PRIVATE_KEY"])
web3.middleware_onion.inject(SignAndSendRawMiddlewareBuilder.build(signer), layer=0)
web3.eth.default_account = signer.address
config = get_contract(web3, "SwigConfig", os.environ["ACCOUNT_ADDRESS"])
authority = encode_authority(Secp256k1(os.environ["DELEGATE_ADDRESS"]))
hash_value = config.functions.addRole(
    int(os.environ.get("MANAGER_ROLE_ID", "0")),
    *authority,
    [encode_permission(NativeLimit(int(os.environ["LIMIT_WEI"])))],
).transact()
receipt = web3.eth.wait_for_transaction_receipt(hash_value)
if receipt["status"] != 1:
    raise RuntimeError("Role creation reverted")
# The mined event identifies the role even if other managers add roles concurrently.
log = next(log for log in receipt["logs"] if log["address"] == config.address)
event = config.events.RoleAdded().process_log(log)
print(json.dumps({"roleId": event["args"]["roleId"], "transactionHash": Web3.to_hex(hash_value)}))
