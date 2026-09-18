"""Pure authority codecs. Curve validity and verifier acceptance belong to the contract."""

from dataclasses import dataclass
from typing import TypeAlias

from eth_abi import encode

from .codec import CodecError, address_word, read_address, uint, word


@dataclass(frozen=True)
class Secp256k1:
    address: str


@dataclass(frozen=True)
class Secp256r1:
    x: bytes
    y: bytes


@dataclass(frozen=True)
class Ed25519:
    public_key: bytes
    verifier: str


@dataclass(frozen=True)
class ProgramExec:
    verifier: str


Authority: TypeAlias = Secp256k1 | Secp256r1 | Ed25519 | ProgramExec
AuthorityData: TypeAlias = tuple[int, bytes, bytes]


def encode_authority(authority: Authority) -> AuthorityData:
    match authority:
        case Secp256k1(address):
            return 3, word(address_word(address)), bytes(32)
        case Secp256r1(x, y):
            return 5, word(x), word(y)
        case Ed25519(public_key, verifier):
            return 1, word(public_key), word(address_word(verifier))
        case ProgramExec(verifier):
            return 7, word(address_word(verifier)), (1).to_bytes(32, "big")
        case _:
            raise CodecError("Unsupported authority")


def decode_authority(data: AuthorityData) -> Authority:
    kind, key, extra = data
    uint(kind, 8)
    if len(key) != 32 or len(extra) != 32:
        raise CodecError("Authority fields must contain 32 bytes")
    match kind:
        case 3 if not any(extra):
            authority: Authority = Secp256k1(read_address(key))
        case 5:
            authority = Secp256r1(key, extra)
        case 1:
            authority = Ed25519(key, read_address(extra))
        case 7 if int.from_bytes(extra, "big") == 1:
            authority = ProgramExec(read_address(key))
        case _:
            raise CodecError(
                "Unsupported or malformed authority; session variants require raw bindings"
            )
    encode_authority(authority)
    return authority


def encode_program_exec_authorization(proof: bytes) -> bytes:
    return encode(["uint32", "bytes"], [1, proof])
