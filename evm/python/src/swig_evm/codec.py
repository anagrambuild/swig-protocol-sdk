"""Protocol representation checks shared by the pure codecs."""

from web3 import Web3


class CodecError(ValueError):
    pass


def uint(value: int, bits: int) -> int:
    if type(value) is not int or not 0 <= value < 1 << bits:
        raise CodecError(f"Value must fit uint{bits}")
    return value


def address_word(address: str) -> bytes:
    return bytes(12) + bytes.fromhex(Web3.to_checksum_address(address)[2:])


def read_address(data: bytes) -> str:
    if len(data) != 32 or any(data[:12]):
        raise CodecError("Noncanonical address word")
    return Web3.to_checksum_address(data[12:])


def word(data: bytes) -> bytes:
    if not isinstance(data, bytes) or len(data) != 32 or not any(data):
        raise CodecError("Authority key must be a nonzero 32-byte value")
    return data
