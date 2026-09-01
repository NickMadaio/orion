"""Phase 13: account authentication.

Account is not device and a connector is not a login: both are tested in each
direction, because both are the kind of rule that gets violated by a
plausible-looking change years later.
"""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from backend.auth.mechanisms import (
    CONNECTOR_PROVIDERS,
    MECHANISMS,
    ConnectorIsNotALogin,
    Mechanism,
    mechanism,
    production_gap,
)
from backend.auth.service import AuthenticationFailed, AuthService
from backend.auth.throttle import (
    ACCOUNT_MAX_DELAY,
    SOURCE_LIMIT,
    SourceRefused,
    Throttle,
    TooSoon,
)
from backend.auth.tokens import (
    ABSOLUTE_LIFETIME,
    ACCESS_LIFETIME,
    REFRESH_LIFETIME,
    TokenRejected,
    TokenStore,
    TokenTheftSuspected,
    hash_token,
)
from backend.auth.web import (
    DEFAULT_COOKIE,
    CookiePolicy,
    CsrfGuard,
    CsrfRejected,
    STATE_CHANGING,
)
from backend.ownership import Owner, Session


NOW = datetime(2026, 8, 25, 14, 0, tzinfo=timezone.utc)
USER = "user-nick-0001"
ACCOUNT = "nick@example.com"


class AlwaysValid:
    """Resolves an account to the user it belongs to, or None.

    Returning an identity rather than a bool is what stops sign_in from
    authenticating one identifier and issuing a session for another.
    """

    def __init__(self, accounts=None):
        self._accounts = accounts or {ACCOUNT: USER}

    def verify(self, account: str, proof: bytes, challenge: bytes) -> str | None:
        return self._accounts.get(account) if proof == b"good" else None


def service(**overrides):
    return AuthService(
        overrides.get("tokens", TokenStore()),
        overrides.get("throttle", Throttle()),
        verifiers={"passkey": AlwaysValid()},
    )


def signed_in(subject=None, **overrides):
    subject = subject or service()
    fields = {
        "account": ACCOUNT, "method": "passkey", "proof": b"good",
        "challenge": b"challenge", "source_hash": "source-a", "device_id": "device-mac-0001",
        "now": NOW,
    }
    fields.update(overrides)
    return subject, subject.sign_in(**fields)


