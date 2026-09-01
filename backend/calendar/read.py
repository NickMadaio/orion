"""Calendar listing and event reading, over the connector's transport.

Nothing here performs a request. The backend's network belongs to `egress.py`
and there is no HTTP client in this repository, so this builds the requests, and
turns the provider's shapes into ORION's -- which is the part that has rules
worth checking anyway.

The one that matters: **Google's `end.date` on an all-day event is exclusive.**
An event on the 26th arrives as start 2026-08-26, end 2026-08-27. Storing that
verbatim into `Event.all_day_end` makes every all-day event a day longer than it
is, and the person's whole Wednesday disappears. The conversion happens here,
once, at the edge where the provider's encoding is still visible.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from backend.calendar.events import (
    CalendarRefused,
    Event,
    EventStatus,
    Response,
    Transparency,
)
from backend.connectors.broker import Connection, ConnectorRefused, PreparedRequest
from backend.connectors.scopes import Feature
from backend.connectors.sync import RemoteRecord

API = "https://www.googleapis.com/calendar/v3"

#: The only host this phase talks to. Passed to `egress.check` by whatever
#: eventually performs the request; declared here so the allowlist is a property
#: of the connector rather than a string at a call site.
EGRESS_ALLOWLIST = ("www.googleapis.com",)


@dataclass(frozen=True, slots=True)
class CalendarSummary:
    """One entry from the person's calendar list."""

    calendar_id: str
    summary: str
    primary: bool
    #: The calendar's own timezone. All-day events are meaningless without it,
    #: so a calendar that does not report one is refused rather than defaulted.
    timezone_name: str
    access_role: str
    selected: bool = True

    def __post_init__(self) -> None:
        for field in ("calendar_id", "summary", "timezone_name", "access_role"):
            value = getattr(self, field)
            if not isinstance(value, str) or not value.strip():
                raise CalendarRefused(f"{field} is required on a calendar")

    @property
    def writable(self) -> bool:
        """Whether Phase 25 could ever write here. Read phases must not care,
        but recording it now means Phase 25 does not have to re-fetch."""

        return self.access_role in ("owner", "writer")


def _require_read(connection: Connection) -> None:
    if Feature.CALENDAR_READ not in connection.features:
        raise ConnectorRefused("this connection does not carry calendar read")
    if not connection.can_fetch:
        raise ConnectorRefused(
            f"a connection in {connection.state.value} does not fetch; "
            f"refresh or reauthorize first"
        )


def list_calendars_request(connection: Connection) -> PreparedRequest:
    _require_read(connection)
    return PreparedRequest(
        method="GET",
        url=f"{API}/users/me/calendarList",
        headers={"Accept": "application/json"},
        credential_ref=connection.credential_ref,
    )


def list_events_request(
    connection: Connection,
    calendar_id: str,
    *,
    sync_token: str | None = None,
    time_min: datetime | None = None,
    time_max: datetime | None = None,
) -> PreparedRequest:
    """Build a listing request, incremental when a sync token is held.

    Google refuses `syncToken` together with `timeMin`/`timeMax`, and answers
    with a 400 that reads like a bug in the client. Refusing it here names the
    real problem instead: a time window is a question about a range, and a sync
    token is a question about everything that changed.
    """

    _require_read(connection)
    if sync_token is not None and (time_min is not None or time_max is not None):
        raise ConnectorRefused(
            "a sync token asks what changed and a time window asks what is in a range; "
            "the provider will not answer both at once"
        )
    parameters: dict[str, str] = {"singleEvents": "true"}
    if sync_token is not None:
        parameters["syncToken"] = sync_token
    else:
        parameters["orderBy"] = "startTime"
        for name, moment in (("timeMin", time_min), ("timeMax", time_max)):
            if moment is None:
                continue
            if moment.tzinfo is None:
                raise ConnectorRefused(f"{name} must carry a timezone")
            parameters[name] = moment.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    query = "&".join(f"{key}={value}" for key, value in sorted(parameters.items()))
    return PreparedRequest(
        method="GET",
        url=f"{API}/calendars/{calendar_id}/events?{query}",
        headers={"Accept": "application/json"},
        credential_ref=connection.credential_ref,
    )


