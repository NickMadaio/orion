"""A calendar event as ORION reads it, and what makes one block a person's time.

The field that decides everything downstream is not the time -- it is whether
the event means the person is unavailable. Three things can each make an event
not block: the organiser marked it free, the person declined it, or it was
cancelled. Miss any of them and ORION refuses to schedule anything on a day full
of birthdays.

The default, though, goes the other way. An event whose transparency ORION does
not understand counts as **busy**. Getting it wrong in that direction costs a
suggestion; getting it wrong in the other double-books the person, and they find
out by missing something.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from enum import Enum
from zoneinfo import ZoneInfo


class Transparency(str, Enum):
    """Whether the organiser says this time is taken."""

    OPAQUE = "opaque"
    TRANSPARENT = "transparent"
    #: Not a provider value. What ORION records when the field was absent or a
    #: word it does not know -- kept distinct from OPAQUE so the reason a slot
    #: is blocked stays visible.
    UNKNOWN = "unknown"


class Response(str, Enum):
    """The person's own answer, which outranks the organiser's transparency."""

    ACCEPTED = "accepted"
    TENTATIVE = "tentative"
    DECLINED = "declined"
    NEEDS_ACTION = "needs_action"


class EventStatus(str, Enum):
    CONFIRMED = "confirmed"
    TENTATIVE = "tentative"
    CANCELLED = "cancelled"


class CalendarRefused(ValueError):
    """The event could not be read, and the reason names the rule."""


@dataclass(frozen=True, slots=True)
class Event:
    """One event on one calendar.

    All-day events carry dates, not instants. Converting one to a span requires
    the calendar's timezone, and this refuses rather than assuming UTC: "all day
    on the 26th" is a different eight hours of a person's life in Los Angeles
    than in Berlin, and silently picking one is how an availability answer
    becomes wrong by a working day.
    """

    event_id: str
    calendar_id: str
    summary: str
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    all_day_start: date | None = None
    all_day_end: date | None = None
    timezone_name: str | None = None
    transparency: Transparency = Transparency.UNKNOWN
    response: Response = Response.NEEDS_ACTION
    status: EventStatus = EventStatus.CONFIRMED
    etag: str = ""

    def __post_init__(self) -> None:
        set_ = object.__setattr__
        for field in ("event_id", "calendar_id"):
            value = getattr(self, field)
            if not isinstance(value, str) or not value.strip():
                raise CalendarRefused(f"{field} is required")
        set_(self, "transparency", Transparency(self.transparency))
        set_(self, "response", Response(self.response))
        set_(self, "status", EventStatus(self.status))

        timed = self.starts_at is not None or self.ends_at is not None
        all_day = self.all_day_start is not None or self.all_day_end is not None
        if timed and all_day:
            raise CalendarRefused("an event is timed or all-day, never both")
        if not timed and not all_day:
            raise CalendarRefused("an event needs a time or a date")
        if timed:
            for field in ("starts_at", "ends_at"):
                value = getattr(self, field)
                if not isinstance(value, datetime) or value.tzinfo is None:
                    raise CalendarRefused(f"{field} must be an aware datetime")
                set_(self, field, value.astimezone(timezone.utc))
            if self.ends_at < self.starts_at:
                raise CalendarRefused("an event cannot end before it starts")
        else:
            for field in ("all_day_start", "all_day_end"):
                value = getattr(self, field)
                if not isinstance(value, date) or isinstance(value, datetime):
                    raise CalendarRefused(f"{field} must be a date")
            if self.all_day_end < self.all_day_start:
                raise CalendarRefused("an all-day event cannot end before it starts")
            if not self.timezone_name:
                raise CalendarRefused(
                    "an all-day event needs its calendar's timezone; "
                    "'all day' is a different span in every zone"
                )

    @property
    def is_all_day(self) -> bool:
        return self.all_day_start is not None

    def blocks_time(self) -> bool:
        """Whether this event means the person is unavailable.

        Order matters. The person's own DECLINED beats whatever the organiser
        set, and a CANCELLED event blocks nothing whatever anybody set.
        """

        if self.status is EventStatus.CANCELLED:
            return False
        if self.response is Response.DECLINED:
            return False
        if self.transparency is Transparency.TRANSPARENT:
            return False
        # OPAQUE and UNKNOWN both block. Unknown blocking is the fail-safe
        # direction: a wrongly-blocked hour costs a suggestion, a wrongly-free
        # hour costs the person the thing they missed.
        return True

    def span(self) -> tuple[datetime, datetime]:
        """The event as an instant range in UTC.

        All-day events are expanded through their calendar's zone, and the end
        date is treated as inclusive -- Google sends an exclusive end date, and
        the caller that reads Google converts it. This function is told what the
        event covers, not what a particular API's encoding was.
        """

        if not self.is_all_day:
            return self.starts_at, self.ends_at
        zone = ZoneInfo(self.timezone_name)
        start = datetime.combine(self.all_day_start, time.min, tzinfo=zone)
        end = datetime.combine(self.all_day_end + timedelta(days=1), time.min, tzinfo=zone)
        return start.astimezone(timezone.utc), end.astimezone(timezone.utc)
