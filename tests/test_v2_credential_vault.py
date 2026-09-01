"""Phase 12: the credential vault.

The cipher is injected here as `TestOnlyCipher` -- named so it is obvious in a
stack trace if it is ever wired somewhere real. Production must inject an
authenticated cipher; the default refuses.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import unittest
from datetime import datetime, timedelta, timezone

from backend.vault.credentials import (
    Credential,
    CredentialCollision,
    CredentialNotFound,
    CredentialRevoked,
    CredentialVault,
)
from backend.vault.keys import (
    CipherUnavailable,
    InProcessKms,
    RefusingCipher,
    UnauthenticatedCipher,
    WrappedKey,
    require_authenticated,
)
from backend.vault.plaintext import Borrowed, SecretExpired, SecretExposure


NOW = datetime(2026, 8, 25, 14, 0, tzinfo=timezone.utc)
TOKEN = b"refresh-token-value-for-a-test"
USER = "user-nick-0001"
OTHER = "user-other-0001"


class TestOnlyCipher:
    """Authenticated, deterministic, and not for anything real.

    Keystream from HMAC plus an HMAC tag. Sufficient to exercise the vault's
    lifecycle; not a substitute for AES-GCM, which is why the production default
    raises instead of using this.
    """

    name = "test-only"
    authenticated = True

    def encrypt(self, key: bytes, plaintext: bytes, associated: bytes) -> bytes:
        body = self._xor(key, plaintext)
        return self._tag(key, body, associated) + body

    def decrypt(self, key: bytes, ciphertext: bytes, associated: bytes) -> bytes:
        tag, body = ciphertext[:32], ciphertext[32:]
        if not hmac.compare_digest(tag, self._tag(key, body, associated)):
            raise ValueError("ciphertext failed authentication")
        return self._xor(key, body)

    def _xor(self, key: bytes, data: bytes) -> bytes:
        stream = b""
        while len(stream) < len(data):
            stream += hmac.new(key, b"stream" + len(stream).to_bytes(4, "big"), hashlib.sha256).digest()
        return bytes(left ^ right for left, right in zip(data, stream))

    def _tag(self, key: bytes, body: bytes, associated: bytes) -> bytes:
        return hmac.new(key, b"tag" + associated + body, hashlib.sha256).digest()


def vault(**overrides):
    kms = overrides.get("kms", InProcessKms({1: b"master-key-one-" + b"0" * 20}))
    return CredentialVault(
        kms,
        overrides.get("cipher", TestOnlyCipher()),
        data_key_source=overrides.get("data_key_source", lambda: b"d" * 32),
    )


def stored(subject=None, **overrides):
    subject = subject or vault()
    fields = {
        "credential_id": "credential-0001",
        "user_id": USER,
        "connection_id": "connection-0001",
        "provider": "google",
        "scopes": ("gmail.readonly",),
        "refresh_token": TOKEN,
        "now": NOW,
    }
    fields.update(overrides)
    return subject, subject.store(**fields)


class CipherPolicyTests(unittest.TestCase):
    def test_the_default_cipher_refuses_rather_than_encrypting(self):
        subject = CredentialVault(InProcessKms({1: b"k" * 32}))
        with self.assertRaises(CipherUnavailable):
            stored(subject)

    def test_an_unauthenticated_cipher_cannot_be_injected(self):
        class Weak:
            name = "weak"
            authenticated = False

            def encrypt(self, key, plaintext, associated):
                return plaintext

            def decrypt(self, key, ciphertext, associated):
                return ciphertext

        with self.assertRaises(UnauthenticatedCipher):
            CredentialVault(InProcessKms({1: b"k" * 32}), Weak())

    def test_the_refusing_default_is_what_is_installed(self):
        self.assertIsInstance(RefusingCipher(), object)
        with self.assertRaises(CipherUnavailable):
            RefusingCipher().decrypt(b"k", b"c", b"a")


class EnvelopeTests(unittest.TestCase):
    def test_the_stored_row_holds_ciphertext_and_a_wrapped_key_only(self):
        _, credential = stored()
        self.assertNotIn(TOKEN, credential.encrypted_refresh_token)
        self.assertIsInstance(credential.wrapped_key, WrappedKey)
        self.assertNotIn("refresh_token", credential.metadata())
        self.assertNotIn(b"d" * 32, credential.wrapped_key.material)

    def test_the_kms_never_hands_out_a_master_key(self):
        # "Master keys outside PostgreSQL" as a property of the interface: there
        # is no method that returns one.
        kms = InProcessKms({1: b"k" * 32})
        self.assertFalse([name for name in dir(kms) if "master" in name and not name.startswith("_")])
        self.assertFalse(hasattr(kms, "get_key"))

    def test_a_borrow_returns_the_original_token(self):
        subject, credential = stored()
        with subject.borrow(USER, credential.credential_id) as secret:
            self.assertEqual(secret, TOKEN)

    def test_ciphertext_is_bound_to_its_owner_and_connection(self):
        # Copying a row between users must not produce a working token.
        subject, credential = stored()
        moved = Credential(
            credential_id="credential-0002",
            user_id=OTHER,
            connection_id=credential.connection_id,
            provider=credential.provider,
            scopes=credential.scopes,
            encrypted_refresh_token=credential.encrypted_refresh_token,
            wrapped_key=credential.wrapped_key,
            created_at=NOW,
            updated_at=NOW,
        )
        subject._credentials["credential-0002"] = moved
        with self.assertRaises(ValueError):
            subject.borrow(OTHER, "credential-0002").__enter__()

    def test_tampering_with_the_ciphertext_is_detected(self):
        subject, credential = stored()
        broken = bytearray(credential.encrypted_refresh_token)
        broken[-1] ^= 0x01
        subject._credentials["credential-0001"] = Credential(
            credential_id=credential.credential_id,
            user_id=credential.user_id,
            connection_id=credential.connection_id,
            provider=credential.provider,
            scopes=credential.scopes,
            encrypted_refresh_token=bytes(broken),
            wrapped_key=credential.wrapped_key,
            created_at=NOW,
            updated_at=NOW,
        )
        with self.assertRaises(ValueError):
            subject.borrow(USER, "credential-0001").__enter__()


class KmsWrapTests(unittest.TestCase):
    def test_two_wraps_of_the_same_key_do_not_share_a_keystream(self):
        # The keystream was HMAC(kek, b"orion-dek-wrap") -- a constant per key
        # version -- so W1 ^ W2 == K1 ^ K2 for every pair. Leak one data key with
        # its wrapped form and every other key under that version falls out,
        # without the KEK. A many-time pad.
        kms = InProcessKms({1: b"master-key-one-" + b"0" * 20})
        first, second = kms.wrap(b"\x01" * 32), kms.wrap(b"\x02" * 32)
        self.assertNotEqual(first.material, second.material)

        def body(wrapped):
            return bytes(wrapped.material)[InProcessKms.NONCE_BYTES:]

        recovered = bytes(a ^ b for a, b in zip(body(first), body(second)))
        plain = bytes(a ^ b for a, b in zip(b"\x01" * 32, b"\x02" * 32))
        self.assertNotEqual(recovered, plain)

    def test_wrapping_the_same_key_twice_gives_different_material(self):
        kms = InProcessKms({1: b"master-key-one-" + b"0" * 20})
        key = b"d" * 32
        self.assertNotEqual(kms.wrap(key).material, kms.wrap(key).material)

    def test_and_both_still_unwrap(self):
        kms = InProcessKms({1: b"master-key-one-" + b"0" * 20})
        key = b"d" * 32
        self.assertEqual(kms.unwrap(kms.wrap(key)), key)
        self.assertEqual(kms.unwrap(kms.wrap(key)), key)


class RotationTests(unittest.TestCase):
    def test_rotating_the_kek_rewraps_without_touching_the_ciphertext(self):
        kms = InProcessKms({1: b"master-key-one-" + b"0" * 20})
        subject, credential = stored(vault(kms=kms))
        kms.add_version(2, b"master-key-two-" + b"0" * 20)
        self.assertEqual(subject.rotate_key(now=NOW + timedelta(days=1)), 1)
        rotated = subject._credentials["credential-0001"]
        self.assertEqual(rotated.key_version, 2)
        self.assertEqual(rotated.encrypted_refresh_token, credential.encrypted_refresh_token)
        with subject.borrow(USER, "credential-0001") as secret:
            self.assertEqual(secret, TOKEN)

    def test_rotation_is_idempotent(self):
        subject, _ = stored()
        self.assertEqual(subject.rotate_key(now=NOW), 0)

    def test_a_retired_key_version_cannot_unwrap(self):
        # Losing access is the correct failure when a KEK is gone. Guessing is not.
        kms = InProcessKms({1: b"master-key-one-" + b"0" * 20})
        subject, _ = stored(vault(kms=kms))
        with self.assertRaises(CipherUnavailable):
            InProcessKms({2: b"other-key-" + b"0" * 25}).unwrap(
                subject._credentials["credential-0001"].wrapped_key
            )


class BorrowTests(unittest.TestCase):
    def test_the_secret_is_gone_after_the_borrow(self):
        subject, _ = stored()
        borrowed = subject.borrow(USER, "credential-0001")
        with borrowed as secret:
            self.assertEqual(secret, TOKEN)
        self.assertTrue(borrowed.disposed)
        with self.assertRaises(SecretExpired):
            borrowed.__enter__()

    def test_a_borrow_that_is_never_entered_never_decrypts(self):
        # borrow() decrypted eagerly and the `with` was optional, so
        # `b = vault.borrow(...)` left plaintext in the buffer with nothing to
        # dispose of it and no __del__ to catch the dropped reference.
        subject, _ = stored()
        borrowed = subject.borrow(USER, "credential-0001")
        self.assertFalse(borrowed.disposed)
        self.assertEqual(bytes(borrowed._buffer), b"")
        with borrowed as secret:
            self.assertEqual(secret, TOKEN)
        self.assertTrue(borrowed.disposed)

    def test_the_kms_is_only_ever_asked_for_the_three_port_operations(self):
        # The test cited as proof that master keys cannot be handed out asserted
        # that no public name contains "master" and no attribute is called
        # get_key -- a spelling check. A KmsPort-conforming class with
        # export_kek() passed it while returning the KEK. Watch what the vault
        # actually CALLS instead.
        calls = []

        class SpyKms:
            def __init__(self, inner):
                self._inner = inner

            @property
            def current_version(self):
                calls.append("current_version")
                return self._inner.current_version

            def wrap(self, data_key):
                calls.append("wrap")
                return self._inner.wrap(data_key)

            def unwrap(self, wrapped):
                calls.append("unwrap")
                return self._inner.unwrap(wrapped)

        spy = SpyKms(InProcessKms({1: b"master-key-one-" + b"0" * 20}))
        subject, _ = stored(vault(kms=spy))
        with subject.borrow(USER, "credential-0001"):
            pass
        subject.rotate_key(now=NOW)
        self.assertTrue(calls)
        self.assertEqual(set(calls) - {"current_version", "wrap", "unwrap"}, set())

    def test_a_secret_refuses_to_be_rendered(self):
        # The three ways a secret reaches a log: an f-string, a debugger, and
        # json.dumps of a dict somebody thought was safe.
        secret = Borrowed(TOKEN)
        for attempt in (lambda: repr(secret), lambda: str(secret), lambda: f"{secret}"):
            with self.assertRaises(SecretExposure):
                attempt()
        with self.assertRaises(TypeError):
            json.dumps({"token": secret})

    def test_a_secret_does_not_compare(self):
        # Comparison is an oracle: `secret == b"guess"` in a loop reads it.
        with self.assertRaises(SecretExposure):
            Borrowed(TOKEN) == TOKEN  # noqa: B015

    def test_a_secret_is_not_hashable_so_it_cannot_become_a_dict_key(self):
        with self.assertRaises(TypeError):
            {Borrowed(TOKEN): "value"}


class RevocationTests(unittest.TestCase):
    def test_a_revoked_credential_cannot_be_borrowed(self):
        subject, _ = stored()
        subject.revoke(USER, "credential-0001", now=NOW)
        with self.assertRaises(CredentialRevoked):
            subject.borrow(USER, "credential-0001")

    def test_deleting_a_connection_revokes_its_credentials_in_the_same_call(self):
        # Anything asynchronous leaves a window in which a deleted connection can
        # still refresh, which is exactly the invariant.
        subject, _ = stored()
        self.assertEqual(subject.delete_connection(USER, "connection-0001", now=NOW), ("credential-0001",))
        with self.assertRaises(CredentialRevoked):
            subject.borrow(USER, "credential-0001")

    def test_a_deleted_connection_cannot_take_a_new_credential_either(self):
        subject, _ = stored()
        subject.delete_connection(USER, "connection-0001", now=NOW)
        with self.assertRaises(CredentialRevoked):
            subject.store(
                credential_id="credential-0003", user_id=USER, connection_id="connection-0001",
                provider="google", scopes=("gmail.readonly",), refresh_token=TOKEN, now=NOW,
            )

    def test_revocation_is_recorded_with_a_time(self):
        subject, _ = stored()
        revoked = subject.revoke(USER, "credential-0001", now=NOW)
        self.assertEqual(revoked.revoked_at, NOW)
        self.assertTrue(revoked.revoked)
        self.assertEqual(revoked.metadata()["revoked_at"], NOW.isoformat())


class OwnershipTests(unittest.TestCase):
    def test_another_user_cannot_reach_a_credential(self):
        subject, _ = stored()
        for call in (
            lambda: subject.borrow(OTHER, "credential-0001"),
            lambda: subject.metadata(OTHER, "credential-0001"),
            lambda: subject.revoke(OTHER, "credential-0001", now=NOW),
        ):
            with self.assertRaises(CredentialNotFound):
                call()

    def test_storing_cannot_overwrite_another_users_credential(self):
        # store() was an unconditional dict assignment while every READ path went
        # through _owned(). A colliding credential_id silently destroyed the
        # original owner's credential and took the id, with no error and no log.
        subject, original = stored()
        with self.assertRaises(CredentialCollision):
            stored(subject, user_id=OTHER)
        with subject.borrow(USER, "credential-0001") as token:
            self.assertEqual(token, TOKEN)
        with self.assertRaises(CredentialNotFound):
            subject.metadata(OTHER, "credential-0001")

    def test_storing_cannot_silently_replace_your_own_credential_either(self):
        # Even same-owner, an id is minted once. A silent overwrite is data loss
        # whoever does it; re-issuing goes through revoke + a fresh id.
        subject, _ = stored()
        with self.assertRaises(CredentialCollision):
            stored(subject, refresh_token=b"a-different-token")

    def test_deleting_a_connection_only_touches_your_own_credentials(self):
        # delete_connection took no owner at all: any caller holding a connection
        # id revoked every credential under it, across accounts.
        subject, _ = stored()
        stored(subject, credential_id="credential-0002", user_id=OTHER)
        self.assertEqual(
            subject.delete_connection(USER, "connection-0001", now=NOW), ("credential-0001",)
        )
        self.assertIsNone(subject.metadata(OTHER, "credential-0002")["revoked_at"])

    def test_a_deleted_connection_is_deleted_for_that_owner_only(self):
        subject, _ = stored()
        subject.delete_connection(USER, "connection-0001", now=NOW)
        with self.assertRaises(CredentialRevoked):
            stored(subject, credential_id="credential-0003")
        # The other account never asked for its connection to be deleted.
        stored(subject, credential_id="credential-0004", user_id=OTHER)

    def test_a_listing_shows_only_your_own(self):
        subject, _ = stored()
        self.assertEqual(len(subject.list_metadata(USER)), 1)
        self.assertEqual(subject.list_metadata(OTHER), ())

    def test_metadata_carries_no_secret_material(self):
        _, credential = stored()
        rendered = json.dumps(credential.metadata())
        self.assertNotIn("token", rendered.replace("refresh_token", ""))
        for field in ("encrypted_refresh_token", "wrapped_key"):
            self.assertNotIn(field, credential.metadata())

    def test_the_wrapped_data_key_has_somewhere_to_be_stored(self):
        # Nine record fields are no use if the table cannot hold them. There was
        # no column for wrapped_key anywhere in the 26 tables, so a credential
        # persisted as declared could never have been decrypted.
        from backend.db.schema import SCHEMA

        columns = {column.name for column in SCHEMA.table("oauth_credentials").columns}
        for field in ("encrypted_refresh_token", "wrapped_key", "key_version"):
            self.assertIn(field, columns)

    def test_the_nine_manifest_fields_are_present(self):
        _, credential = stored()
        for field in ("credential_id", "user_id", "provider", "scopes",
                      "encrypted_refresh_token", "created_at", "updated_at", "revoked_at"):
            self.assertTrue(hasattr(credential, field), field)
        self.assertEqual(credential.key_version, 1)


if __name__ == "__main__":
    unittest.main()
