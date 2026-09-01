"""The HTTP surface, declared as data so it can be checked before it exists.

A route table is the place ownership rules are usually lost -- one handler takes
a user id from the path, and every guarantee below it becomes advisory. So the
table is validated: **no path may contain a user identifier**, because ownership
comes from the session and a path segment is a client claim wearing a URL.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from backend.modules import MODULES


METHODS = ("GET", "POST", "PATCH", "DELETE")
MUTATING = ("POST", "PATCH", "DELETE")

#: Path parameters that would name an owner. `{user_id}` in a path means some
#: handler is about to trust it.
FORBIDDEN_PATH_PARAMETERS = ("{user_id}", "{owner_id}", "{account_id}", "{user}")

#: Operation-name prefixes that change something. Checked against the verb,
#: because "GET /jobs -> submit_job" passes any rule that only looks at methods
#: -- and a read route wired to a write operation is a write nobody audits.
MUTATING_OPERATION_PREFIXES = (
    "submit", "create", "send", "cancel", "delete", "revoke", "acknowledge",
    "complete", "run", "plan", "write", "grant", "connect", "disconnect",
    "sign", "open", "close", "record", "sync", "remove", "forget", "append",
    "replan", "deliver", "raise", "register", "dispatch", "sweep",
)

#: The one route that names no module: a liveness probe is infrastructure, not a
#: domain operation, and pointing it at `audit.read_trail` made an unauthenticated
#: audit-trail read look like a health check.
LIVENESS_PATH = "/health"


@dataclass(frozen=True, slots=True)
class Route:
    method: str
    path: str
    module: str
    operation: str
    requires_session: bool = True
    owner_scoped: bool = True
    audited: bool = True

    def __post_init__(self) -> None:
        if self.method not in METHODS:
            raise ValueError(f"{self.method} is not a permitted method")
        if not self.path.startswith("/"):
            raise ValueError("a path starts with /")

    @property
    def mutates(self) -> bool:
        """Whether this route changes state, by verb OR by operation name."""

        return self.method in MUTATING or self.operation.startswith(MUTATING_OPERATION_PREFIXES)


ROUTES: tuple[Route, ...] = (
    Route("GET", "/health", "", "liveness", requires_session=False, owner_scoped=False, audited=False),
    Route("POST", "/auth/session", "auth", "sign_in", requires_session=False, owner_scoped=False),
    Route("DELETE", "/auth/session", "auth", "sign_out"),
    Route("GET", "/me", "users", "read_user"),
    Route("GET", "/devices", "devices", "list_devices"),
    Route("POST", "/devices", "devices", "register_device"),
    Route("DELETE", "/devices/{device_id}", "devices", "revoke_device"),
    Route("GET", "/conversations", "conversations", "list_threads"),
    Route("POST", "/conversations/{conversation_id}/turns", "conversations", "append_turn"),
    Route("GET", "/tasks", "tasks", "list_tasks"),
    Route("POST", "/tasks", "tasks", "create_task"),
    Route("POST", "/tasks/{task_id}/complete", "tasks", "complete_task"),
    Route("GET", "/plan", "planning", "read_plan"),
    Route("POST", "/plan", "planning", "plan_day"),
    Route("GET", "/memory", "memory", "recall"),
    Route("POST", "/memory", "memory", "write_item"),
    Route("GET", "/jobs", "jobs", "list_jobs", audited=False),
    Route("POST", "/jobs", "jobs", "submit_job"),
    Route("POST", "/jobs/{job_id}/cancel", "jobs", "cancel_job"),
    Route("POST", "/approvals/{approval_id}", "policies", "request_approval"),
    Route("GET", "/notifications", "notifications", "list_notifications", audited=False),
    Route("GET", "/audit", "audit", "read_trail"),
)


def route_errors(routes: Iterable[Route] | None = None) -> list[str]:
    table = ROUTES if routes is None else tuple(routes)
    errors: list[str] = []
    seen: set[tuple[str, str]] = set()
    for route in table:
        key = (route.method, route.path)
        if key in seen:
            errors.append(f"{route.method} {route.path} is declared twice")
        seen.add(key)
        if not route.module:
            if (
                route.path != LIVENESS_PATH
                or route.method != "GET"
                or route.operation != "liveness"
                or route.requires_session
                or route.owner_scoped
                or route.audited
            ):
                errors.append(
                    f"{route.method} {route.path} names no module; only an unauthenticated, "
                    f"unaudited GET {LIVENESS_PATH} liveness probe may do that"
                )
            continue
        module = MODULES.get(route.module)
        if module is None:
            errors.append(f"{route.method} {route.path} names unknown module {route.module}")
            continue
        if route.operation not in module.operations:
            errors.append(
                f"{route.method} {route.path} calls {route.module}.{route.operation}, "
                f"which the module does not offer"
            )
        for parameter in FORBIDDEN_PATH_PARAMETERS:
            if parameter in route.path:
                errors.append(
                    f"{route.method} {route.path} takes an owner from the path; "
                    "ownership comes from the session"
                )
        if not route.requires_session and route.path != "/auth/session":
            # Anything else unauthenticated is an open endpoint on a module that
            # owns user data. `GET /health -> audit.read_trail` read exactly like
            # a health check and was an anonymous audit-trail read.
            errors.append(
                f"{route.method} {route.path} is unauthenticated; only signing in and "
                f"the {LIVENESS_PATH} probe may be"
            )
        if not route.owner_scoped and route.path != "/auth/session":
            # Signing in is the one call that cannot be owner-scoped: it is what
            # produces the owner.
            errors.append(
                f"{route.method} {route.path} names a module but is not owner-scoped"
            )
        if route.mutates:
            if route.method not in MUTATING:
                errors.append(
                    f"{route.method} {route.path} calls {route.operation}, which changes state; "
                    f"a read route may not name a mutating operation"
                )
            if not route.requires_session:
                if route.path != "/auth/session":
                    errors.append(f"{route.method} {route.path} changes state without a session")
            elif not route.owner_scoped:
                errors.append(f"{route.method} {route.path} changes state without an owner")
            if not route.audited:
                errors.append(f"{route.method} {route.path} changes state without an audit record")
    return errors
