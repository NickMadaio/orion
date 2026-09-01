"""Building `gmail.search` and `gmail.read` requests.

Gmail's query language has operators — `from:`, `has:`, `label:`, `in:` — and a
query is a string. That combination is a small injection surface of its own: a
search term taken from a message ("find everything from the sender of this")
that contains ` OR from:ceo@company.com` is a query that reads mail the caller
did not ask for.

So a `Query` is built from **typed terms**, never from concatenation, and any
free-text term is quoted with its quotes escaped. A term that arrives as
`UntrustedText` is quoted for the same reason and additionally recorded as
untrusted on the query, so a caller can see that a search was shaped by content.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from enum import Enum

from backend.connectors.broker import Connection, ConnectorRefused, PreparedRequest
from backend.connectors.scopes import Feature
from backend.gmail.messages import ID_PATTERN, LABEL_PATTERN, MessageRefused
from backend.gmail.untrusted import UntrustedText

API = "https://www.googleapis.com/gmail/v1"

#: Gmail lives on the same host as Calendar, so the allowlist does not widen.
EGRESS_ALLOWLIST = ("www.googleapis.com",)

#: Gmail will happily return the whole mailbox. A page cap is not a performance
#: choice: an unbounded read is how "avoid mirroring the account" is defeated by
#: a loop nobody meant to write.
MAX_PAGE_SIZE = 100


class Field(str, Enum):
    """The operators ORION may search on. There is no free `raw:` escape."""

    FROM = "from"
    TO = "to"
    SUBJECT = "subject"
    LABEL = "label"
    HAS = "has"
    IN = "in"
    NEWER_THAN = "newer_than"
    OLDER_THAN = "older_than"
    IS = "is"


#: Operators whose values are a closed set. A value outside it is refused rather
#: than passed through, because Gmail silently ignores an operator it does not
#: understand and the caller gets a much broader result than they asked for.
ENUMERATED = {
    Field.HAS: frozenset({"attachment", "userlabels", "nouserlabels"}),
    Field.IN: frozenset({"inbox", "sent", "draft", "trash", "spam", "anywhere"}),
    Field.IS: frozenset({"unread", "read", "starred", "important"}),
}


class QueryRefused(ValueError):
    """The query could not be built, and the reason names the rule."""


def _quote(value: str) -> str:
    """Quote a free-text term so its contents cannot become operators."""

    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


@dataclass(frozen=True, slots=True)
class Term:
    field: Field
    value: str
    #: True when the value came from message content rather than from the person.
    from_untrusted: bool = False

    def __post_init__(self) -> None:
        set_ = object.__setattr__
        set_(self, "field", Field(self.field))
        if isinstance(self.value, UntrustedText):
            set_(self, "value", self.value.value)
            set_(self, "from_untrusted", True)
        if not isinstance(self.value, str) or not self.value.strip():
            raise QueryRefused(f"{self.field.value} needs a value")
        try:
            self.value.encode("utf-8")
        except UnicodeEncodeError as error:
            # A lone surrogate arrives from provider JSON and cannot be encoded.
            # It used to raise UnicodeEncodeError from inside `_urlencode`, deep
            # in a query builder, rather than being refused where it entered.
            raise QueryRefused(
                f"{self.field.value} contains an unpaired surrogate and is not encodable"
            ) from error
        allowed = ENUMERATED.get(self.field)
        if allowed is not None and self.value.lower() not in allowed:
            raise QueryRefused(
                f"{self.field.value}:{self.value} is not one of {sorted(allowed)}; "
                f"Gmail ignores an operator it does not understand and returns far more "
                f"than was asked for"
            )
        if self.field is Field.LABEL and not LABEL_PATTERN.match(self.value):
            raise QueryRefused("a label term is a label id")
        if self.field in (Field.NEWER_THAN, Field.OLDER_THAN):
            if not self.value[:-1].isdigit() or self.value[-1] not in "dmy":
                raise QueryRefused("a relative age is like 7d, 3m or 1y")

    def render(self) -> str:
        if self.field in ENUMERATED or self.field in (Field.NEWER_THAN, Field.OLDER_THAN):
            return f"{self.field.value}:{self.value}"
        return f"{self.field.value}:{_quote(self.value)}"


@dataclass(frozen=True, slots=True)
class Query:
    """A Gmail search, assembled from terms rather than written as a string."""

    terms: tuple[Term, ...]

    def __post_init__(self) -> None:
        if not self.terms:
            raise QueryRefused(
                "an empty query matches the whole mailbox, which is the thing this "
                "phase exists not to do"
            )
        for term in self.terms:
            if not isinstance(term, Term):
                raise QueryRefused("a query is built from Terms, not strings")

    @property
    def shaped_by_untrusted_content(self) -> bool:
        """Whether any term came from a message rather than from the person."""

        return any(term.from_untrusted for term in self.terms)

    def render(self) -> str:
        # Sorted, so the same query is the same string -- a cache key and a
        # sync cursor both depend on that, and term order is not meaningful.
        return " ".join(sorted(term.render() for term in self.terms))


def _require_read(connection: Connection) -> None:
    if Feature.GMAIL_READ not in connection.features:
        raise ConnectorRefused("this connection does not carry gmail read")
    if not connection.can_fetch:
        raise ConnectorRefused(
            f"a connection in {connection.state.value} does not fetch; "
            f"refresh or reauthorize first"
        )


def search_request(
    connection: Connection,
    query: Query,
    *,
    page_size: int = 25,
    page_token: str | None = None,
) -> PreparedRequest:
    """`gmail.search` — ids only.

    Gmail's list endpoint returns ids and thread ids and nothing else, which is
    the right shape for this phase: searching does not read anybody's mail.
    """

    _require_read(connection)
    if type(page_size) is not int or isinstance(page_size, bool) or not 1 <= page_size <= MAX_PAGE_SIZE:
        raise QueryRefused(f"a page is between 1 and {MAX_PAGE_SIZE} messages")
    parameters = {"maxResults": str(page_size), "q": query.render()}
    if page_token is not None:
        if not ID_PATTERN.match(page_token):
            raise QueryRefused("a page token is an opaque provider id")
        parameters["pageToken"] = page_token
    encoded = "&".join(
        f"{key}={_urlencode(value)}" for key, value in sorted(parameters.items())
    )
    return PreparedRequest(
        method="GET",
        url=f"{API}/users/me/messages?{encoded}",
        headers={"Accept": "application/json"},
        credential_ref=connection.credential_ref,
    )


def read_request(connection: Connection, message_id: str) -> PreparedRequest:
    """`gmail.read` — one message, named explicitly.

    Takes a single id rather than a list. A batch read is the shape that turns
    into a mirror, and asking for messages one at a time makes the volume of a
    sync visible in the call count.
    """

    _require_read(connection)
    if not ID_PATTERN.match(str(message_id)):
        raise MessageRefused("message_id must be a provider id")
    return PreparedRequest(
        method="GET",
        url=f"{API}/users/me/messages/{message_id}?format=full",
        headers={"Accept": "application/json"},
        credential_ref=connection.credential_ref,
    )


#: Percent-encoding, by hand. `urllib.parse.quote` is the obvious call and
#: `backend/boundaries.py` refuses it -- the whole of `urllib` belongs to
#: `egress.py`, because a module that can import a URL library is a module that
#: can be given an HTTP client later without anybody noticing. The check caught
#: this import when it was written, which is the check doing its job.
_UNRESERVED = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
)


def _urlencode(value: str) -> str:
    """Percent-encode every byte that is not unreserved, UTF-8 first."""

    return "".join(
        chr(byte) if chr(byte) in _UNRESERVED else f"%{byte:02X}"
        for byte in value.encode("utf-8")
    )
