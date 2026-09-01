"""Sign in, refresh, sign out, and the three things worth calling suspicious.

The service ties the pieces together and owns one judgement: what counts as
suspicious. Deliberately narrow, and stated as facts the system already has
rather than as intelligence it does not:

- a **retired token** presented again -- the strongest signal there is, because
  the legitimate holder moved on and somebody else did not;
- a **revoked session** still being presented, which means a client did not
  notice, or was never the client;
- a session appearing from a **new source while another is active**, which is
  ordinary for a person with two computers and is worth surfacing rather than
  acting on.

Anything needing geolocation or behavioural modelling is not here and is not
pretended at.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Mapping

from backend.auth.mechanisms import Mechanism, mechanism
from backend.auth.throttle import Throttle
from backend.auth.tokens import (
    IssuedPair,
    SessionToken,
    TokenRejected,
    TokenStore,
    TokenTheftSuspected,
)
from backend.ownership import Owner, Session, resolve_owner


class AuthenticationFailed(RuntimeError):
    """The proof did not check out. Says nothing about which part."""


@dataclass(frozen=True, slots=True)
class Suspicion:
    kind: str
    user_id: str
    detail: str
    at: datetime


class AuthService:
    def __init__(
        self,
        tokens: TokenStore | None = None,
        throttle: Throttle | None = None,
        *,
        verifiers: Mapping[str, object] | None = None,
    ) -> None:
        self._tokens = tokens or TokenStore()
        self._throttle = throttle or Throttle()
        self._verifiers = dict(verifiers or {})
        self._suspicions: list[Suspicion] = []

    @property
    def suspicions(self) -> tuple[Suspicion, ...]:
        return tuple(self._suspicions)

    def sign_in(
        self,
        *,
        account: str,
        method: str,
        proof: bytes,
        challenge: bytes,
        source_hash: str,
        device_id: str | None = None,
        now: datetime,
    ) -> IssuedPair:
        """Authenticate an ACCOUNT. A device is an attribute, never the proof.

        `device_id` is recorded on the session and is not consulted when deciding
        whether the sign-in succeeds. Phase 14 gives devices their own identity;
        letting one stand in for a person is how "my Mac is signed in" becomes
        "whoever holds my Mac is me".

        There is deliberately no `user_id` parameter. This method used to take one
        alongside `account`, verify the proof against `account`, and then mint the
        session for whatever `user_id` the caller passed -- nothing mapped one to
        the other. `backend/routes.py` declares POST /auth/session as the
        unauthenticated route, so a handler filling that argument from the request
        body was full account takeover. The verifier now RESOLVES the identity,
        which is the only thing that can honestly say who proved what.
        """

        # Throttle FIRST. `mechanism()` raising for an unknown method made that
        # an unauthenticated code path with no rate limit on it at all.
        self._throttle.check(account=account, source_hash=source_hash, now=now)
        chosen: Mechanism = mechanism(method)
        verifier = self._verifiers.get(method)
        if verifier is None:
            # A mechanism is usable when a verifier is installed, not when a flag
            # says so. Nothing in this repository installs a production verifier;
            # `mechanism(name).production_requires` says what each one needs.
            self._throttle.record_failure(account=account, source_hash=source_hash, now=now)
            raise AuthenticationFailed(f"{method} has no verifier installed")
        if chosen.requires_challenge and not challenge:
            self._throttle.record_failure(account=account, source_hash=source_hash, now=now)
            raise AuthenticationFailed(f"{method} requires a challenge")
        user_id = verifier.verify(account, proof, challenge)
        if not user_id:
            # One message for a bad proof and an unknown account: distinguishing
            # them tells an attacker which accounts exist.
            self._throttle.record_failure(account=account, source_hash=source_hash, now=now)
            raise AuthenticationFailed("authentication failed")
        user_id = str(user_id)

        self._throttle.record_success(account=account, source_hash=source_hash)
        active = self._tokens.inventory(user_id, now=now)
        if active and all(token.source_hash != source_hash for token in active):
            self._note("new_source_while_another_session_is_active", user_id,
                       "a session began from a source unlike the active ones", now)
        return self._tokens.issue(
            user_id=user_id, device_id=device_id, source_hash=source_hash, now=now
        )

    def authenticate(self, access_token: str, *, now: datetime) -> Session:
        """Turn an access token into the Session everything else is judged under."""

        try:
            token = self._tokens.verify(access_token, "access", now=now)
        except TokenTheftSuspected as error:
            self._note("retired_token_presented", "unknown", str(error), now)
            raise
        except TokenRejected as error:
            if "revoked" in str(error):
                self._note("revoked_session_presented", "unknown", str(error), now)
            raise
        return Session(
            session_id=token.session_id,
            user_id=token.user_id,
            device_id=token.device_id or "device-unregistered",
        )

    def owner_for(self, access_token: str, *, now: datetime) -> Owner:
        return resolve_owner(self.authenticate(access_token, now=now))

    def refresh(self, refresh_token: str, *, source_hash: str, now: datetime) -> IssuedPair:
        try:
            return self._tokens.rotate(refresh_token, source_hash=source_hash, now=now)
        except TokenTheftSuspected as error:
            self._note("retired_refresh_token_reused", "unknown", str(error), now)
            raise

    def sign_out(self, access_token: str, *, now: datetime) -> int:
        session = self.authenticate(access_token, now=now)
        return self._tokens.revoke_session(str(session.session_id), now=now)

    def sign_out_everywhere(self, user_id: str, *, now: datetime) -> int:
        return self._tokens.revoke_user(user_id, now=now)

    def inventory(self, user_id: str, *, now: datetime) -> tuple[SessionToken, ...]:
        return self._tokens.inventory(user_id, now=now)

    #: The suspicion log is evidence, not storage. Replaying one revoked token a
    #: thousand times produced a thousand Suspicion objects, from an
    #: unauthenticated path, with nothing trimming them.
    MAX_SUSPICIONS = 1_000

    def _note(self, kind: str, user_id: str, detail: str, at: datetime) -> None:
        self._suspicions.append(Suspicion(kind=kind, user_id=user_id, detail=detail, at=at))
        if len(self._suspicions) > self.MAX_SUSPICIONS:
            # Drop the OLDEST. A ring buffer loses history; keeping the newest is
            # what an operator looking at an incident actually needs.
            del self._suspicions[: len(self._suspicions) - self.MAX_SUSPICIONS]
