"""Read a deployed role using native Web3.py contract calls."""

import os

from web3 import Web3

from swig_evm.contracts import get_contract
from swig_evm.roles import decode_role

web3 = Web3(Web3.HTTPProvider(os.environ["RPC_URL"]))
config = get_contract(web3, "SwigConfig", os.environ["ACCOUNT_ADDRESS"])
print(decode_role(config.functions.getRole(int(os.environ.get("ROLE_ID", "0"))).call()))
