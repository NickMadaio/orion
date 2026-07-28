from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo


TIME_TOOL = {
    "type": "function",
    "function": {
        "name": "get_current_time",
        "description": "Return the current local time for an IANA time zone.",
        "parameters": {
            "type": "object",
            "properties": {"timezone": {"type": "string", "description": "For example, America/New_York."}},
            "required": ["timezone"],
        },
    },
}


def get_current_time(timezone: str) -> dict[str, str]:
    """Level 0 read-only tool: return current time without external access."""
    try:
        now = datetime.now(ZoneInfo(timezone))
    except Exception as error:
        return {"error": f"Unknown timezone: {timezone}", "detail": str(error)}
    return {
        "timezone": timezone,
        "local_time": now.isoformat(timespec="seconds"),
        "friendly_time": now.strftime("%A, %B %d, %Y at %I:%M %p %Z"),
    }


TOOLS = {"get_current_time": get_current_time}
