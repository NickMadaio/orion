"""The connection lifecycle, and the reason this module cannot hold a token.

"Store credentials only in the credential vault" is a rule about where a secret
lives, and the way it fails is not somebody writing a token to a file. It fails
when a request object grows an `Authorization` header, gets retried, gets
logged, gets put in a queue -- and the token is now in four places nobody
decided to put it.

So:

- this module never imports the vault. It holds a `credential_ref`;
- `PreparedRequest` **refuses** an Authorization header in its constructor;
- authorization is a context manager that borrows, yields headers inside the
  `with`, and disposes on exit -- including when the body raises.

The object that survives the `with` is the one without the secret, and that is
enforced rather than remembered.
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Callable, Iterator, Mapping

from backend.connectors.scopes import Feature, ScopeRefused, check_minimal


class ConnectionState(str, Enum):
    """Where a connection is, and what may be done with it there."""

    CONNECTED = "connected"
    #: The grant is intact but the access token could not be used. Fetching
    #: pauses; the person is not told they have been disconnected, because they
    #: have not been.
    NEEDS_REFRESH = "needs_refresh"
    #: The grant is gone -- the person revoked it, or Google did. Only an
    #: explicit `invalid_grant` reaches this state.
    NEEDS_REAUTH = "needs_reauth"
    DISCONNECTED = "disconnected"


#: States from which fetching is allowed. NEEDS_REFRESH is not one: a fetch that
#: proceeds while the token is known bad produces a second 401, which is how a
#: retry loop turns into a rate limit and then into an account lock.
CAN_FETCH = frozenset({ConnectionState.CONNECTED})


class ConnectorRefused(RuntimeError):
    """The broker declined, and the reason names the rule."""


class AuthorizationHeaderRefused(ConnectorRefused):
    """Something tried to give a durable object a credential."""


#: Header names that carry a secret. Compared case-insensitively, because
#: `authorization` and `Authorization` are the same header to every HTTP stack
#: and different strings to a naive check.
SECRET_HEADERS = frozenset({"authorization", "proxy-authorization", "cookie", "x-goog-api-key"})


@dataclass(frozen=True, slots=True)
class PreparedRequest:
    """A request with everything except the credential.

    This is the object that gets stored, logged, queued and retried, so it is
    the object that must not be able to carry a token.
    """

    method: str
    url: str
    headers: Mapping[str, str]
    credential_ref: str

    def __post_init__(self) -> None:
        set_ = object.__setattr__
        if self.method not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
            raise ConnectorRefused(f"{self.method} is not a method")
        if not isinstance(self.url, str) or not self.url.startswith("https://"):
            raise ConnectorRefused("a connector request is https")
        headers = {str(key): str(value) for key, value in dict(self.headers).items()}
        for key in headers:
            if key.lower() in SECRET_HEADERS:
                raise AuthorizationHeaderRefused(
                    f"a prepared request may not carry {key}; authorization is borrowed "
                    f"inside `authorized()` and disposed when it ends"
                )
        set_(self, "headers", dict(headers))
        if not isinstance(self.credential_ref, str) or not self.credential_ref.strip():
            raise ConnectorRefused("a request names the credential it will be signed with")


@dataclass(frozen=True, slots=True)
class Connection:
    """A person's link to one provider."""

    connection_id: str
    user_id: str
    provider: str
    features: tuple[Feature, ...]
    scopes: tuple[str, ...]
    credential_ref: str
    state: ConnectionState = ConnectionState.CONNECTED
    failed_refreshes: int = 0

    def __post_init__(self) -> None:
        set_ = object.__setattr__
        for field in ("connection_id", "user_id", "provider", "credential_ref"):
            value = getattr(self, field)
            if not isinstance(value, str) or not value.strip():
                raise ConnectorRefused(f"{field} is required")
        set_(self, "state", ConnectionState(self.state))
        features = tuple(Feature(item) for item in self.features)
        if not features:
            raise ConnectorRefused("a connection exists to do something; name the features")
        set_(self, "features", features)
        # Every held scope must be justified by a feature this connection has.
        # A scope nothing needs is one nobody will notice is still granted.
        permitted: set[str] = set()
        for feature in features:
            permitted.update(check_minimal(feature, tuple(scopes_for(feature))))
        extra = [scope for scope in self.scopes if scope not in permitted]
        if extra:
            raise ScopeRefused(
                f"connection holds {extra[0]}, which no declared feature needs"
            )
        set_(self, "scopes", tuple(self.scopes))

    @property
    def can_fetch(self) -> bool:
        return self.state in CAN_FETCH


