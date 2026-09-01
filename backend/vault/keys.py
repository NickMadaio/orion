"""The key hierarchy, and the cipher this repository deliberately does not have.

Two layers, which is what "envelope encryption" means: a data key per credential
encrypts the secret, and a key-encrypting key held by the KMS encrypts the data
key. The database sees ciphertext and a wrapped data key. It never sees a KEK --
and `KmsPort` has no method that returns one, so "master keys outside PostgreSQL"
is a property of the interface rather than a note in a runbook.

**There is no AES in the standard library and no third-party dependency in this
repository.** The cipher is therefore a port with a refusing default: nothing can
ship encrypting with a placeholder, because the placeholder raises.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from typing import Protocol, runtime_checkable


class CipherUnavailable(RuntimeError):
    """No real cipher was injected.

    Its own type, and never caught anywhere in this package. A vault that falls
    back to something when the cipher is missing is a vault that will eventually
    store a secret with the something.
    """


class UnauthenticatedCipher(ValueError):
    """A cipher that does not authenticate its ciphertext was offered.

    Confidentiality without integrity means an attacker who can write to the
    database can flip bits in a token and watch what happens.
    """


@runtime_checkable
class AeadCipher(Protocol):
    """Authenticated encryption with associated data."""

    name: str
    authenticated: bool

    def encrypt(self, key: bytes, plaintext: bytes, associated: bytes) -> bytes: ...
    def decrypt(self, key: bytes, ciphertext: bytes, associated: bytes) -> bytes: ...


class RefusingCipher:
    """The default. Raises rather than encrypting.

    Chosen over "no default", because a missing argument somewhere becomes a
    `None` that somebody handles; this becomes an exception nobody can mistake.
    """

    name = "refusing"
    authenticated = True

    def encrypt(self, key: bytes, plaintext: bytes, associated: bytes) -> bytes:
        raise CipherUnavailable(
            "no cipher is configured: inject an authenticated cipher (AES-GCM or "
            "ChaCha20-Poly1305 via a reviewed dependency, or the platform KMS)"
        )

    def decrypt(self, key: bytes, ciphertext: bytes, associated: bytes) -> bytes:
        raise CipherUnavailable("no cipher is configured")


def require_authenticated(cipher: AeadCipher) -> AeadCipher:
    if not isinstance(cipher, AeadCipher):
        raise ValueError("a cipher must implement encrypt and decrypt")
    if not getattr(cipher, "authenticated", False):
        raise UnauthenticatedCipher(f"{getattr(cipher, 'name', cipher)} does not authenticate")
    return cipher


@dataclass(frozen=True, slots=True)
class WrappedKey:
    """A data key, encrypted by a KEK. Safe to store next to the ciphertext."""

    key_version: int
    material: bytes

    def __post_init__(self) -> None:
        if type(self.key_version) is not int or self.key_version < 1:
            raise ValueError("key_version starts at 1")
        if not isinstance(self.material, (bytes, bytearray)) or not self.material:
            raise ValueError("a wrapped key must be non-empty bytes")


@runtime_checkable
class KmsPort(Protocol):
    """What the vault may ask a key management system for.

    Note what is absent: there is no `get_key`. The KMS wraps and unwraps; the
    KEK never leaves it, so no caller can hold one, log one, or put one in a row.
    """

    @property
    def current_version(self) -> int: ...

    def wrap(self, data_key: bytes) -> WrappedKey: ...
    def unwrap(self, wrapped: WrappedKey) -> bytes: ...


class InProcessKms:
    """A KMS stand-in for tests and local work. Not a KMS.

    Wrapping is HMAC-based key derivation plus XOR, with a FRESH RANDOM NONCE per
    wrap. The nonce is the whole point: without it the keystream was
    `HMAC(kek, b"orion-dek-wrap")` -- a constant per key version -- so every data
    key was XORed against the same bytes. That is a many-time pad. Leaking one
    data key alongside its wrapped form recovered the keystream and unwrapped
    every other key under that version, with no access to the KEK at all. The
    docstring here used to call it "a real construction for wrapping a
    fixed-length random key"; the stand-in label was honest and that sentence was
    not. Production uses the platform KMS through the same port.
    """

    def __init__(self, master_keys: dict[int, bytes] | None = None) -> None:
        self._keys = dict(master_keys or {})
        for version, key in self._keys.items():
            if type(version) is not int or version < 1:
                raise ValueError("key versions start at 1")
            if not isinstance(key, (bytes, bytearray)) or len(key) < 32:
                raise ValueError("a master key must be at least 32 bytes")
        self._current = max(self._keys, default=0)

    @property
    def current_version(self) -> int:
        if not self._current:
            raise CipherUnavailable("no master key is configured")
        return self._current

    def add_version(self, version: int, key: bytes) -> None:
        if version in self._keys:
            raise ValueError(f"key version {version} already exists")
        if not isinstance(key, (bytes, bytearray)) or len(key) < 32:
            raise ValueError("a master key must be at least 32 bytes")
        self._keys[version] = bytes(key)
        self._current = max(self._keys)

    #: Bytes of nonce carried in front of the wrapped material.
    NONCE_BYTES = 16

    def wrap(self, data_key: bytes) -> WrappedKey:
        if not isinstance(data_key, (bytes, bytearray)) or len(data_key) != 32:
            raise ValueError("a data key is 32 bytes")
        version = self.current_version
        nonce = secrets.token_bytes(self.NONCE_BYTES)
        return WrappedKey(
            key_version=version, material=nonce + self._xor(version, nonce, bytes(data_key))
        )

    def unwrap(self, wrapped: WrappedKey) -> bytes:
        if wrapped.key_version not in self._keys:
            # An old KEK that has been retired cannot unwrap what it wrapped.
            # Losing access to data is the correct failure here; guessing is not.
            raise CipherUnavailable(f"key version {wrapped.key_version} is not available")
        material = bytes(wrapped.material)
        if len(material) <= self.NONCE_BYTES:
            raise CipherUnavailable("that wrapped key carries no nonce")
        nonce, body = material[: self.NONCE_BYTES], material[self.NONCE_BYTES :]
        return self._xor(wrapped.key_version, nonce, body)

    def _xor(self, version: int, nonce: bytes, material: bytes) -> bytes:
        stream = hmac.new(
            self._keys[version], b"orion-dek-wrap" + nonce, hashlib.sha256
        ).digest()
        return bytes(left ^ right for left, right in zip(material, stream))