class TokenTests(unittest.TestCase):
    def setUp(self):
        self.store = TokenStore()

    def test_only_the_hash_is_stored(self):
        pair = self.store.issue(user_id=USER, device_id=None, source_hash="s", now=NOW)
        stored = self.store.all_for_family(str(pair.access.family_id))
        for token in stored:
            self.assertNotIn(pair.access_token, str(token))
            self.assertNotIn(pair.refresh_token, str(token))
        self.assertEqual(stored[0].token_hash, hash_token(pair.access_token))

    def test_an_access_token_is_short_lived(self):
        pair = self.store.issue(user_id=USER, device_id=None, source_hash="s", now=NOW)
        self.assertEqual(pair.access.expires_at, NOW + ACCESS_LIFETIME)
        self.store.verify(pair.access_token, "access", now=NOW + ACCESS_LIFETIME - timedelta(seconds=1))
        with self.assertRaises(TokenRejected):
            self.store.verify(pair.access_token, "access", now=NOW + ACCESS_LIFETIME)

    def test_a_refresh_chain_has_an_absolute_ceiling(self):
        # Without it, a session refreshed weekly never ends -- which is not a
        # session, it is a password that types itself.
        pair = self.store.issue(user_id=USER, device_id=None, source_hash="s", now=NOW)
        self.assertEqual(pair.refresh.family_expires_at, NOW + ABSOLUTE_LIFETIME)
        later = self.store.rotate(pair.refresh_token, source_hash="s", now=NOW + timedelta(days=1))
        self.assertEqual(later.refresh.family_expires_at, NOW + ABSOLUTE_LIFETIME)
        with self.assertRaises(TokenRejected):
            self.store.verify(later.refresh_token, "refresh", now=NOW + ABSOLUTE_LIFETIME)

    def test_a_token_of_the_wrong_kind_is_refused(self):
        pair = self.store.issue(user_id=USER, device_id=None, source_hash="s", now=NOW)
        with self.assertRaises(TokenRejected):
            self.store.verify(pair.refresh_token, "access", now=NOW)

    def test_rotation_retires_the_old_token(self):
        pair = self.store.issue(user_id=USER, device_id=None, source_hash="s", now=NOW)
        rotated = self.store.rotate(pair.refresh_token, source_hash="s", now=NOW + timedelta(minutes=1))
        self.assertNotEqual(rotated.refresh_token, pair.refresh_token)
        self.assertEqual(rotated.refresh.family_id, pair.refresh.family_id)

    def test_reusing_a_retired_token_revokes_the_whole_family(self):
        # Either it was stolen or it was replayed. Both mean the chain is no
        # longer trustworthy.
        pair = self.store.issue(user_id=USER, device_id=None, source_hash="s", now=NOW)
        rotated = self.store.rotate(pair.refresh_token, source_hash="s", now=NOW + timedelta(minutes=1))
        with self.assertRaises(TokenTheftSuspected):
            self.store.rotate(pair.refresh_token, source_hash="s", now=NOW + timedelta(minutes=2))
        with self.assertRaises(TokenRejected):
            self.store.verify(rotated.access_token, "access", now=NOW + timedelta(minutes=3))
        with self.assertRaises(TokenRejected):
            self.store.verify(rotated.refresh_token, "refresh", now=NOW + timedelta(minutes=3))

    def test_revocation_is_immediate_and_covers_the_family(self):
        pair = self.store.issue(user_id=USER, device_id=None, source_hash="s", now=NOW)
        self.assertGreaterEqual(self.store.revoke_session(str(pair.access.session_id), now=NOW), 1)
        with self.assertRaises(TokenRejected):
            self.store.verify(pair.access_token, "access", now=NOW)

    def test_signing_out_everywhere_covers_every_family(self):
        first = self.store.issue(user_id=USER, device_id=None, source_hash="a", now=NOW)
        second = self.store.issue(user_id=USER, device_id=None, source_hash="b", now=NOW)
        self.assertNotEqual(first.access.family_id, second.access.family_id)
        self.store.revoke_user(USER, now=NOW)
        for token in (first.access_token, second.access_token):
            with self.assertRaises(TokenRejected):
                self.store.verify(token, "access", now=NOW)

    def test_the_inventory_lists_live_sessions_only(self):
        pair = self.store.issue(user_id=USER, device_id="device-mac-0001", source_hash="a", now=NOW)
        self.assertEqual(len(self.store.inventory(USER, now=NOW)), 1)
        self.store.revoke_family(str(pair.access.family_id), now=NOW)
        self.assertEqual(self.store.inventory(USER, now=NOW), ())

    def test_another_users_sessions_are_not_listed(self):
        self.store.issue(user_id=USER, device_id=None, source_hash="a", now=NOW)
        self.assertEqual(self.store.inventory("user-other-0001", now=NOW), ())


class ThrottleTests(unittest.TestCase):
    def setUp(self):
        self.throttle = Throttle()

    def test_a_source_is_refused_after_enough_attempts(self):
        for index in range(SOURCE_LIMIT):
            self.throttle.record_failure(account=f"{index}@example.com", source_hash="bad", now=NOW)
        with self.assertRaises(SourceRefused):
            self.throttle.check(account="anyone@example.com", source_hash="bad", now=NOW)

    def test_an_account_backs_off_but_is_never_locked(self):
        # Locking would hand an attacker a way to lock any account they can name.
        self.throttle.record_failure(account=ACCOUNT, source_hash="a", now=NOW)
        with self.assertRaises(TooSoon):
            self.throttle.check(account=ACCOUNT, source_hash="a", now=NOW)
        self.throttle.check(account=ACCOUNT, source_hash="a", now=NOW + timedelta(seconds=2))

    def test_the_backoff_doubles_and_is_capped(self):
        self.assertEqual(Throttle.delay_after(1), timedelta(seconds=1))
        self.assertEqual(Throttle.delay_after(2), timedelta(seconds=2))
        self.assertEqual(Throttle.delay_after(3), timedelta(seconds=4))
        self.assertEqual(Throttle.delay_after(30), ACCOUNT_MAX_DELAY)

    def test_a_success_clears_the_account_but_not_the_source(self):
        # Knowing one password does not make a source that failed nineteen times
        # trustworthy.
        for index in range(SOURCE_LIMIT):
            self.throttle.record_failure(account=ACCOUNT, source_hash="bad", now=NOW)
        self.throttle.record_success(account=ACCOUNT, source_hash="bad")
        self.assertEqual(self.throttle.failures_for(ACCOUNT), 0)
        with self.assertRaises(SourceRefused):
            self.throttle.check(account=ACCOUNT, source_hash="bad", now=NOW)

    def test_old_failures_stop_counting(self):
        self.throttle.record_failure(account=ACCOUNT, source_hash="a", now=NOW)
        self.throttle.check(account=ACCOUNT, source_hash="a", now=NOW + timedelta(hours=2))


