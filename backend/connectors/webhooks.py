"""Webhook subscriptions, validation, renewal — and the content that cannot arrive.

The manifest's rule is "treat webhooks as change signals, not canonical state".
Implemented as a convention, that rule is one refactor from gone: the handler
*chooses* to re-fetch, and the day somebody notices the payload already has the
event, they use it. A forged POST is then a way to write events into a person's
calendar.

So `Notification` has no field an event could live in. It carries a channel, a
resource, a state word and a message number, and the only thing a handler can
produce from it is `FetchRequired`. Content injection is not blocked here; it is
unrepresentable.

Validation is the other half. Google's headers are attacker-controlled until
proven otherwise, so every one is checked against the stored subscription, and
the token comparison is constant-time -- a token checked with `==` leaks its
prefix to anyone willing to send a few thousand requests.
"""

from __future__ import annotations

import hmac
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from enum import Enum


#: Google will not keep a calendar channel alive beyond about a month. Renewing
#: at the last minute means any hiccup drops the channel silently, so renewal
#: opens a day early.
MAX_CHANNEL_LIFETIME = timedelta(days=30)
RENEWAL_MARGIN = timedelta(days=1)


class ResourceState(str, Enum):
    """The words Google puts in `X-Goog-Resource-State`."""

    #: The handshake sent when a channel opens. It means "the channel works",
    #: not "something changed", and treating it as a change causes a full sync
    #: on every subscription renewal.
    SYNC = "sync"
    EXISTS = "exists"
    NOT_EXISTS = "not_exists"


class WebhookRefused(ValueError):
    """The notification was rejected, and the reason names the check."""


@dataclass(frozen=True, slots=True)
class Subscription:
    """A channel ORION opened, and the secrets it is validated against."""

    channel_id: str
    user_id: str
    connection_id: str
    resource_id: str
    #: A reference into the vault, never a value. The schema comment on
    #: `webhook_subscriptions.secret_ref` says the same thing.
    token_ref: str
    expires_at: datetime
    created_at: datetime
    last_message_number: int = 0

    def __post_init__(self) -> None:
        set_ = object.__setattr__
        for field in ("channel_id", "user_id", "connection_id", "resource_id", "token_ref"):
            value = getattr(self, field)
            if not isinstance(value, str) or not value.strip():
                raise WebhookRefused(f"{field} is required")
        for field in ("expires_at", "created_at"):
            value = getattr(self, field)
            if not isinstance(value, datetime) or value.tzinfo is None:
                raise WebhookRefused(f"{field} must be an aware datetime")
            set_(self, field, value.astimezone(timezone.utc))
        if self.expires_at <= self.created_at:
            raise WebhookRefused("a channel that expires before it starts receives nothing")
        if self.expires_at - self.created_at > MAX_CHANNEL_LIFETIME:
            raise WebhookRefused(
                "a channel cannot outlive the provider's maximum; it would look alive and be dead"
            )
        if type(self.last_message_number) is not int or self.last_message_number < 0:
            raise WebhookRefused("message numbers start at zero")

    def expired(self, now: datetime) -> bool:
        return now >= self.expires_at

    def needs_renewal(self, now: datetime) -> bool:
        return now >= self.expires_at - RENEWAL_MARGIN


@dataclass(frozen=True, slots=True)
class Notification:
    """What arrived. Deliberately incapable of carrying calendar content.

    Adding a `payload`, `body`, `event` or `items` field to this class would
    reopen the hole this phase exists to close. `test_v2_calendar_read` walks
    the field list and fails if one appears.
    """

    channel_id: str
    resource_id: str
    state: ResourceState
    message_number: int
    token: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "state", ResourceState(self.state))
        if type(self.message_number) is not int or self.message_number < 1:
            raise WebhookRefused("a notification is numbered from one")


@dataclass(frozen=True, slots=True)
class FetchRequired:
    """The only thing a valid notification can produce.

    It names what to go and read. It does not contain what was read, and it
    cannot: the fetch has not happened yet.
    """

    user_id: str
    connection_id: str
    resource_id: str
    reason: str


def _aware(now: object) -> datetime:
    """A caller-supplied clock, checked.

    `backend/connectors/sync.py` already refuses a naive `now`; this module
    compared one straight against normalised aware values and produced a raw
    `TypeError` from deep inside a validator. Two modules in one package
    disagreeing at exactly the aware/naive boundary is how the careful one
    stops being trusted.
    """

    if not isinstance(now, datetime) or now.tzinfo is None:
        raise WebhookRefused("now must be an aware datetime")
    return now.astimezone(timezone.utc)


