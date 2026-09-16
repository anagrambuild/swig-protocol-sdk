"""Create a wallet controlled by the caller and fund its vault."""

import json
import os

from eth_account import Account
from web3 import Web3
from web3.middleware import SignAndSendRawMiddlewareBuilder

from swig_evm import get_contract
from swig_evm.authorities import Secp256k1, encode_authority
from swig_evm.permissions import SimplePermission, encode_permission

web3 = Web3(Web3.HTTPProvider(os.environ["RPC_URL"]))
signer = Account.from_key(os.environ["SIGNER_PRIVATE_KEY"])
web3.middleware_onion.inject(SignAndSendRawMiddlewareBuilder.build(signer), layer=0)
web3.eth.default_account = signer.address
factory = get_contract(web3, "SwigConfigFactory", os.environ["FACTORY_ADDRESS"])
# The name is public. Identical name/root settings predict the same wallet.
wallet_id = Web3.keccak(text=os.environ["WALLET_NAME"])
args = (
    wallet_id,
    wallet_id,
    *encode_authority(Secp256k1(signer.address)),
    [encode_permission(SimplePermission.ALL)],
)
predicted = factory.functions.computeConfigAddress(*args).call()
hash_value = factory.functions.deploy(*args).transact(
    {"value": int(os.environ["INITIAL_BALANCE_WEI"])}
)
receipt = web3.eth.wait_for_transaction_receipt(hash_value)
if receipt["status"] != 1:
    raise RuntimeError("Wallet creation reverted")
# Decode only the factory's event; initialization also emits account events.
log = next(log for log in receipt["logs"] if log["address"] == factory.address)
deployment = factory.events.SwigDeployed().process_log(log)["args"]
if deployment["config"] != predicted:
    raise RuntimeError("Deployed wallet differs from prediction")
print(
    json.dumps(
        {
            "accountAddress": deployment["config"],
            "vaultAddress": deployment["vault"],
            "capsuleAddress": deployment["capsule"],
            "transactionHash": Web3.to_hex(hash_value),
        }
    )
)