class SignInIdentityTests(unittest.TestCase):
    def test_the_session_is_issued_for_the_identity_that_authenticated(self):
        # sign_in used to take `account` AND `user_id` as independent arguments:
        # it verified the proof against `account` and then minted the session for
        # whatever `user_id` the caller named. Nothing mapped one to the other,
        # and routes.py declares POST /auth/session as the unauthenticated route
        # that would fill it from a request body. Full account takeover.
        subject = AuthService(
            TokenStore(), Throttle(),
            verifiers={"passkey": AlwaysValid({"victim@example.com": "user-victim-01"})},
        )
        pair = subject.sign_in(
            account="victim@example.com", method="passkey", proof=b"good",
            challenge=b"challenge", source_hash="source-a", now=NOW,
        )
        self.assertEqual(pair.access.user_id, "user-victim-01")

    def test_sign_in_cannot_be_handed_an_identity(self):
        # The structural half: there is no parameter to forge.
        import inspect

        self.assertNotIn("user_id", inspect.signature(AuthService.sign_in).parameters)

    def test_an_unknown_account_is_refused_even_with_a_good_proof(self):
        subject = service()
        with self.assertRaises(AuthenticationFailed):
            subject.sign_in(
                account="stranger@example.com", method="passkey", proof=b"good",
                challenge=b"challenge", source_hash="source-a", now=NOW,
            )


class MechanismTests(unittest.TestCase):
    def test_a_connector_can_never_be_a_login(self):
        # Being able to read someone's Gmail is not evidence of being them.
        for provider in CONNECTOR_PROVIDERS:
            with self.assertRaises(ConnectorIsNotALogin, msg=provider):
                mechanism(provider)
        with self.assertRaises(ConnectorIsNotALogin):
            Mechanism("google", "high", requires_challenge=True,
                      production_requires="nothing", note="should not be possible")

    def test_apple_and_passkeys_are_planned_with_their_gaps_named(self):
        for name in ("apple_sign_in", "passkey"):
            self.assertIn(name, MECHANISMS)
            self.assertEqual(MECHANISMS[name].assurance, "high")
            self.assertTrue(production_gap(name))

    def test_a_recovery_code_is_low_assurance_on_purpose(self):
        self.assertEqual(MECHANISMS["recovery_code"].assurance, "low")

    def test_an_unknown_mechanism_is_refused(self):
        with self.assertRaises(ValueError):
            mechanism("magic")


