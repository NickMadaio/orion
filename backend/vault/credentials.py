"""The credential vault: the manifest's nine fields, and the rules around them.

Stored separately from ordinary data -- its own store, its own table
(`oauth_credentials`), its own access path -- and never returned. What a caller
can have is metadata, or a brief borrow of the plaintext.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Mapping

from backend.vault.keys import (
    AeadCipher,
    KmsPort,
    RefusingCipher,
    WrappedKey,
    require_authenticated,
)
from backend.vault.plaintext import Borrowed
from orion.shared.identifiers import Identifier


class CredentialRevoked(RuntimeError):
    """The credential, or the connection behind it, is no longer usable.

    This is the manifest's "deleted connections cannot continue refreshing
    tokens", as an exception rather than a policy note: revocation has to be
    something the refresh path trips over, not something it is trusted to check.
    """


class CredentialNotFound(KeyError):
    """No such credential for this owner."""


class CredentialCollision(RuntimeError):
    """That credential id is already taken.

    `store()` used to be an unconditional `self._credentials[id] = credential`
    while every read path went through `_owned`. So the write path was the one
    door with no lock on it: storing under an existing id silently destroyed
    another account's credential and took the id, with no error and no record.
    An id is minted once; re-issuing goes through revoke and a fresh id.
    """


@dataclass(frozen=True, slots=True)
class Credential:
    """The nine manifest fields, plus the envelope that holds the secret.

    `encrypted_refresh_token` is bytes and `wrapped_key` is the DEK under the
    KEK. There is no field for a plaintext token, and no code path that would
    write one.
    """

    credential_id: Identifier
    user_id: Identifier
    connection_id: Identifier
    provider: str
    scopes: tuple[str, ...]
    encrypted_refresh_token: bytes
    wrapped_key: WrappedKey
    created_at: datetime
    updated_at: datetime
    revoked_at: datetime | None = None

    def __post_init__(self) -> None:
        for field in ("credential_id", "user_id", "connection_id"):
            object.__setattr__(self, field, Identifier(getattr(self, field)))
        if not isinstance(self.provider, str) or not self.provider:
            raise ValueError("a credential names its provider")
        if not isinstance(self.scopes, tuple) or not all(isinstance(item, str) for item in self.scopes):
            raise ValueError("scopes are a tuple of strings")
        if not isinstance(self.encrypted_refresh_token, bytes) or not self.encrypted_refresh_token:
            raise ValueError("the stored token must be non-empty ciphertext")
        if not isinstance(self.wrapped_key, WrappedKey):
            raise ValueError("a credential carries its wrapped data key")

    @property
    def key_version(self) -> int:
        return self.wrapped_key.key_version

    @property
    def revoked(self) -> bool:
        return self.revoked_at is not None

    def metadata(self) -> Mapping[str, object]:
        """What a user-facing surface may see.

        Everything except the ciphertext and the wrapped key. A view rather than
        a filtered dump, so adding a field to the record does not silently add it
        to an API response.
        """

        return {
            "credential_id": str(self.credential_id),
            "provider": self.provider,
            "scopes": list(self.scopes),
            "key_version": self.key_version,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "revoked_at": None if self.revoked_at is None else self.revoked_at.isoformat(),
        }


class CredentialVault:
    """Stores credentials encrypted, hands them out briefly, revokes them fast."""

    def __init__(
        self,
        kms: KmsPort,
        cipher: AeadCipher | None = None,
        *,
        data_key_source=None,
    ) -> None:
        self._kms = kms
        self._cipher = require_authenticated(cipher if cipher is not None else RefusingCipher())
        # Injected for the same reason ids and clocks are: a vault whose key
        # generation cannot be made deterministic cannot be tested exactly.
        self._new_data_key = data_key_source or self._random_data_key
        self._credentials: dict[str, Credential] = {}
        # Keyed by (owner, connection): one account deleting its connection
        # must not delete another account's connection of the same id.
        self._deleted_connections: set[tuple[str, str]] = set()

    @staticmethod
    def _random_data_key() -> bytes:
        import secrets

        return secrets.token_bytes(32)

    # -- writing -----------------------------------------------------------

    def store(
        self,
        *,
        credential_id: str,
        user_id: str,
        connection_id: str,
        provider: str,
        scopes: tuple[str, ...],
        refresh_token: bytes,
        now: datetime,
    ) -> Credential:
        """Encrypt and store. The plaintext argument is not retained."""

        if (str(user_id), str(connection_id)) in self._deleted_connections:
            raise CredentialRevoked(f"connection {connection_id} was deleted")
        existing = self._credentials.get(str(credential_id))
        if existing is not None:
            # Deliberately the same refusal whether or not it is yours: telling a
            # caller "that id belongs to someone else" is an existence oracle for
            # other accounts' credential ids.
            raise CredentialCollision(f"credential {credential_id} already exists")
        data_key = self._new_data_key()
        associated = self._associated(user_id, connection_id, provider)
        ciphertext = self._cipher.encrypt(data_key, bytes(refresh_token), associated)
        credential = Credential(
            credential_id=credential_id,
            user_id=user_id,
            connection_id=connection_id,
            provider=provider,
            scopes=tuple(scopes),
            encrypted_refresh_token=ciphertext,
            wrapped_key=self._kms.wrap(data_key),
            created_at=_aware(now),
            updated_at=_aware(now),
        )
        self._credentials[str(credential_id)] = credential
        return credential

    # -- reading -----------------------------------------------------------

    def metadata(self, user_id: str, credential_id: str) -> Mapping[str, object]:
        return self._owned(user_id, credential_id).metadata()

    def list_metadata(self, user_id: str) -> tuple[Mapping[str, object], ...]:
        return tuple(
            credential.metadata()
            for credential in self._credentials.values()
            if str(credential.user_id) == str(user_id)
        )

    def borrow(self, user_id: str, credential_id: str) -> Borrowed:
        """Decrypt, for as long as the `with` block lasts and no longer.

        The only path to a plaintext token, and it hands back something that
        cannot be printed, compared, or serialized. Nothing is decrypted until
        the `with` block is entered: a borrow that is never entered never
        produces a secret.

        Honest limitation: the value yielded INSIDE the block is a `bytes`, and
        Python cannot stop a caller keeping their own copy of it past the block.
        `freeze_json_object` refuses raw bytes, so the audit/event path still
        catches the common accident, but `token.decode()` is a copy this type
        cannot reach.
        """

        credential = self._owned(user_id, credential_id)
        if credential.revoked or (
            str(credential.user_id),
            str(credential.connection_id),
        ) in self._deleted_connections:
            raise CredentialRevoked(f"{credential_id} has been revoked")
        def decrypt() -> bytes:
            data_key = self._kms.unwrap(credential.wrapped_key)
            try:
                return self._cipher.decrypt(
                    data_key,
                    credential.encrypted_refresh_token,
                    self._associated(
                        credential.user_id, credential.connection_id, credential.provider
                    ),
                )
            finally:
                data_key = b"\x00" * len(data_key)

        return Borrowed(decrypt, label=f"{credential.provider} refresh token")

    # -- lifecycle ---------------------------------------------------------

    def revoke(self, user_id: str, credential_id: str, *, now: datetime) -> Credential:
        credential = self._owned(user_id, credential_id)
        revoked = replace(credential, revoked_at=_aware(now), updated_at=_aware(now))
        self._credentials[str(credential_id)] = revoked
        return revoked

    def delete_connection(
        self, user_id: str, connection_id: str, *, now: datetime
    ) -> tuple[str, ...]:
        """Deleting a connection revokes everything under it, in the same call.

        Not a cleanup job, not an event somebody subscribes to: the manifest's
        invariant is that a deleted connection cannot continue refreshing, and
        anything asynchronous leaves a window in which it can.
        """

        self._deleted_connections.add((str(user_id), str(connection_id)))
        revoked: list[str] = []
        for key, credential in list(self._credentials.items()):
            if (
                str(credential.connection_id) == str(connection_id)
                and str(credential.user_id) == str(user_id)
                and not credential.revoked
            ):
                self._credentials[key] = replace(
                    credential, revoked_at=_aware(now), updated_at=_aware(now)
                )
                revoked.append(key)
        return tuple(revoked)

    def rotate_key(self, *, now: datetime) -> int:
        """Re-wrap every data key under the KMS's current KEK.

        The ciphertext is never touched -- that is the point of the envelope, and
        it is what makes rotation cheap enough to actually happen.
        """

        version = self._kms.current_version
        rotated = 0
        for key, credential in list(self._credentials.items()):
            if credential.key_version == version:
                continue
            data_key = self._kms.unwrap(credential.wrapped_key)
            try:
                self._credentials[key] = replace(
                    credential, wrapped_key=self._kms.wrap(data_key), updated_at=_aware(now)
                )
            finally:
                data_key = b"\x00" * len(data_key)
            rotated += 1
        return rotated

    # -- internals ---------------------------------------------------------

    def _owned(self, user_id: str, credential_id: str) -> Credential:
        credential = self._credentials.get(str(credential_id))
        if credential is None or str(credential.user_id) != str(user_id):
            # One answer for "not yours" and "not there", as Phase 10 settled.
            raise CredentialNotFound(f"no credential {credential_id}")
        return credential

    @staticmethod
    def _associated(user_id: str, connection_id: str, provider: str) -> bytes:
        """Bound into the ciphertext, so a row cannot be moved between users.

        Without this, copying `encrypted_refresh_token` from one row to another
        would yield a token that decrypts perfectly under somebody else's name.
        """

        return f"{user_id}|{connection_id}|{provider}".encode("utf-8")


def _aware(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("timestamps must be timezone-aware")
    return value.astimezone(timezone.utc)
