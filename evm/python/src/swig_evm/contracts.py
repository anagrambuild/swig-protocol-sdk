"""Native Web3.py bindings from the pinned protocol ABI snapshot."""

import json
from importlib.resources import files
from typing import Literal

from web3 import Web3
from web3.contract import Contract

ContractName = Literal["SwigConfig", "SwigConfigFactory", "SwigVault", "SwigCapsule"]


def get_contract(web3: Web3, name: ContractName, address: str) -> Contract:
    if name not in ("SwigConfig", "SwigConfigFactory", "SwigVault", "SwigCapsule"):
        raise ValueError("Unsupported Swig contract")
    abi = json.loads(files("swig_evm").joinpath("abi", f"{name}.json").read_text())
    return web3.eth.contract(address=Web3.to_checksum_address(address), abi=abi)
