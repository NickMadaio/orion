"""Opaque session tokens, stored as hashes, rotated on every refresh.

Three decisions carry this file.

**Only the hash is stored.** Phase 11's `sessions.token_hash` column already
assumed it. A stolen database should not be a stolen session.

**Rotation retires the old token.** Every refresh issues a new one.

**Reusing a retired token revokes the whole family.** Either it was stolen or it
was replayed; both mean the chain is no longer trustworthy, and the honest
response is to make the user sign in again. This is deliberately harsher than
convenient -- a refresh token that keeps working after it has been superseded is
a refresh token an attacker can keep using in parallel with the victim.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from typing import Callable, Iterable

from orion.shared.identifiers import Identifier


#: Short, because an access token is a bearer credential: whoever holds it is the
#: user until it expires.
ACCESS_LIFETIME = timedelta(minutes=10)
#: How long one refresh token lasts before it must be exchanged.
REFRESH_LIFETIME = timedelta(days=30)
#: The ceiling on a whole chain, however often it is refreshed. Without it, a
#: session refreshed weekly never ends, which is not a session -- it is a
#: password that types itself.
ABSOLUTE_LIFETIME = timedelta(days=90)

TOKEN_BYTES = 32


class TokenRejected(RuntimeError):
    """The token is unknown, expired, revoked, or retired."""


class TokenTheftSuspected(TokenRejected):
    """A retired token was presented again.

    Its own type because the response is different: not "sign in again", but
    "every token in this family is now void", and something should say so out
    loud rather than logging a failed refresh.
    """


def hash_token(token: str) -> str:
    """What gets stored. SHA-256 of the token, hex."""

    if not isinstance(token, str) or not token:
        raise ValueError("a token is a non-empty string")
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@dataclass(frozen=True, slots=True)
class SessionToken:
    """One issued token. The plaintext exists only when it is issued."""

    session_id: Identifier
    family_id: Identifier
    user_id: Identifier
    device_id: Identifier | None
    token_hash: str
    kind: str
    issued_at: datetime
    expires_at: datetime
    family_expires_at: datetime
    source_hash: str
    retired_at: datetime | None = None
    revoked_at: datetime | None = None
    last_used_at: datetime | None = None

    def __post_init__(self) -> None:
        for field in ("session_id", "family_id", "user_id"):
            object.__setattr__(self, field, Identifier(getattr(self, field)))
        if self.device_id is not None:
            object.__setattr__(self, "device_id", Identifier(self.device_id))
        if self.kind not in ("access", "refresh"):
            raise ValueError("a token is an access token or a refresh token")
        if len(self.token_hash) != 64:
            raise ValueError("token_hash is a sha-256 hex digest")

    @property
    def retired(self) -> bool:
        return self.retired_at is not None

    @property
    def revoked(self) -> bool:
        return self.revoked_at is not None

    def expired_at(self, now: datetime) -> bool:
        return now >= self.expires_at or now >= self.family_expires_at

    def usable_at(self, now: datetime) -> bool:
        return not self.retired and not self.revoked and not self.expired_at(now)


@dataclass(frozen=True, slots=True)
class IssuedPair:
    """What a caller gets once, at issue time. The plaintext is not stored."""

    access_token: str
    refresh_token: str
    access: SessionToken
    refresh: SessionToken


class TokenStore:
    """Issues, rotates, revokes. Holds hashes, never plaintext."""

    def __init__(
        self,
        *,
        token_source: Callable[[], str] = lambda: secrets.token_urlsafe(TOKEN_BYTES),
        id_source: Callable[[str], str] | None = None,
    ) -> None:
        self._tokens: dict[str, SessionToken] = {}
        self._new_token = token_source
        self._counter = 0
        self._id_source = id_source

    def _identifier(self, kind: str) -> str:
        if self._id_source is not None:
            return self._id_source(kind)
        self._counter += 1
        return f"{kind}-{self._counter:012d}"

    def issue(
        self,
        *,
        user_id: str,
        device_id: str | None,
        source_hash: str,
        now: datetime,
        family_id: str | None = None,
        family_expires_at: datetime | None = None,
    ) -> IssuedPair:
        family = Identifier(family_id or self._identifier("family"))
        # A CEILING, clamped. `family_expires_at` was used unclamped, and issue()
        # is public -- so a caller could mint a family expiring in 2036 against a
        # 90-day absolute lifetime. The rotate() path was correct; the invariant
        # lived on that path rather than on the type, which is the shape that has
        # bitten this codebase repeatedly.
        ceiling = min(family_expires_at or (now + ABSOLUTE_LIFETIME), now + ABSOLUTE_LIFETIME)
        access_plain, access = self._mint("access", user_id, device_id, source_hash, now, family, ceiling, ACCESS_LIFETIME)
        refresh_plain, refresh = self._mint("refresh", user_id, device_id, source_hash, now, family, ceiling, REFRESH_LIFETIME)
        return IssuedPair(access_plain, refresh_plain, access, refresh)

    def _mint(self, kind, user_id, device_id, source_hash, now, family, ceiling, lifetime):
        plaintext = self._new_token()
        token = SessionToken(
            session_id=self._identifier("session"),
            family_id=family,
            user_id=user_id,
            device_id=device_id,
            token_hash=hash_token(plaintext),
            kind=kind,
            issued_at=now,
            expires_at=min(now + lifetime, ceiling),
            family_expires_at=ceiling,
            source_hash=source_hash,
        )
        self._tokens[token.token_hash] = token
        return plaintext, token

    def verify(self, token: str, kind: str, *, now: datetime) -> SessionToken:
        """Reject a malformed token rather than raising ValueError at the caller.

        `hash_token` raises ValueError for None, "" or a non-string, and a
        handler catching TokenRejected let that escape as a 500 on any request
        with a missing Authorization header.
        """
        if not isinstance(token, str) or not token:
            raise TokenRejected("no token was presented")
        """Look a token up and refuse it for the right reason."""

        found = self._tokens.get(hash_token(token))
        if found is None or found.kind != kind:
            raise TokenRejected("unknown token")
        if found.revoked:
            raise TokenRejected("this session was revoked")
        if found.retired:
            raise TokenTheftSuspected("a retired token was presented")
        if found.expired_at(now):
            raise TokenRejected("this token has expired")
        self._tokens[found.token_hash] = replace(found, last_used_at=now)
        return self._tokens[found.token_hash]

    def rotate(self, refresh_token: str, *, source_hash: str, now: datetime) -> IssuedPair:
        """Exchange a refresh token for a new pair, retiring the old one.

        A retired token presented again revokes the family -- `verify` raises
        TokenTheftSuspected and this method acts on it rather than passing it up
        as an ordinary failure.
        """

        try:
            current = self.verify(refresh_token, "refresh", now=now)
        except TokenTheftSuspected:
            stolen = self._tokens.get(hash_token(refresh_token))
            if stolen is not None:
                self.revoke_family(str(stolen.family_id), now=now)
            raise
        self._tokens[current.token_hash] = replace(current, retired_at=now)
        # Retire the access token issued alongside it. The gate says "every
        # refresh retires the old token"; only the refresh half was retired, so
        # the pre-rotation access token stayed valid for its full ten minutes
        # after the user had already rotated away from it.
        for token_hash, token in list(self._tokens.items()):
            if (
                token.kind == "access"
                and str(token.family_id) == str(current.family_id)
                and token.retired_at is None
            ):
                self._tokens[token_hash] = replace(token, retired_at=now)
        return self.issue(
            user_id=str(current.user_id),
            device_id=None if current.device_id is None else str(current.device_id),
            source_hash=source_hash,
            now=now,
            family_id=str(current.family_id),
            family_expires_at=current.family_expires_at,
        )

    def revoke_family(self, family_id: str, *, now: datetime) -> int:
        revoked = 0
        for key, token in list(self._tokens.items()):
            if str(token.family_id) == str(family_id) and not token.revoked:
                self._tokens[key] = replace(token, revoked_at=now)
                revoked += 1
        return revoked

    def revoke_session(self, session_id: str, *, now: datetime) -> int:
        for key, token in list(self._tokens.items()):
            if str(token.session_id) == str(session_id):
                self._tokens[key] = replace(token, revoked_at=now)
                return self.revoke_family(str(token.family_id), now=now)
        return 0

    def revoke_user(self, user_id: str, *, now: datetime) -> int:
        families = {
            str(token.family_id) for token in self._tokens.values() if str(token.user_id) == str(user_id)
        }
        return sum(self.revoke_family(family, now=now) for family in families)

    def inventory(self, user_id: str, *, now: datetime) -> tuple[SessionToken, ...]:
        """What is active for this user. The manifest's session inventory."""

        return tuple(
            token
            for token in self._tokens.values()
            if str(token.user_id) == str(user_id) and token.kind == "refresh" and token.usable_at(now)
        )

    def families(self, user_id: str) -> tuple[str, ...]:
        return tuple(sorted({
            str(token.family_id) for token in self._tokens.values() if str(token.user_id) == str(user_id)
        }))

    def matches(self, token: str, token_hash: str) -> bool:
        """Constant-time comparison, for callers holding a stored hash."""

        return hmac.compare_digest(hash_token(token), token_hash)

    def all_for_family(self, family_id: str) -> tuple[SessionToken, ...]:
        return tuple(
            token for token in self._tokens.values() if str(token.family_id) == str(family_id)
        )
