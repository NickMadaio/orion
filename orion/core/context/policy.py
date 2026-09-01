"""Which domains may appear together in one context bundle.

Default deny. A bundle built for a task in domain X admits X, admits GENERAL,
and admits nothing else unless an allowance names it -- so a domain added later
is isolated until somebody decides otherwise, rather than quietly visible to
everything.
"""

from __future__ import annotations

from types import MappingProxyType
from typing import Mapping

from orion.core.context.domains import Domain


#: Cross-domain allowances, each with the reason it exists. A pair not listed
#: here is denied; that is the point.
#:
#: HEALTH and SECURITY are deliberately absent. The manifest names health in
#: both directions, and a security decision that can be argued from an email is
#: not a security decision.
ALLOWANCES: Mapping[Domain, frozenset[Domain]] = MappingProxyType(
    {
        Domain.CALENDAR: frozenset({Domain.CONTACTS, Domain.TRAVEL}),
        Domain.EMAIL: frozenset({Domain.CONTACTS}),
        Domain.TRAVEL: frozenset({Domain.CALENDAR, Domain.CONTACTS}),
        Domain.PROJECTS: frozenset({Domain.FILES}),
        Domain.COMPUTER: frozenset({Domain.FILES}),
        Domain.CONVERSATION: frozenset({Domain.CONTACTS}),
    }
)

#: The reasons, kept next to the rule so a later reader can judge whether the
#: allowance still earns its place.
ALLOWANCE_REASONS: Mapping[tuple[Domain, Domain], str] = MappingProxyType(
    {
        (Domain.CALENDAR, Domain.CONTACTS): "an event has attendees",
        (Domain.CALENDAR, Domain.TRAVEL): "an event has a location",
        (Domain.EMAIL, Domain.CONTACTS): "a message has a sender",
        (Domain.TRAVEL, Domain.CALENDAR): "a trip has dates",
        (Domain.TRAVEL, Domain.CONTACTS): "a trip has companions",
        (Domain.PROJECTS, Domain.FILES): "a project is mostly its files",
        (Domain.COMPUTER, Domain.FILES): "a device task acts on files",
        (Domain.CONVERSATION, Domain.CONTACTS): "talking about people names them",
    }
)


class CredentialLeak(ValueError):
    """A credential-domain item was offered to a context bundle.

    Separate from a normal denial because it is not a policy decision that could
    have gone the other way. No allowance admits CREDENTIALS, no configuration
    changes that, and the exception type says so to anyone catching denials
    generically.
    """


def admits(task_domain: Domain, item_domain: Domain) -> bool:
    """Whether an item from `item_domain` may enter a bundle for `task_domain`."""

    if item_domain is Domain.CREDENTIALS:
        return False
    if item_domain is task_domain:
        return True
    if item_domain is Domain.GENERAL:
        return True
    return item_domain in ALLOWANCES.get(task_domain, frozenset())


def denial_reason(task_domain: Domain, item_domain: Domain) -> str | None:
    """Why an item was refused, in words a person can read in an audit later."""

    if admits(task_domain, item_domain):
        return None
    if item_domain is Domain.CREDENTIALS:
        return "credentials never enter a context bundle"
    return (
        f"{item_domain.value} is not admitted to a {task_domain.value} task; "
        "cross-domain context is denied unless explicitly allowed"
    )


def allowance_reason(task_domain: Domain, item_domain: Domain) -> str | None:
    """The recorded justification for a cross-domain allowance, if any."""

    return ALLOWANCE_REASONS.get((task_domain, item_domain))
