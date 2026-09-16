"""Swig's sponsored v0.9 envelope; Web3.py owns RPC and EntryPoint owns hashing."""

from dataclasses import dataclass
import re
from typing import Literal, NotRequired, TypedDict

from eth_abi import decode, encode
from web3 import Web3

from .codec import CodecError, uint
from .contracts import get_contract

ENTRY_POINT_V09 = Web3.to_checksum_address("0x433709009B8330FDa32311DF1C2AFA402eD8D009")
MAX_TIMESTAMP = (1 << 47) - 1
EXECUTE_SELECTOR = bytes.fromhex("8dd7712f")
REQUEST_ABI = "(uint8,uint32,uint256,address,uint48,uint48,uint8,(address,uint256,bytes,(address,uint64)[],address[]))"
PACKED_ABI = "(address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)"


class UserOperation(TypedDict):
    """Standard unpacked JSON-RPC fields, using hex quantities and hex data."""

    sender: str
    nonce: str
    callData: str
    callGasLimit: str
    verificationGasLimit: str
    preVerificationGas: str
    maxFeePerGas: str
    maxPriorityFeePerGas: str
    signature: str
    paymaster: str
    paymasterVerificationGasLimit: str
    paymasterPostOpGasLimit: str
    paymasterData: NotRequired[str]
    factory: NotRequired[str]
    factoryData: NotRequired[str]
    eip7702Auth: NotRequired[object]
    paymasterSignature: NotRequired[str]


def _hex_bytes(value: str) -> bytes:
    if not isinstance(value, str) or not re.fullmatch(r"0x(?:[0-9a-fA-F]{2})*", value):
        raise CodecError("Expected 0x-prefixed hex bytes")
    try:
        return bytes.fromhex(value[2:])
    except ValueError as error:
        raise CodecError("Invalid hex bytes") from error


def _quantity(value: str, bits: int = 256) -> int:
    if not isinstance(value, str) or not re.fullmatch(r"0x[0-9a-fA-F]+", value):
        raise CodecError("Expected a hex RPC quantity")
    try:
        number = int(value, 16)
    except ValueError as error:
        raise CodecError("Invalid hex quantity") from error
    return uint(number, bits)


def pack_user_operation(operation: UserOperation) -> tuple:
    """Convert the standard RPC dictionary to the contract tuple without reimplementing hashing."""
    if any(key in operation for key in ("factory", "factoryData", "eip7702Auth")):
        raise CodecError("Swig requires an already deployed account")
    paymaster = Web3.to_checksum_address(operation["paymaster"])
    if int(paymaster, 16) == 0:
        raise CodecError("Swig requires sponsorship")
    paymaster_data = (
        bytes.fromhex(paymaster[2:])
        + _quantity(operation["paymasterVerificationGasLimit"], 128).to_bytes(16, "big")
        + _quantity(operation["paymasterPostOpGasLimit"], 128).to_bytes(16, "big")
        + _hex_bytes(operation.get("paymasterData", "0x"))
    )
    if "paymasterSignature" in operation:
        signature = _hex_bytes(operation["paymasterSignature"])
        paymaster_data += (
            signature
            + uint(len(signature), 16).to_bytes(2, "big")
            + bytes.fromhex("22e325a297439656")
        )
    account_gas = _quantity(operation["verificationGasLimit"], 128).to_bytes(16, "big") + _quantity(
        operation["callGasLimit"], 128
    ).to_bytes(16, "big")
    fees = _quantity(operation["maxPriorityFeePerGas"], 128).to_bytes(16, "big") + _quantity(
        operation["maxFeePerGas"], 128
    ).to_bytes(16, "big")
    return (
        Web3.to_checksum_address(operation["sender"]),
        _quantity(operation["nonce"]),
        b"",
        _hex_bytes(operation["callData"]),
        account_gas,
        _quantity(operation["preVerificationGas"]),
        fees,
        paymaster_data,
        _hex_bytes(operation["signature"]),
    )


@dataclass(frozen=True)
class TokenFunding:
    token: str
    amount: int