def validate(
    notification: Notification,
    subscription: Subscription,
    *,
    expected_token: str,
    now: datetime,
) -> None:
    """Every check, in the order that fails cheapest first.

    `expected_token` is borrowed from the vault by the caller. It is compared
    with `hmac.compare_digest`, because `==` on a secret returns at the first
    differing byte and a few thousand requests turn that into the token.
    """

    now = _aware(now)
    if notification.channel_id != subscription.channel_id:
        raise WebhookRefused("unknown channel")
    if notification.resource_id != subscription.resource_id:
        # A valid channel id with somebody else's resource id is an attempt to
        # make ORION fetch a resource this subscription never covered.
        raise WebhookRefused("the channel does not watch that resource")
    if subscription.expired(now):
        raise WebhookRefused("the channel has expired; notifications on it are not trusted")
    if not hmac.compare_digest(notification.token, expected_token):
        raise WebhookRefused("the channel token does not match")
    if notification.message_number <= subscription.last_message_number:
        # Google numbers messages per channel. A number that does not advance is
        # a replay or a reorder, and acting on it re-runs work that was already
        # done -- at best wasteful, at worst a fetch loop.
        raise WebhookRefused(
            f"message {notification.message_number} is not newer than "
            f"{subscription.last_message_number}"
        )


def handle(
    notification: Notification,
    subscription: Subscription,
    *,
    expected_token: str,
    now: datetime,
) -> tuple[Subscription, FetchRequired | None]:
    """Validate, record the message number, and say whether to fetch.

    Returns the updated subscription even when there is nothing to fetch: the
    message number must advance on a `sync` handshake too, or a replay of the
    handshake is accepted forever.
    """

    validate(notification, subscription, expected_token=expected_token, now=now)
    advanced = replace(subscription, last_message_number=notification.message_number)
    if notification.state is ResourceState.SYNC:
        # The handshake. It says the channel works. Treating it as a change is
        # how every renewal turns into a full calendar sync.
        return advanced, None
    return advanced, FetchRequired(
        user_id=subscription.user_id,
        connection_id=subscription.connection_id,
        resource_id=subscription.resource_id,
        reason=f"notification state {notification.state.value}",
    )


@dataclass(frozen=True, slots=True)
class Renewal:
    """What renewal produced, and whether history was lost doing it."""

    subscription: Subscription
    recreated: bool
    #: True when notifications could have been missed, so the caller must
    #: reconcile rather than resume from its sync token.
    reconciliation_required: bool


def renew(
    subscription: Subscription,
    *,
    now: datetime,
    new_channel_id: str,
    new_token_ref: str,
    lifetime: timedelta = MAX_CHANNEL_LIFETIME,
) -> Renewal:
    """Extend a live channel, or replace a dead one.

    These are different operations and conflating them is the bug: "renewing" an
    already-expired channel produces something that looks subscribed and
    receives nothing, and the failure is silent until somebody notices their
    calendar stopped updating a fortnight ago.

    A replaced channel also means a gap. Notifications that arrived while
    nothing was listening are gone -- Google does not replay them -- so the
    caller is told to reconcile instead of trusting its sync token.
    """

    now = _aware(now)
    if now < subscription.expires_at - RENEWAL_MARGIN:
        raise WebhookRefused(
            "renewing early wastes a channel; renewal opens one day before expiry"
        )
    if lifetime > MAX_CHANNEL_LIFETIME:
        raise WebhookRefused("a channel cannot be asked to live longer than the provider allows")
    if subscription.expired(now):
        return Renewal(
            subscription=Subscription(
                channel_id=new_channel_id,
                user_id=subscription.user_id,
                connection_id=subscription.connection_id,
                resource_id=subscription.resource_id,
                token_ref=new_token_ref,
                created_at=now,
                expires_at=now + lifetime,
                last_message_number=0,
            ),
            recreated=True,
            reconciliation_required=True,
        )
    return Renewal(
        subscription=replace(
            subscription,
            channel_id=new_channel_id,
            token_ref=new_token_ref,
            created_at=now,
            expires_at=now + lifetime,
            last_message_number=0,
        ),
        recreated=False,
        reconciliation_required=False,
    )
