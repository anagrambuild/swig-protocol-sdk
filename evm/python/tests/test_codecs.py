import json
from pathlib import Path

import pytest
from eth_abi import decode
from web3 import Web3

from swig_evm.authorities import (
    Ed25519,
    ProgramExec,
    Secp256k1,
    Secp256r1,
    decode_authority,
    encode_authority,
    encode_program_exec_authorization,
)
from swig_evm.codec import CodecError
from swig_evm.contracts import get_contract
from swig_evm.permissions import (
    NativeDestinationLimit,
    NativeLimit,
    NativeRecurringDestinationLimit,
    NativeRecurringLimit,
    Program,
    RecurringLimit,
    SimplePermission,
    TokenDestinationLimit,
    TokenLimit,
    TokenRecurringDestinationLimit,
    TokenRecurringLimit,
    decode_permission,
    encode_permission,
)
from swig_evm.roles import decode_role

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
A, B, C = ("0x" + byte * 20 for byte in ("11", "22", "33"))
amount = 0x0102030405060708
fresh = RecurringLimit.new(amount, 0x01020304)
stored = RecurringLimit(amount, 0x01020304, 0x05060708, 0x0102030405)
PERMISSIONS = {
    "all": SimplePermission.ALL,
    "manageAuthority": SimplePermission.MANAGE_AUTHORITY,
    "allButManageAuthority": SimplePermission.ALL_BUT_MANAGE_AUTHORITY,
    "programAll": SimplePermission.PROGRAM_ALL,
    "program": Program(C),
    "nativeLimit": NativeLimit(amount),
    "nativeRecurringLimit": NativeRecurringLimit(fresh),
    "nativeDestinationLimit": NativeDestinationLimit(B, amount),
    "nativeRecurringDestinationLimit": NativeRecurringDestinationLimit(B, fresh),
    "tokenLimit": TokenLimit(A, amount),
    "tokenRecurringLimit": TokenRecurringLimit(A, fresh),
    "tokenDestinationLimit": TokenDestinationLimit(A, B, amount),
    "tokenRecurringDestinationLimit": TokenRecurringDestinationLimit(A, B, fresh),
    "storedNativeRecurring": NativeRecurringLimit(stored),
    "storedTokenRecurring": TokenRecurringLimit(A, stored),
    "maximumNativeLimit": NativeLimit((1 << 64) - 1),
}


@pytest.mark.parametrize(
    "vector", json.loads((FIXTURES / "permissions.json").read_text()), ids=lambda v: v["name"]
)
def test_permission_vectors(vector):
    wire = vector["permission"], bytes.fromhex(vector["data"][2:])
    assert encode_permission(PERMISSIONS[vector["name"]]) == wire
    assert decode_permission(wire) == PERMISSIONS[vector["name"]]
    with pytest.raises(CodecError):
        decode_permission((wire[0], wire[1] + b"\x00"))


@pytest.mark.parametrize(
    "vector", json.loads((FIXTURES / "authorities.json").read_text()), ids=lambda v: v["name"]
)
def test_authority_vectors(vector):
    expected = {
        "secp256k1": Secp256k1(A),
        "secp256r1": Secp256r1(bytes.fromhex("12" * 32), bytes.fromhex("34" * 32)),
        "ed25519": Ed25519(bytes.fromhex("56" * 32), B),
        "programExec": ProgramExec(C),
    }[vector["name"]]
    wire = (
        vector["authorityType"],
        bytes.fromhex(vector["key"][2:]),
        bytes.fromhex(vector["keyExtra"][2:]),
    )
    assert encode_authority(expected) == wire
    assert decode_authority(wire) == expected
    assert decode_role((2, wire, 3)).authority == expected


def test_rejects_overflow_spent_reset_and_unsupported_shapes():
    for invalid in (-1, 1 << 64, True):
        with pytest.raises(CodecError):
            encode_permission(NativeLimit(invalid))
    for args in ((1, 0, 0, 1), (1, 10, 0, 2)):
        with pytest.raises(CodecError):
            RecurringLimit(*args)
    with pytest.raises(CodecError):
        decode_permission((4, b""))
    with pytest.raises(CodecError):
        decode_permission((3, b"\x01" + bytes(31)))
    with pytest.raises(CodecError):
        decode_authority((4, bytes(32), bytes(32)))
    with pytest.raises(CodecError, match="uint8"):
        decode_authority((True, bytes.fromhex("56" * 32), bytes.fromhex("00" * 12 + "22" * 20)))
    with pytest.raises(CodecError):
        encode_authority(Secp256k1("0x" + "00" * 20))
    with pytest.raises(CodecError):
        decode_role((1 << 32, encode_authority(Secp256k1(A)), 0))
    assert decode(["uint32", "bytes"], encode_program_exec_authorization(b"proof")) == (1, b"proof")


@pytest.mark.parametrize("name", ["SwigConfig", "SwigConfigFactory", "SwigVault", "SwigCapsule"])
def test_packaged_bindings_are_native_web3_contracts(name):
    contract = get_contract(Web3(), name, A)
    assert contract.address == A
    expected = json.loads((FIXTURES.parent / "abi" / f"{name}.json").read_text())
    assert contract.abi == expected
