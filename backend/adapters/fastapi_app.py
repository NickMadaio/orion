"""Bind the declared route table to FastAPI, if FastAPI is installed.

The manifest recommends FastAPI, and this repository's Python has had **zero**
third-party dependencies since it began -- `pyproject.toml` says
`dependencies = []` and means it. Adding one is a reviewed decision with a host
attached, not a side effect of a phase closing at midnight.

So the import happens inside the function. The route table, its rules and its
tests need nothing installed; this is the twenty lines that will bind them when
somebody decides to deploy.
"""

from __future__ import annotations

from typing import Any

from backend.routes import ROUTES, route_errors


class FastAPIUnavailable(RuntimeError):
    """FastAPI is not installed. Deliberately not a silent fallback."""


def build_app(handlers: dict[tuple[str, str], Any]) -> Any:
    """Create the ASGI app, wiring each declared route to its handler.

    Every route must have a handler and every handler a route: a table that
    disagrees with its implementation is how an endpoint ends up live with no
    ownership check, or declared and never served.
    """

    errors = route_errors()
    if errors:
        raise ValueError(f"the route table is invalid: {errors}")

    # Checked BEFORE the import: a handler table that disagrees with the route
    # table is a declaration error, and finding it without needing FastAPI
    # installed is the whole reason the table is data.
    declared = {(route.method, route.path) for route in ROUTES}
    missing = sorted(declared - set(handlers))
    extra = sorted(set(handlers) - declared)
    if missing or extra:
        raise ValueError(f"handlers do not match the route table: missing={missing} extra={extra}")

    try:
        from fastapi import FastAPI  # noqa: PLC0415 -- deliberately lazy
    except ImportError as error:  # pragma: no cover -- depends on the host
        raise FastAPIUnavailable(
            "FastAPI is not installed; the backend is declared but not deployable"
        ) from error

    app = FastAPI(title="ORION backend")
    for route in ROUTES:
        app.add_api_route(
            route.path,
            handlers[(route.method, route.path)],
            methods=[route.method],
            name=f"{route.module}.{route.operation}",
        )
    return app
