from copy import deepcopy
from collections import deque
from dataclasses import replace
import json
from pathlib import Path

from eth_abi import encode
from eth_abi.exceptions import InsufficientDataBytes
import pytest
from web3 import Web3
from web3.exceptions import Web3RPCError
from web3.providers import BaseProvider

from swig_evm.codec import CodecError
from swig_evm.smart_account import (
    CallExecution,
    ENTRY_POINT_V09,
    MAX_TIMESTAMP,
    PACKED_ABI,
    SwigSmartAccount,
    TokenFunding,
    pack_user_operation,
)

VECTORS = json.loads((Path(__file__).resolve().parents[2] / "fixtures/4337.json").read_text())


def fixture(vector):
    request = vector["request"]
    account = SwigSmartAccount(
        vector["operation"]["sender"],
        1337,
        request["roleId"],
        request["signer"],
        request["validAfter"],
        request["validUntil"],
        vector["name"],
    )
    call = request["execution"]
    execution = CallExecution(
        call["target"],
        int(call["value"], 16),
        bytes.fromhex(call["data"][2:]),
        tuple(TokenFunding(t["token"], int(t["amount"], 16)) for t in call["tokenFunding"]),
        tuple(call["sweepTokens"]),
    )
    return account, execution


@pytest.mark.parametrize("vector", VECTORS, ids=lambda v: v["name"])
def test_viem_call_and_hash_request_compatibility(vector):
    account, execution = fixture(vector)
    encoded = account.encode_call(7, execution)
    assert "0x" + encoded.hex() == vector["operation"]["callData"]
    packed = account.validate_user_operation(vector["operation"])
    call = Web3.keccak(text=f"getUserOpHash({PACKED_ABI})")[:4] + encode([PACKED_ABI], [packed])
    assert "0x" + call.hex() == vector["hashCall"]


@pytest.mark.parametrize(
    "field,value",
    [
        ("sender", "0x" + "55" * 20),
        ("nonce", "0x0"),
        ("factory", "0x" + "55" * 20),
        ("paymaster", "0x" + "00" * 20),
        ("callData", "0x00"),
        ("callGasLimit", hex(1 << 128)),
        ("paymasterData", "0x  "),
    ],
)
def test_rejects_foreign_or_malformed_operation(field, value):
    account, _ = fixture(VECTORS[0])
    operation = deepcopy(VECTORS[0]["operation"])
    operation[field] = value
    with pytest.raises((ValueError, CodecError)):
        account.validate_user_operation(operation)


def test_timestamp_and_envelope_boundaries():
    account, execution = fixture(VECTORS[0])
    replace(account, valid_until=MAX_TIMESTAMP).encode_call(7, execution)
    for fields in (
        {"valid_until": 0},
        {"valid_until": 1 << 47},
        {"valid_after": -1},
        {"role_id": 1 << 32},
    ):
        with pytest.raises(CodecError):
            replace(account, **fields)
    operation = deepcopy(VECTORS[0]["operation"])
    operation["callData"] += "00"
    with pytest.raises(CodecError):
        account.validate_user_operation(operation)
    with pytest.raises(CodecError):
        account.encode_call(
            7, replace(execution, token_funding=(TokenFunding(account.address, 1),))
        )


def test_paymaster_signature_suffix_is_packed_for_entrypoint_to_hash():
    operation = deepcopy(VECTORS[0]["operation"])
    original = pack_user_operation(operation)[7]
    operation["paymasterSignature"] = "0x123456"
    assert pack_user_operation(operation)[7] == original + bytes.fromhex(
        "123456000322e325a297439656"
    )
    operation["paymasterSignature"] = "0x"
    assert pack_user_operation(operation)[7] == original + bytes.fromhex("000022e325a297439656")


class ScriptedProvider(BaseProvider):
    """Own the complete RPC boundary and fail on unexpected extra requests."""

    def __init__(self, responses):
        super().__init__()
        self.responses = deque(responses)
        self.calls = []

    def make_request(self, method, params):
        self.calls.append((method, params))
        expected_method, response = self.responses.popleft()
        assert method == expected_method
        return {"jsonrpc": "2.0", "id": len(self.calls), **response}


DEPLOYMENT_RESPONSES = [
    ("eth_chainId", {"result": "0x539"}),
    ("eth_getCode", {"result": "0x6000"}),
    ("eth_call", {"result": "0x" + encode(["address"], [ENTRY_POINT_V09]).hex()}),
]


@pytest.mark.parametrize(
    "responses,error",
    [
        ([("eth_chainId", {"result": "0x1"})], "configured chain"),
        (DEPLOYMENT_RESPONSES[:1] + [("eth_getCode", {"result": "0x"})], "deployed account"),
        (
            DEPLOYMENT_RESPONSES[:2]
            + [
                (
                    "eth_call",
                    {
                        "result": "0x"
                        + encode(["address"], ["0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108"]).hex()
                    },
                )
            ],
            "canonical EntryPoint v0.9",
        ),
    ],
)
def test_rejects_wrong_deployment_before_hash_rpc(responses, error):
    provider = ScriptedProvider(responses)
    web3 = Web3(provider)
    web3.middleware_onion.clear()
    account, _ = fixture(VECTORS[0])
    with pytest.raises(CodecError, match=error):
        account.user_operation_hash(web3, VECTORS[0]["operation"])
    assert not provider.responses
    assert len(provider.calls) == len(responses)


@pytest.mark.parametrize("failing_call", range(4))
def test_hash_rpc_errors_propagate_and_stop(failing_call):
    method = ["eth_chainId", "eth_getCode", "eth_call", "eth_call"][failing_call]
    responses = DEPLOYMENT_RESPONSES[:failing_call] + [
        (method, {"error": {"code": -32000, "message": "fixture RPC failure"}})
    ]
    provider = ScriptedProvider(responses)
    web3 = Web3(provider)
    web3.middleware_onion.clear()
    account, _ = fixture(VECTORS[0])
    with pytest.raises(Web3RPCError, match="fixture RPC failure"):
        account.user_operation_hash(web3, VECTORS[0]["operation"])
    assert not provider.responses
    assert len(provider.calls) == failing_call + 1


@pytest.mark.parametrize("digest", ["0x", "0x42", "0x" + "42" * 32])
def test_hash_response_decoding_and_canonical_calldata(digest):
    provider = ScriptedProvider(DEPLOYMENT_RESPONSES + [("eth_call", {"result": digest})])
    web3 = Web3(provider)
    web3.middleware_onion.clear()
    account, _ = fixture(VECTORS[0])
    if len(digest) == 66:
        assert account.user_operation_hash(web3, VECTORS[0]["operation"]) == bytes.fromhex(
            digest[2:]
        )
    else:
        with pytest.raises(InsufficientDataBytes):
            account.user_operation_hash(web3, VECTORS[0]["operation"])
    assert not provider.responses
    _, params = provider.calls[-1]
    assert params[0]["to"] == ENTRY_POINT_V09
    assert params[0]["data"] == VECTORS[0]["hashCall"]