def scopes_for(feature: Feature) -> tuple[str, ...]:
    from backend.connectors.scopes import FEATURE_SCOPES

    return FEATURE_SCOPES[Feature(feature)]


@contextmanager
def authorized(
    request: PreparedRequest,
    borrow: Callable[[str], object],
) -> Iterator[Mapping[str, str]]:
    """Yield headers carrying the credential, and dispose of it on exit.

    `borrow` is Phase 12's `CredentialVault.borrow` or anything with its shape:
    a callable returning a context manager over the plaintext bytes. This module
    does not import the vault, so what is passed in is the only way a secret can
    reach it -- and it leaves again when this generator's `finally` runs, on the
    exceptional path as much as the normal one.
    """

    handle = borrow(request.credential_ref)
    try:
        with handle as secret:
            token = bytes(secret).decode("ascii")
            yield {**request.headers, "Authorization": f"Bearer {token}"}
    finally:
        dispose = getattr(handle, "dispose", None)
        if callable(dispose):
            dispose()


# -- the failure paths ----------------------------------------------------

#: How many consecutive refresh failures before ORION stops trying. Not
#: unlimited: a token that will never work again produces one request per sync
#: forever, and Google answers that with a rate limit that affects everything
#: else the person connected.
MAX_REFRESH_ATTEMPTS = 3


def on_fetch_unauthorized(connection: Connection) -> Connection:
    """A 401 on a data fetch. **This does not clear the grant.**

    `AGENTS.md` records why, from the Whoop client: a data-fetch 401 arrived on
    a token that had just served a request, and clearing the grant disconnected
    the user for what was a transient failure. The token is marked stale, the
    caller renews and retries once, and only an explicit revocation reaches
    NEEDS_REAUTH.
    """

    if connection.state is ConnectionState.DISCONNECTED:
        raise ConnectorRefused("a disconnected connection cannot fail a fetch")
    return replace(connection, state=ConnectionState.NEEDS_REFRESH)


def on_refresh_succeeded(connection: Connection) -> Connection:
    return replace(connection, state=ConnectionState.CONNECTED, failed_refreshes=0)


def on_refresh_failed(connection: Connection) -> Connection:
    """A refresh that failed for a reason that is not revocation.

    Counted, because the difference between "the network was down" and "this
    will never work" is only visible in how many times it happens.
    """

    attempts = connection.failed_refreshes + 1
    state = (
        ConnectionState.NEEDS_REAUTH
        if attempts >= MAX_REFRESH_ATTEMPTS
        else ConnectionState.NEEDS_REFRESH
    )
    return replace(connection, state=state, failed_refreshes=attempts)


def on_grant_revoked(connection: Connection) -> Connection:
    """`invalid_grant`: the person revoked ORION's access, or Google did.

    The only path to NEEDS_REAUTH from a single event, and it deliberately does
    **not** delete anything. Revocation says ORION may no longer read the
    calendar; it does not say the person wants their history erased, and a
    reconnect five minutes later should find their data where they left it.
    """

    return replace(connection, state=ConnectionState.NEEDS_REAUTH)


def reauthorize(
    connection: Connection,
    *,
    granted_scopes: tuple[str, ...],
    credential_ref: str,
) -> Connection:
    """Come back from NEEDS_REAUTH with a fresh grant.

    The granted scopes are checked, not assumed: an OAuth consent screen can
    return **less** than was asked for -- a person can decline one scope and
    accept the rest -- and a connection that records what it requested rather
    than what it received will fail later at a call site that has no idea why.
    """

    if connection.state is ConnectionState.DISCONNECTED:
        raise ConnectorRefused("reconnect a disconnected connection rather than reauthorizing it")
    for feature in connection.features:
        needed = set(scopes_for(feature))
        if not needed.issubset(set(granted_scopes)):
            missing = sorted(needed - set(granted_scopes))
            raise ScopeRefused(
                f"{feature.value} needs {missing[0]}, which was not granted"
            )
    return replace(
        connection,
        state=ConnectionState.CONNECTED,
        scopes=tuple(granted_scopes),
        credential_ref=credential_ref,
        failed_refreshes=0,
    )


def disconnect(connection: Connection) -> Connection:
    """Deliberate disconnection. Phase 12 revokes the credential in the same call."""

    return replace(connection, state=ConnectionState.DISCONNECTED)
