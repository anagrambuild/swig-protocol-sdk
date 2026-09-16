from dataclasses import dataclass

from .authorities import Authority, AuthorityData, decode_authority
from .codec import uint

ROOT_ROLE_ID = 0


@dataclass(frozen=True)
class Role:
    id: int
    authority: Authority
    action_count: int


def decode_role(data: tuple[int, AuthorityData, int]) -> Role:
    role_id, authority, count = data
    return Role(uint(role_id, 32), decode_authority(authority), uint(count, 16))
