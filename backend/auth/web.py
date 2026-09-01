"""Cookie handling and CSRF, declared so they can be asserted.

A cookie policy in a runbook is a policy nobody checks. This one is a value with
a test.

CSRF applies to cookie-bearing state-changing requests, and to nothing else. A
bearer token in an Authorization header is not sent automatically by a browser,
so it is not vulnerable to CSRF, and requiring a token there would be a ritual
without a defence -- the kind that makes people believe a system is protected in
places it is not.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass


CSRF_BYTES = 32


@dataclass(frozen=True, slots=True)
class CookiePolicy:
    name: str = "orion_session"
    http_only: bool = True
    secure: bool = True
    same_site: str = "Strict"
    path: str = "/"
    max_age_seconds: int = 60 * 60 * 24 * 30

    def __post_init__(self) -> None:
        if self.same_site not in ("Strict", "Lax", "None"):
            raise ValueError("SameSite is Strict, Lax or None")
        if self.same_site == "None" and not self.secure:
            raise ValueError("SameSite=None requires Secure")
        if not self.http_only:
            # A session cookie readable by JavaScript is a session cookie one XSS
            # away from being someone else's.
            raise ValueError("a session cookie must be HttpOnly")
        if not self.secure:
            raise ValueError("a session cookie must be Secure")

    def header(self, value: str) -> str:
        parts = [f"{self.name}={value}", f"Path={self.path}", f"Max-Age={self.max_age_seconds}"]
        if self.http_only:
            parts.append("HttpOnly")
        if self.secure:
            parts.append("Secure")
        parts.append(f"SameSite={self.same_site}")
        return "; ".join(parts)


DEFAULT_COOKIE = CookiePolicy()

#: Methods that change something. GET is absent on purpose: a GET that changes
#: state is a bug CSRF protection would only hide.
STATE_CHANGING = ("POST", "PATCH", "PUT", "DELETE")


class CsrfRejected(RuntimeError):
    """The CSRF token was missing or did not match."""


class CsrfGuard:
    """Double-submit: a token in a cookie, echoed in a header."""

    def __init__(
        self,
        token_source=lambda: secrets.token_urlsafe(CSRF_BYTES),
        *,
        secret: bytes | None = None,
    ) -> None:
        self._new_token = token_source
        self._secret = secret or secrets.token_bytes(32)

    def issue(self, session_id: str) -> str:
        """A token bound to the session it defends.

        Naive double-submit -- a bare random value compared cookie-against-header
        -- is defeated by anyone who can write a cookie on the origin: a
        subdomain takeover, cookie tossing, any non-TLS sibling. They set both
        halves to a value they chose and the guard agrees with itself. The plan
        said "bound to the session"; the code compared a string to itself.
        """

        nonce = self._new_token()
        return f"{nonce}.{self._bind(nonce, session_id)}"

    def _bind(self, nonce: str, session_id: str) -> str:
        return hmac.new(
            self._secret, f"{nonce}|{session_id}".encode("utf-8"), hashlib.sha256
        ).hexdigest()[:32]

    def required_for(self, method: str, *, cookie_authenticated: bool) -> bool:
        return cookie_authenticated and method.upper() in STATE_CHANGING

    def check(
        self,
        *,
        method: str,
        cookie_authenticated: bool,
        cookie_token: str | None,
        header_token: str | None,
        session_id: str = "",
    ) -> None:
        if not self.required_for(method, cookie_authenticated=cookie_authenticated):
            return
        if not cookie_token or not header_token:
            raise CsrfRejected("a state-changing cookie request needs a CSRF token")
        # Encoded before comparing: compare_digest refuses non-ASCII str, so a
        # header token with one accented character raised TypeError out of a
        # method whose contract is CsrfRejected -- an attacker-chosen 500 rather
        # than a clean refusal.
        if not hmac.compare_digest(
            str(cookie_token).encode("utf-8"), str(header_token).encode("utf-8")
        ):
            raise CsrfRejected("the CSRF token did not match")
        nonce, _, presented = str(cookie_token).partition(".")
        if not presented or not hmac.compare_digest(
            presented.encode("utf-8"), self._bind(nonce, str(session_id)).encode("utf-8")
        ):
            raise CsrfRejected("that CSRF token was not issued for this session")
