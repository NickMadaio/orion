"""The two message types, and the one that may be stored.

The manifest's rule is "avoid mirroring the complete Gmail account into ORION
storage" and "store only minimal metadata". Implemented as a policy about what a
sync job fetches, that lasts until the first feature that wants a subject line.

So it is a rule about a **type**. `StoredMessage` has no field that could hold
message text — no body, no snippet, and no subject. Its fields are ids,
timestamps, label ids, booleans and counts, and `test_v2_gmail_read` walks the
dataclass and fails if a free-text field ever appears.

The subject is content. Phase 27's inbox will want to show one, and the answer is
that it fetches it at display time — which is what "keep Gmail as the source of
truth" means as a design rather than as a slogan.

`FetchedMessage` is the transient one. It holds `UntrustedText` rather than
`str`, so its content arrives already carrying Phase 3's provenance, and
`to_stored()` is the only bridge between them — it drops everything.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone

from backend.gmail.untrusted import UntrustedRefused, UntrustedText


#: Gmail ids are hex-ish opaque strings. Constrained so that an id field cannot
#: quietly become a place to put a sentence.
#:
#: `\Z`, not `$`. In Python `$` also matches immediately BEFORE a trailing
#: newline, so `"abc\n"` passed this check -- and `read_request` is the one
#: place a validated id is interpolated into a URL without percent-encoding.
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}\Z")

#: Gmail's own label ids, spelled the way Gmail actually spells them: system
#: labels are upper snake (`INBOX`, `CATEGORY_PERSONAL`), user labels are
#: `Label_<n>`.
#:
#: The previous pattern was the id pattern -- 128 characters of anything
#: hyphen-joined -- which admitted whole sentences. An independent review put
#: roughly five kilobytes of prompt-injection text into a `StoredMessage`
#: through forty label ids, defeating the one property this phase exists to
#: have. A label is a Gmail identifier, not a name a person typed, and this is
#: what those look like.
LABEL_PATTERN = re.compile(r"^(?:[A-Z][A-Z0-9_]{0,39}|Label_[0-9]{1,19})\Z")

#: Gmail's own ceiling is 10,000 labels per mailbox; a single MESSAGE carrying
#: more than this is not a mailbox fact, it is a channel. Bounded because an
#: unbounded list of bounded strings is still an unbounded string.
MAX_LABELS = 64

#: Counts are counts. An int is a container -- `int.from_bytes(b"...")` round
#: trips a sentence through one intact -- so they are bounded at values no real
#: message reaches.
MAX_COUNT = 10_000


class MessageRefused(ValueError):
    """The message could not be built, and the reason names the rule."""


#: Characters that must never appear in an address. CR and LF are the ones that
#: matter: `"a@b.com\r\nBcc: attacker@evil.example"` passed the old
#: `"@" in value` check and reached a Draft's recipient list, which is a
#: header-injection waiting for the MIME serialiser that does not exist yet.
#: The right time to close that is before the serialiser trusts the type.
_FORBIDDEN_IN_ADDRESS = frozenset("\r\n\t\x00 <>,;\"\\()[]")

MAX_ADDRESS = 320
MAX_LOCAL_PART = 64
MAX_DOMAIN = 255


def encodable(value: str, field: str) -> str:
    """Refuse text that is not text.

    A lone surrogate (U+D800-U+DFFF) cannot be encoded as UTF-8 and arrives
    from `json.loads('"\\ud83d"')` -- which is to say, from provider JSON. Two
    reasons it must not get past here: `json.dumps` with the default
    `ensure_ascii=True` escapes an astral character as a surrogate PAIR, so a
    lone-surrogate string hashes IDENTICALLY to the real character (a genuine
    collision in a value used as an authorisation token, found by an
    independent review on the recipient field); and anything that later encodes
    it raises deep inside whatever is holding it.
    """

    if not isinstance(value, str):
        raise MessageRefused(f"{field} is text")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as error:
        raise MessageRefused(
            f"{field} contains an unpaired surrogate and is not encodable text"
        ) from error
    return value


def _address_or_refuse(value: object) -> str:
    """Validate an address properly.

    The previous check was `"@" in value`, which accepted `"@"`, `"a@b@c.com"`,
    `" @b.com"`, `"a@b.com>, evil@x.com"` and CRLF injection. None of those is a
    hypothetical: every one arrives from an attacker-controlled `From` header.
    """

    if not isinstance(value, str):
        raise MessageRefused("an address is text")
    address = encodable(value, "an address").strip()
    if not address or len(address) > MAX_ADDRESS:
        raise MessageRefused("an address is between one and 320 characters")
    if any(character in _FORBIDDEN_IN_ADDRESS for character in address):
        raise MessageRefused(f"{address!r} contains a character an address may not")
    if any(ord(character) < 0x20 or ord(character) == 0x7F for character in address):
        raise MessageRefused("an address contains no control characters")
    if address.count("@") != 1:
        raise MessageRefused("an address has exactly one @")
    local, _, domain = address.partition("@")
    if not local or len(local) > MAX_LOCAL_PART:
        raise MessageRefused("an address has a local part")
    if not domain or len(domain) > MAX_DOMAIN or "." not in domain:
        raise MessageRefused("an address has a dotted domain")
    labels = domain.split(".")
    if any(not label or label.startswith("-") or label.endswith("-") for label in labels):
        raise MessageRefused(f"{domain!r} is not a domain")
    return address


def _labels(values: object) -> tuple[str, ...]:
    """Validate a label list. Used by BOTH message types.

    `FetchedMessage` previously skipped this entirely, so arbitrary prose lived
    in one unchallenged and only `StoredMessage`'s single regex stood between it
    and the durable record. Validating at both ends means the bridge is not the
    only guard.
    """

    labels = tuple(values)
    if len(labels) > MAX_LABELS:
        raise MessageRefused(f"{len(labels)} labels is not a property of a message")
    for label in labels:
        if not isinstance(label, str) or not LABEL_PATTERN.match(label):
            raise MessageRefused(f"{label!r} is not a Gmail label id")
    if len(set(labels)) != len(labels):
        raise MessageRefused("a label is listed twice")
    return labels


def _id(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not ID_PATTERN.match(value):
        raise MessageRefused(f"{field_name} must be a provider id")
    return value


@dataclass(frozen=True, slots=True)
class StoredMessage:
    """The only thing ORION keeps. No text of any kind.

    Adding `subject`, `snippet`, `body` or `preview` to this class reopens
    exactly what this phase closed. The field walk in the tests is what will
    notice.
    """

    message_id: str
    thread_id: str
    received_at: datetime
    label_ids: tuple[str, ...] = ()
    has_attachments: bool = False
    attachment_count: int = 0
    size_estimate: int = 0
    #: Counts, not addresses. How many people were on a thread is structure;
    #: who they were is content, and the person's contacts are not ORION's to
    #: accumulate as a side effect of reading mail.
    recipient_count: int = 0
    is_unread: bool = False

    def __post_init__(self) -> None:
        set_ = object.__setattr__
        set_(self, "message_id", _id(self.message_id, "message_id"))
        set_(self, "thread_id", _id(self.thread_id, "thread_id"))
        if not isinstance(self.received_at, datetime) or self.received_at.tzinfo is None:
            raise MessageRefused("received_at must be an aware datetime")
        set_(self, "received_at", self.received_at.astimezone(timezone.utc))
        labels = _labels(self.label_ids)
        set_(self, "label_ids", labels)
        for name in ("attachment_count", "size_estimate", "recipient_count"):
            value = getattr(self, name)
            if type(value) is not int or isinstance(value, bool) or value < 0:
                raise MessageRefused(f"{name} is a count")
            if value > MAX_COUNT:
                raise MessageRefused(
                    f"{name} of {value} is not a count of anything on a real message"
                )
        if self.has_attachments != (self.attachment_count > 0):
            # Two fields that can disagree are two fields that will.
            raise MessageRefused("has_attachments and attachment_count disagree")


@dataclass(frozen=True, slots=True)
class Address:
    """One participant, kept apart from the text so it is never parsed out of it."""

    address: str
    display_name: UntrustedText | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "address", _address_or_refuse(self.address))
        if self.display_name is not None and not isinstance(self.display_name, UntrustedText):
            # A display name is attacker-chosen text. "Google Security Team"
            # in a From line is the oldest phishing there is, and it must not
            # arrive as a bare string that reads like a fact.
            raise UntrustedRefused("a display name is untrusted text")

    @property
    def domain(self) -> str:
        return self.address.rsplit("@", 1)[-1].lower()


@dataclass(frozen=True, slots=True)
class FetchedMessage:
    """A message as it is held while answering one question. Never stored.

    Every text-bearing field is `UntrustedText`, so content cannot enter this
    type as a bare `str` that later travels onward with nothing attached.
    """

    message_id: str
    thread_id: str
    received_at: datetime
    sender: Address
    recipients: tuple[Address, ...]
    subject: UntrustedText
    body: UntrustedText
    label_ids: tuple[str, ...] = ()
    attachment_names: tuple[UntrustedText, ...] = ()

    def __post_init__(self) -> None:
        set_ = object.__setattr__
        set_(self, "message_id", _id(self.message_id, "message_id"))
        set_(self, "thread_id", _id(self.thread_id, "thread_id"))
        if not isinstance(self.received_at, datetime) or self.received_at.tzinfo is None:
            raise MessageRefused("received_at must be an aware datetime")
        set_(self, "received_at", self.received_at.astimezone(timezone.utc))
        for name in ("subject", "body"):
            if not isinstance(getattr(self, name), UntrustedText):
                raise UntrustedRefused(f"{name} is untrusted text, not a string")
        for name in ("attachment_names",):
            for item in getattr(self, name):
                if not isinstance(item, UntrustedText):
                    raise UntrustedRefused(f"every {name} entry is untrusted text")
        set_(self, "label_ids", _labels(self.label_ids))
        if not isinstance(self.sender, Address):
            raise MessageRefused("sender is an Address")
        for recipient in self.recipients:
            if not isinstance(recipient, Address):
                raise MessageRefused("every recipient is an Address")

    def to_stored(self) -> StoredMessage:
        """The part of this message ORION may keep.

        The only bridge between the two types, and it drops every text field.
        A reader checking whether content can be persisted has one function to
        read rather than every call site that touches a message.
        """

        return StoredMessage(
            message_id=self.message_id,
            thread_id=self.thread_id,
            received_at=self.received_at,
            label_ids=self.label_ids,
            has_attachments=bool(self.attachment_names),
            attachment_count=len(self.attachment_names),
            recipient_count=len(self.recipients),
            is_unread="UNREAD" in self.label_ids,
        )


def from_provider(raw: Mapping[str, object]) -> FetchedMessage:
    """Turn one Gmail message into ORION's shape.

    Every header value becomes `UntrustedText` at the point it is read, rather
    than a few lines later. The gap between "parsed" and "wrapped" is where a
    bare string escapes.
    """

    message_id = _id(raw.get("id"), "id")
    thread_id = _id(raw.get("threadId"), "threadId")
    headers = raw.get("headers") or {}
    if not isinstance(headers, Mapping):
        raise MessageRefused("headers is an object")
    internal = raw.get("internalDate")
    if not isinstance(internal, (int, str)):
        raise MessageRefused("internalDate is required to place a message in time")
    received = datetime.fromtimestamp(int(internal) / 1000, tz=timezone.utc)

    return FetchedMessage(
        message_id=message_id,
        thread_id=thread_id,
        received_at=received,
        sender=_address(str(headers.get("From") or ""), message_id),
        recipients=tuple(
            _address(part, message_id)
            for part in str(headers.get("To") or "").split(",")
            if part.strip()
        ),
        subject=UntrustedText(value=str(headers.get("Subject") or ""), source=message_id),
        body=UntrustedText(value=str(raw.get("body") or ""), source=message_id),
        label_ids=tuple(str(item) for item in (raw.get("labelIds") or ())),
        attachment_names=tuple(
            UntrustedText(value=str(name), source=message_id)
            for name in (raw.get("attachmentNames") or ())
        ),
    )


def _address(value: str, source: str) -> Address:
    """Split `Display Name <a@b.c>` without trusting the display half."""

    text = value.strip()
    if "<" in text and text.endswith(">"):
        name, _, rest = text.partition("<")
        return Address(
            address=rest[:-1].strip(),
            display_name=UntrustedText(value=name.strip(), source=source)
            if name.strip()
            else None,
        )
    return Address(address=text)