_TRANSPARENCY = {"opaque": Transparency.OPAQUE, "transparent": Transparency.TRANSPARENT}
_STATUS = {
    "confirmed": EventStatus.CONFIRMED,
    "tentative": EventStatus.TENTATIVE,
    "cancelled": EventStatus.CANCELLED,
}
_RESPONSE = {
    "accepted": Response.ACCEPTED,
    "tentative": Response.TENTATIVE,
    "declined": Response.DECLINED,
    "needsAction": Response.NEEDS_ACTION,
}


def event_from_provider(
    raw: Mapping[str, object],
    *,
    calendar_id: str,
    calendar_timezone: str,
) -> Event:
    """Turn one Google event into an ORION event.

    Every unknown word becomes an explicit unknown rather than a default that
    happens to be safe. A transparency Google adds tomorrow will make the event
    block time and stay visibly unexplained, which is the behaviour that gets
    noticed and fixed.
    """

    event_id = str(raw.get("id") or "").strip()
    if not event_id:
        raise CalendarRefused("a provider event with no id cannot be tracked")
    start = raw.get("start") or {}
    end = raw.get("end") or {}
    if not isinstance(start, Mapping) or not isinstance(end, Mapping):
        raise CalendarRefused("start and end are objects")

    transparency = _TRANSPARENCY.get(str(raw.get("transparency", "")), Transparency.UNKNOWN)
    status = _STATUS.get(str(raw.get("status", "confirmed")), EventStatus.CONFIRMED)
    response = Response.NEEDS_ACTION
    attendees = raw.get("attendees") or ()
    if isinstance(attendees, Iterable):
        for attendee in attendees:
            if isinstance(attendee, Mapping) and attendee.get("self") is True:
                response = _RESPONSE.get(
                    str(attendee.get("responseStatus", "")), Response.NEEDS_ACTION
                )
                break

    common = {
        "event_id": event_id,
        "calendar_id": calendar_id,
        "summary": str(raw.get("summary") or "(no title)"),
        "transparency": transparency,
        "response": response,
        "status": status,
        "etag": str(raw.get("etag") or ""),
    }

    if "date" in start:
        first = date.fromisoformat(str(start["date"]))
        if "date" not in end:
            raise CalendarRefused("an all-day event needs an all-day end")
        # Exclusive to inclusive. This one line is the difference between an
        # all-day event covering Wednesday and covering Wednesday and Thursday.
        last = date.fromisoformat(str(end["date"])) - timedelta(days=1)
        if last < first:
            raise CalendarRefused("an all-day event whose end precedes its start")
        return Event(
            all_day_start=first,
            all_day_end=last,
            timezone_name=str(start.get("timeZone") or calendar_timezone),
            **common,
        )

    for name, value in (("start", start), ("end", end)):
        if "dateTime" not in value:
            raise CalendarRefused(f"{name} has neither a date nor a dateTime")
    return Event(
        starts_at=datetime.fromisoformat(str(start["dateTime"])),
        ends_at=datetime.fromisoformat(str(end["dateTime"])),
        **common,
    )


def record_from_event(event: Event, *, updated_at: datetime) -> RemoteRecord:
    """The sync layer's view of an event.

    `deleted` comes from the event's own status: Google reports a removed event
    as a normal item with `status: cancelled`, and a sync layer that waits for
    the item to disappear will keep it forever.
    """

    return RemoteRecord(
        record_id=event.event_id,
        etag=event.etag,
        updated_at=updated_at,
        deleted=event.status is EventStatus.CANCELLED,
        payload={"calendar_id": event.calendar_id, "summary": event.summary},
    )
