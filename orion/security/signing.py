"""Signing sensitive requests, and refusing altered ones.

The manifest's invariants are "unsigned sensitive jobs cannot execute" and
"altered signed jobs cannot execute". Both need one thing: a canonical byte
string that changes if any field a decision depends on changes.

Local Mac actions do not carry signatures today -- nothing remote exists to sign
them. Built now anyway, because the alternative is a policy engine that cannot
express the requirement until Phase 44, and would therefore be rewritten rather
than extended.
"""

from __future__ import annotations

import hmac
from dataclasses import dataclass
from hashlib import sha256
from typing import Mapping

from orion.shared.identifiers import Identifier, Symbol


ALGORITHM = "hmac-sha256"


@dataclass(frozen=True, slots=True)
class Signature:
    key_id: Identifier
    algorithm: Symbol
    value: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "key_id", Identifier(self.key_id))
        object.__setattr__(self, "algorithm", Symbol(self.algorithm))
        if not isinstance(self.value, str) or len(self.value) != 64:
            raise ValueError("signature value must be a 64-character digest")
        if any(character not in "0123456789abcdef" for character in self.value):
            raise ValueError("signature value must be lowercase hexadecimal")


def canonical_bytes(fields: Mapping[str, str]) -> bytes:
    """A stable serialization of the fields a signature covers.

    Sorted keys, length-prefixed values. Length prefixes rather than a separator
    because "a|b" and "a" + "|b" are the same string under any separator scheme,
    and a signature that two different requests can both satisfy is not a
    signature.
    """

    parts: list[str] = []
    for key in sorted(fields):
        value = fields[key]
        if not isinstance(value, str):
            raise ValueError(f"signed field {key} must be a string")
        parts.append(f"{len(key)}:{key}={len(value)}:{value}")
    return "\n".join(parts).encode("utf-8")


def sign(secret: bytes, fields: Mapping[str, str]) -> str:
    if not isinstance(secret, (bytes, bytearray)) or not secret:
        raise ValueError("signing secret must be non-empty bytes")
    return hmac.new(bytes(secret), canonical_bytes(fields), sha256).hexdigest()


def verify(secret: bytes, fields: Mapping[str, str], signature: Signature) -> bool:
    """Whether this signature covers exactly these fields.

    Constant-time comparison, and an unknown algorithm is false rather than an
    exception: an attacker choosing the algorithm is how signature checks are
    skipped, and a caller that catches exceptions generically would turn that
    into an allow.
    """

    if str(signature.algorithm) != ALGORITHM:
        return False
    return hmac.compare_digest(sign(secret, fields), signature.value)


class KeyDirectory:
    """Signing secrets by key id, injected rather than read from anywhere.

    Core may not touch the Keychain, a file, or the environment; the adapter
    that can builds this and hands it in.
    """

    def __init__(self, secrets: Mapping[str, bytes] | None = None) -> None:
        self._secrets = dict(secrets or {})
        for key_id, secret in self._secrets.items():
            Identifier(key_id)
            if not isinstance(secret, (bytes, bytearray)) or not secret:
                raise ValueError(f"secret for {key_id} must be non-empty bytes")

    def secret_for(self, key_id: str) -> bytes | None:
        secret = self._secrets.get(str(key_id))
        return bytes(secret) if secret is not None else None