class CookieAndCsrfTests(unittest.TestCase):
    def test_the_session_cookie_is_httponly_secure_and_samesite(self):
        header = DEFAULT_COOKIE.header("opaque")
        for flag in ("HttpOnly", "Secure", "SameSite=Strict"):
            self.assertIn(flag, header)

    def test_an_insecure_cookie_policy_cannot_be_declared(self):
        for kwargs in ({"http_only": False}, {"secure": False},
                       {"same_site": "None", "secure": False}):
            with self.assertRaises(ValueError, msg=str(kwargs)):
                CookiePolicy(**kwargs)

    def test_csrf_is_required_for_cookie_state_changes_only(self):
        guard = CsrfGuard()
        for method in STATE_CHANGING:
            self.assertTrue(guard.required_for(method, cookie_authenticated=True), method)
        self.assertFalse(guard.required_for("GET", cookie_authenticated=True))
        # A bearer token is not sent automatically by a browser, so requiring a
        # CSRF token there is a ritual without a defence.
        self.assertFalse(guard.required_for("POST", cookie_authenticated=False))

    def test_a_mismatched_or_missing_csrf_token_is_refused(self):
        guard = CsrfGuard()
        issued = guard.issue("session-0001")
        for cookie, header in ((issued, "b"), (None, "b"), (issued, None)):
            with self.assertRaises(CsrfRejected):
                guard.check(method="POST", cookie_authenticated=True,
                            cookie_token=cookie, header_token=header,
                            session_id="session-0001")
        guard.check(method="POST", cookie_authenticated=True,
                    cookie_token=issued, header_token=issued, session_id="session-0001")

    def test_a_token_the_attacker_chose_is_not_a_valid_token(self):
        # Naive double-submit: anyone who can write a cookie on the origin -- a
        # subdomain takeover, cookie tossing, a non-TLS sibling -- sets BOTH
        # halves to a value they chose, and a guard that only compares the two
        # halves agrees with itself.
        guard = CsrfGuard()
        with self.assertRaises(CsrfRejected):
            guard.check(method="POST", cookie_authenticated=True,
                        cookie_token="chosen.bythe attacker", header_token="chosen.bythe attacker",
                        session_id="session-0001")

    def test_a_token_issued_for_another_session_is_refused(self):
        guard = CsrfGuard()
        issued = guard.issue("session-0001")
        with self.assertRaises(CsrfRejected):
            guard.check(method="POST", cookie_authenticated=True,
                        cookie_token=issued, header_token=issued,
                        session_id="session-0002")

    def test_a_non_ascii_token_is_refused_rather_than_crashing(self):
        # compare_digest refuses non-ASCII str, so this raised TypeError out of a
        # method whose contract is CsrfRejected -- an attacker-chosen 500.
        guard = CsrfGuard()
        with self.assertRaises(CsrfRejected):
            guard.check(method="POST", cookie_authenticated=True,
                        cookie_token="abc", header_token="ab\u00e7",
                        session_id="session-0001")


class TokenLifecycleRepairTests(unittest.TestCase):
    def setUp(self):
        self.store = TokenStore()

    def test_the_absolute_ceiling_cannot_be_raised_through_issue(self):
        # rotate() clamped correctly; issue() is public and used the caller's
        # value unclamped, so a family could be minted expiring in ten years
        # against a 90-day absolute lifetime.
        far = NOW + timedelta(days=3650)
        pair = self.store.issue(
            user_id=USER, device_id=None, source_hash="source-a", now=NOW,
            family_expires_at=far,
        )
        self.assertLessEqual(pair.access.family_expires_at, NOW + ABSOLUTE_LIFETIME)

    def test_rotation_retires_the_outstanding_access_token(self):
        # "Every refresh retires the old token" retired only the refresh half,
        # leaving the pre-rotation access token valid for its full ten minutes.
        pair = self.store.issue(
            user_id=USER, device_id=None, source_hash="source-a", now=NOW
        )
        self.store.rotate(pair.refresh_token, source_hash="source-a", now=NOW)
        with self.assertRaises(TokenRejected):
            self.store.verify(pair.access_token, "access", now=NOW + timedelta(minutes=1))

    def test_a_malformed_token_is_rejected_not_a_ValueError(self):
        # hash_token raises ValueError, which a handler catching TokenRejected
        # would let escape as a 500 on any request with no Authorization header.
        for bad in (None, "", 123):
            with self.assertRaises(TokenRejected):
                self.store.verify(bad, "access", now=NOW)


