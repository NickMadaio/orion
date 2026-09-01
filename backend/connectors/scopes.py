"""Which OAuth scopes ORION may ask for, and what makes a request minimal.

`calendar.readonly` is one scope and it grants every calendar a person has,
forever. It is also what almost everyone requests, because it is the one the
documentation shows first. The minimal request for what Phase 22 actually does
is three narrower scopes, so that is what is declared.

The rule that matters more than the list: a scope is classified as reading or
writing HERE, and a feature may only be granted scopes its own tier permits. A
read feature cannot be handed a write scope by a caller that assembled the list
itself, which is how "minimal scopes" survives contact with the phase that adds
writing.
"""

from __future__ import annotations

from enum import Enum


class Feature(str, Enum):
    """A thing ORION does, and therefore a reason to hold a scope."""

    CALENDAR_READ = "calendar_read"
    CALENDAR_WRITE = "calendar_write"
    GMAIL_READ = "gmail_read"
    GMAIL_DRAFT = "gmail_draft"
    GMAIL_SEND = "gmail_send"


class Access(str, Enum):
    READ = "read"
    WRITE = "write"
    SEND = "send"


GOOGLE = "https://www.googleapis.com/auth/"

#: Every scope ORION knows, with what it actually permits. A scope that is not
#: in this table cannot be requested -- there is no default, because a default
#: would silently classify whatever Google adds next.
CATALOG: dict[str, Access] = {
    f"{GOOGLE}calendar.calendarlist.readonly": Access.READ,
    f"{GOOGLE}calendar.events.readonly": Access.READ,
    f"{GOOGLE}calendar.freebusy": Access.READ,
    f"{GOOGLE}calendar.events": Access.WRITE,
    f"{GOOGLE}gmail.readonly": Access.READ,
    f"{GOOGLE}gmail.compose": Access.WRITE,
    f"{GOOGLE}gmail.send": Access.SEND,
}

#: Scopes deliberately never requested, with the reason. Present so that a later
#: reader finds a decision rather than an omission -- and so that asking for one
#: is a refusal with an explanation rather than an unknown-scope error.
NEVER_REQUESTED: dict[str, str] = {
    f"{GOOGLE}calendar": "grants full read and write over every calendar; the narrow scopes cover what ORION does",
    f"{GOOGLE}calendar.readonly": "grants every calendar; calendarlist + events + freebusy is the same capability, smaller",
    f"{GOOGLE}gmail.modify": "permits deleting and relabelling mail; ORION never needs to change a mailbox",
    f"{GOOGLE}gmail.settings.basic": "changes how the account behaves for every client, not just ORION",
    "https://mail.google.com/": "full mailbox control including permanent deletion",
}

#: What each feature is allowed to hold. The read features list only read
#: scopes, which is the property `check_minimal` enforces rather than trusts.
FEATURE_SCOPES: dict[Feature, tuple[str, ...]] = {
    Feature.CALENDAR_READ: (
        f"{GOOGLE}calendar.calendarlist.readonly",
        f"{GOOGLE}calendar.events.readonly",
        f"{GOOGLE}calendar.freebusy",
    ),
    Feature.CALENDAR_WRITE: (f"{GOOGLE}calendar.events",),
    Feature.GMAIL_READ: (f"{GOOGLE}gmail.readonly",),
    Feature.GMAIL_DRAFT: (f"{GOOGLE}gmail.compose",),
    Feature.GMAIL_SEND: (f"{GOOGLE}gmail.send",),
}

#: The highest access each feature may hold. Read features top out at READ, so
#: adding a write scope to CALENDAR_READ is caught by a test rather than by a
#: reviewer noticing.
FEATURE_CEILING: dict[Feature, Access] = {
    Feature.CALENDAR_READ: Access.READ,
    Feature.CALENDAR_WRITE: Access.WRITE,
    Feature.GMAIL_READ: Access.READ,
    Feature.GMAIL_DRAFT: Access.WRITE,
    Feature.GMAIL_SEND: Access.SEND,
}

_ORDER = (Access.READ, Access.WRITE, Access.SEND)


class ScopeRefused(ValueError):
    """A scope was refused, and the reason names the rule."""


def access_of(scope: str) -> Access:
    if scope in NEVER_REQUESTED:
        raise ScopeRefused(f"{scope} is never requested: {NEVER_REQUESTED[scope]}")
    try:
        return CATALOG[scope]
    except KeyError:
        raise ScopeRefused(f"{scope} is not a scope ORION knows") from None


def is_write(scope: str) -> bool:
    return access_of(scope) is not Access.READ


def check_minimal(feature: Feature, scopes: tuple[str, ...]) -> tuple[str, ...]:
    """The scopes for a feature, refusing anything above its ceiling.

    Takes the requested list rather than only returning the canonical one, so a
    caller that assembled scopes itself is checked instead of trusted.
    """

    feature = Feature(feature)
    ceiling = _ORDER.index(FEATURE_CEILING[feature])
    permitted = set(FEATURE_SCOPES[feature])
    ordered: list[str] = []
    for scope in scopes:
        access = access_of(scope)
        if _ORDER.index(access) > ceiling:
            raise ScopeRefused(
                f"{feature.value} may not hold {scope}: it is {access.value} access "
                f"and the feature tops out at {FEATURE_CEILING[feature].value}"
            )
        if scope not in permitted:
            raise ScopeRefused(f"{scope} is not part of {feature.value}")
        if scope in ordered:
            raise ScopeRefused(f"{scope} requested twice")
        ordered.append(scope)
    return tuple(ordered)


def for_features(*features: Feature) -> tuple[str, ...]:
    """The union of several features' scopes, deduplicated and sorted.

    Sorted so that two calls with the features in a different order produce the
    same consent screen; an OAuth grant that differs only in scope order is a
    second grant as far as the user is concerned.
    """

    union: set[str] = set()
    for feature in features:
        union.update(FEATURE_SCOPES[Feature(feature)])
    return tuple(sorted(union))


def escalation(held: tuple[str, ...], wanted: tuple[str, ...]) -> tuple[str, ...]:
    """The scopes that must be asked for on top of what is already granted.

    Incremental authorization means asking for the difference, not re-asking for
    everything. Re-requesting a held scope re-opens a consent screen the person
    already answered, and teaches them to click through it.
    """

    return tuple(scope for scope in wanted if scope not in set(held))
