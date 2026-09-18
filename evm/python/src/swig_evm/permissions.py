"""Pure codecs for the enforced EVM permission variants; amounts are uint64 base units."""

from dataclasses import dataclass
from enum import IntEnum
from typing import TypeAlias

from .codec import CodecError, address_word, read_address, uint


class SimplePermission(IntEnum):
    ALL = 7
    MANAGE_AUTHORITY = 8
    PROGRAM_ALL = 13
    ALL_BUT_MANAGE_AUTHORITY = 15


@dataclass(frozen=True)
class RecurringLimit:
    recurring_amount: int
    window: int
    last_reset: int
    current_amount: int

    def __post_init__(self) -> None:
        for value in (self.recurring_amount, self.window, self.last_reset, self.current_amount):
            uint(value, 64)
        if not self.window or self.current_amount > self.recurring_amount:
            raise CodecError("Invalid recurring limit state")

    @classmethod
    def new(cls, amount: int, window: int) -> "RecurringLimit":
        return cls(amount, window, 0, amount)


@dataclass(frozen=True)
class Program:
    target: str


@dataclass(frozen=True)
class NativeLimit:
    amount: int


@dataclass(frozen=True)
class NativeRecurringLimit:
    limit: RecurringLimit


@dataclass(frozen=True)
class NativeDestinationLimit:
    destination: str
    amount: int


@dataclass(frozen=True)
class NativeRecurringDestinationLimit:
    destination: str
    limit: RecurringLimit


@dataclass(frozen=True)
class TokenLimit:
    token: str
    amount: int


@dataclass(frozen=True)
class TokenRecurringLimit:
    token: str
    limit: RecurringLimit


@dataclass(frozen=True)
class TokenDestinationLimit:
    token: str
    destination: str
    amount: int


@dataclass(frozen=True)
class TokenRecurringDestinationLimit:
    token: str
    destination: str
    limit: RecurringLimit


Permission: TypeAlias = (
    SimplePermission
    | Program
    | NativeLimit
    | NativeRecurringLimit
    | NativeDestinationLimit
    | NativeRecurringDestinationLimit
    | TokenLimit
    | TokenRecurringLimit
    | TokenDestinationLimit
    | TokenRecurringDestinationLimit
)
ActionData: TypeAlias = tuple[int, bytes]


def _u64(value: int) -> bytes:
    return uint(value, 64).to_bytes(8, "little")


def _recurring(limit: RecurringLimit) -> bytes:
    return b"".join(
        _u64(value)
        for value in (limit.recurring_amount, limit.window, limit.last_reset, limit.current_amount)
    )


def encode_permission(permission: Permission) -> ActionData:
    """Encode exact stored state; use RecurringLimit.new for a fresh role allowance."""
    match permission:
        case SimplePermission():
            return int(permission), b""
        case Program(target):
            return 3, address_word(target)
        case NativeLimit(amount):
            return 1, _u64(amount)
        case NativeRecurringLimit(limit):
            return 2, _recurring(limit)
        case NativeDestinationLimit(destination, amount):
            return 16, address_word(destination) + _u64(amount)
        case NativeRecurringDestinationLimit(destination, limit):
            return 17, address_word(destination) + _recurring(limit)
        case TokenLimit(token, amount):
            return 5, address_word(token) + _u64(amount)
        case TokenRecurringLimit(token, limit):
            # This variant has a different stored field order.
            return 6, address_word(token) + b"".join(
                _u64(value)
                for value in (
                    limit.window,
                    limit.recurring_amount,
                    limit.current_amount,
                    limit.last_reset,
                )
            )
        case TokenDestinationLimit(token, destination, amount):
            return 18, address_word(token) + address_word(destination) + _u64(amount)
        case TokenRecurringDestinationLimit(token, destination, limit):
            return 19, address_word(token) + address_word(destination) + _recurring(limit)
        case _:
            raise CodecError("Unsupported permission")


def _read_recurring(data: bytes) -> RecurringLimit:
    return RecurringLimit(*(int.from_bytes(data[i : i + 8], "little") for i in range(0, 32, 8)))


def decode_permission(action: ActionData) -> Permission:
    kind, data = action
    uint(kind, 8)
    sizes = {
        7: 0,
        8: 0,
        13: 0,
        15: 0,
        3: 32,
        1: 8,
        2: 32,
        16: 40,
        17: 64,
        5: 40,
        6: 64,
        18: 72,
        19: 96,
    }
    if kind not in sizes or len(data) != sizes[kind]:
        raise CodecError("Unsupported permission or invalid payload length")
    match kind:
        case 7 | 8 | 13 | 15:
            return SimplePermission(kind)
        case 3:
            return Program(read_address(data))
        case 1:
            return NativeLimit(int.from_bytes(data, "little"))
        case 2:
            return NativeRecurringLimit(_read_recurring(data))
        case 16:
            return NativeDestinationLimit(
                read_address(data[:32]), int.from_bytes(data[32:], "little")
            )
        case 17:
            return NativeRecurringDestinationLimit(
                read_address(data[:32]), _read_recurring(data[32:])
            )
        case 5:
            return TokenLimit(read_address(data[:32]), int.from_bytes(data[32:], "little"))
        case 6:
            window, amount, current, reset = (
                int.from_bytes(data[i : i + 8], "little") for i in range(32, 64, 8)
            )
            return TokenRecurringLimit(
                read_address(data[:32]), RecurringLimit(amount, window, reset, current)
            )
        case 18:
            return TokenDestinationLimit(
                read_address(data[:32]),
                read_address(data[32:64]),
                int.from_bytes(data[64:], "little"),
            )
        case 19:
            return TokenRecurringDestinationLimit(
                read_address(data[:32]), read_address(data[32:64]), _read_recurring(data[64:])
            )
        case _:
            raise CodecError("Unsupported permission")