class ThrottleMemoryTests(unittest.TestCase):
    def test_the_throttle_does_not_grow_without_bound(self):
        # check() called setdefault on both dicts for every attempt including
        # successes, and nothing evicted -- so the one unauthenticated endpoint
        # was a memory exhaustion primitive.
        throttle = Throttle(max_tracked=50)
        for index in range(500):
            throttle.record_failure(
                account=f"account-{index}", source_hash=f"source-{index}", now=NOW
            )
        self.assertLessEqual(len(throttle._sources), 50)
        self.assertLessEqual(len(throttle._accounts), 50)

    def test_a_source_that_is_actively_failing_is_not_evicted(self):
        # LRU, not random: the entries worth keeping are the ones still failing.
        throttle = Throttle(max_tracked=10)
        for _ in range(5):
            throttle.record_failure(account="victim", source_hash="attacker", now=NOW)
        for index in range(50):
            throttle.record_failure(
                account=f"noise-{index}", source_hash="attacker", now=NOW
            )
        self.assertIn("attacker", throttle._sources)


class ServiceTests(unittest.TestCase):
    def test_a_successful_sign_in_produces_a_session(self):
        subject, pair = signed_in()
        session = subject.authenticate(pair.access_token, now=NOW)
        self.assertIsInstance(session, Session)
        self.assertEqual(str(session.user_id), USER)

    def test_the_session_resolves_to_the_owner_everything_else_is_judged_under(self):
        subject, pair = signed_in()
        self.assertIsInstance(subject.owner_for(pair.access_token, now=NOW), Owner)

    def test_a_device_is_an_attribute_of_a_session_not_the_proof(self):
        # Phase 14 gives devices identity. Letting one stand in for a person is
        # how "my Mac is signed in" becomes "whoever holds my Mac is me".
        subject, with_device = signed_in()
        _, without_device = signed_in(service(), device_id=None, source_hash="source-b")
        self.assertEqual(str(with_device.access.device_id), "device-mac-0001")
        self.assertIsNone(without_device.access.device_id)

    def test_a_mechanism_without_a_verifier_cannot_sign_anybody_in(self):
        subject = AuthService(verifiers={})
        with self.assertRaises(AuthenticationFailed):
            subject.sign_in(account=ACCOUNT, method="passkey", proof=b"good",
                            challenge=b"c", source_hash="s", now=NOW)

    def test_a_failed_attempt_feeds_the_throttle(self):
        subject = service()
        with self.assertRaises(AuthenticationFailed):
            subject.sign_in(account=ACCOUNT, method="passkey", proof=b"wrong",
                            challenge=b"c", source_hash="s", now=NOW)
        with self.assertRaises(TooSoon):
            subject.sign_in(account=ACCOUNT, method="passkey", proof=b"good",
                            challenge=b"c", source_hash="s", now=NOW)

    def test_a_challenge_is_required_where_the_mechanism_says_so(self):
        subject = service()
        with self.assertRaises(AuthenticationFailed):
            subject.sign_in(account=ACCOUNT, method="passkey", proof=b"good",
                            challenge=b"", source_hash="s", now=NOW)

    def test_signing_out_ends_the_session_immediately(self):
        subject, pair = signed_in()
        subject.sign_out(pair.access_token, now=NOW)
        with self.assertRaises(TokenRejected):
            subject.authenticate(pair.access_token, now=NOW)

    def test_a_new_source_alongside_an_active_session_is_noted_not_blocked(self):
        subject, _ = signed_in()
        signed_in(subject, source_hash="source-elsewhere")
        kinds = [item.kind for item in subject.suspicions]
        self.assertIn("new_source_while_another_session_is_active", kinds)
        self.assertEqual(len(subject.inventory(USER, now=NOW)), 2)

    def test_a_reused_refresh_token_is_recorded_as_suspicious(self):
        subject, pair = signed_in()
        subject.refresh(pair.refresh_token, source_hash="source-a", now=NOW + timedelta(minutes=1))
        with self.assertRaises(TokenTheftSuspected):
            subject.refresh(pair.refresh_token, source_hash="source-a", now=NOW + timedelta(minutes=2))
        self.assertIn("retired_refresh_token_reused", [item.kind for item in subject.suspicions])

    def test_a_revoked_session_still_being_presented_is_recorded(self):
        subject, pair = signed_in()
        subject.sign_out(pair.access_token, now=NOW)
        with self.assertRaises(TokenRejected):
            subject.authenticate(pair.access_token, now=NOW + timedelta(minutes=1))
        self.assertIn("revoked_session_presented", [item.kind for item in subject.suspicions])


if __name__ == "__main__":
    unittest.main()