@dataclass(frozen=True)
class CallExecution:
    target: str
    value: int = 0
    data: bytes = b""
    token_funding: tuple[TokenFunding, ...] = ()
    sweep_tokens: tuple[str, ...] = ()


@dataclass(frozen=True)
class SwigSmartAccount:
    address: str
    chain_id: int
    role_id: int
    signer: str
    valid_after: int
    valid_until: int
    kind: Literal["signV2", "capsule"] = "signV2"

    def __post_init__(self) -> None:
        uint(self.role_id, 32)
        uint(self.chain_id, 256)
        uint(self.valid_after, 47)
        uint(self.valid_until, 47)
        if self.valid_until <= self.valid_after:
            raise CodecError("Swig requires an explicit uint47 timestamp validity window")
        if self.kind not in ("signV2", "capsule"):
            raise CodecError("Unsupported execution kind")
        Web3.to_checksum_address(self.address)
        Web3.to_checksum_address(self.signer)

    def encode_call(self, direct_authorization_nonce: int, execution: CallExecution) -> bytes:
        if self.kind == "signV2" and (execution.token_funding or execution.sweep_tokens):
            raise CodecError("Funding and sweep manifests require capsule execution")
        request = (
            1,
            self.role_id,
            uint(direct_authorization_nonce, 256),
            self.signer,
            self.valid_after,
            self.valid_until,
            1 if self.kind == "capsule" else 0,
            (
                execution.target,
                uint(execution.value, 256),
                execution.data,
                [(item.token, uint(item.amount, 64)) for item in execution.token_funding],
                execution.sweep_tokens,
            ),
        )
        return EXECUTE_SELECTOR + encode([REQUEST_ABI], [request])

    def validate_user_operation(self, operation: UserOperation) -> tuple:
        packed = pack_user_operation(operation)
        if packed[0] != Web3.to_checksum_address(self.address) or packed[1] >> 64 != self.role_id:
            raise CodecError("UserOperation sender or role nonce lane differs from this account")
        call_data = packed[3]
        if call_data[:4] != EXECUTE_SELECTOR:
            raise CodecError("Invalid Swig execution selector")
        (request,) = decode([REQUEST_ABI], call_data[4:])
        version, role, direct_nonce, signer, valid_after, valid_until, kind, execution = request
        if (
            version != 1
            or role != self.role_id
            or Web3.to_checksum_address(signer) != Web3.to_checksum_address(self.signer)
            or valid_after != self.valid_after
            or valid_until != self.valid_until
            or kind != (1 if self.kind == "capsule" else 0)
        ):
            raise CodecError("UserOperation does not match this Swig adapter")
        target, value, data, funding, sweep = execution
        expected = self.encode_call(
            direct_nonce,
            CallExecution(
                target, value, data, tuple(TokenFunding(*item) for item in funding), tuple(sweep)
            ),
        )
        if expected != call_data:
            raise CodecError("Noncanonical Swig envelope")
        return packed

    def get_nonce(self, web3: Web3) -> int:
        data = Web3.keccak(text="getNonce(address,uint192)")[:4] + encode(
            ["address", "uint192"], [self.address, self.role_id]
        )
        result = web3.eth.call({"to": ENTRY_POINT_V09, "data": data})
        (nonce,) = decode(["uint256"], result)
        return nonce

    def user_operation_hash(self, web3: Web3, operation: UserOperation) -> bytes:
        """Read the live v0.9 EIP-712 digest. Sign raw; never add a personal_sign prefix."""
        packed = self.validate_user_operation(operation)
        if web3.eth.chain_id != self.chain_id or not web3.eth.get_code(
            Web3.to_checksum_address(self.address)
        ):
            raise CodecError("Swig requires a deployed account on the configured chain")
        config = get_contract(web3, "SwigConfig", self.address)
        if config.functions.entryPoint().call() != ENTRY_POINT_V09:
            raise CodecError("Swig requires canonical EntryPoint v0.9")
        data = Web3.keccak(text=f"getUserOpHash({PACKED_ABI})")[:4] + encode([PACKED_ABI], [packed])
        (digest,) = decode(["bytes32"], web3.eth.call({"to": ENTRY_POINT_V09, "data": data}))
        return digest
