"""Prove the module graph is real: acyclic, complete, and obeyed by the code.

A declared dependency graph nobody checks is a diagram. Two checks here, and the
second is the one that keeps mattering after the first implementation lands:

1. the declarations are consistent -- every dependency names a real module, no
   cycles, one deployable;
2. any file under `backend/modules/` imports only what its module declared.

The second walks the real import statements, so it starts trivially true and
becomes load-bearing the moment code appears.
"""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Iterable, Mapping

from backend.modules import MODULES, ModuleSpec


#: Packages the backend must never import. A cloud service reaching into the Mac
#: runtime is not a layering opinion -- those modules touch a Keychain and a
#: desktop that do not exist on a server.
FORBIDDEN_ROOTS = frozenset(
    {
        "AppKit", "Foundation", "EventKit", "HealthKit", "SwiftUI",
        "openclaw",
    }
)
#: The network belongs to `backend/egress.py`. Any other module importing an
#: HTTP client would be a fetch that never passed the SSRF guard -- which is the
#: only way that invariant can be reopened without anybody editing the guard.
NETWORK_ROOTS = frozenset({"urllib", "http", "requests", "httpx", "aiohttp", "socket", "ftplib"})
EGRESS_MODULE = "egress.py"

FORBIDDEN_QUALIFIED = frozenset(
    {
        "orion.mac",
        "orion.mac_bridge",
        "orion.server",
        "orion.tools",
        "orion.executor",
        "orion.runtime",
    }
)


def declaration_errors(modules: Mapping[str, ModuleSpec] | None = None) -> list[str]:
    registry = MODULES if modules is None else modules
    errors: list[str] = []
    for name, spec in registry.items():
        for dependency in spec.depends_on:
            if dependency not in registry:
                errors.append(f"{name} depends on {dependency}, which is not a module")
    errors.extend(f"dependency cycle: {' -> '.join(cycle)}" for cycle in cycles(registry))
    return errors


def cycles(modules: Mapping[str, ModuleSpec] | None = None) -> list[tuple[str, ...]]:
    """Every dependency cycle, as a path.

    A cycle is not a style problem: two modules that depend on each other are one
    module with a line drawn through it, and no boundary check on either means
    anything afterwards.
    """

    registry = MODULES if modules is None else modules
    found: list[tuple[str, ...]] = []
    visiting: list[str] = []
    done: set[str] = set()

    def walk(name: str) -> None:
        if name in visiting:
            start = visiting.index(name)
            found.append(tuple(visiting[start:] + [name]))
            return
        if name in done:
            return
        visiting.append(name)
        spec = registry.get(name)
        for dependency in spec.depends_on if spec is not None else ():
            if dependency in registry:
                walk(dependency)
        visiting.pop()
        done.add(name)

    for name in sorted(registry):
        walk(name)
    return found


def transitive_dependencies(name: str, modules: Mapping[str, ModuleSpec] | None = None) -> frozenset[str]:
    registry = MODULES if modules is None else modules
    seen: set[str] = set()
    frontier = list(registry[name].depends_on)
    while frontier:
        current = frontier.pop()
        if current in seen or current not in registry:
            continue
        seen.add(current)
        frontier.extend(registry[current].depends_on)
    return frozenset(seen)


def imported_names(path: Path) -> list[tuple[int, str]]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.extend((node.lineno, alias.name) for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.append((node.lineno, node.module))
    return names


def import_errors(root: Path) -> list[str]:
    """Check every backend file against the declarations and the forbidden list."""

    errors: list[str] = []
    for path in sorted(root.rglob("*.py")):
        relative = path.relative_to(root.parent)
        owning = _owning_module(path, root)
        for line, name in imported_names(path):
            head = name.split(".", 1)[0]
            if head in NETWORK_ROOTS and path.name != EGRESS_MODULE:
                errors.append(
                    f"{relative}:{line}: only egress.py may reach the network; "
                    f"route the request through egress.check first"
                )
                continue
            if head in FORBIDDEN_ROOTS or any(
                name == forbidden or name.startswith(f"{forbidden}.")
                for forbidden in FORBIDDEN_QUALIFIED
            ):
                errors.append(f"{relative}:{line}: backend must not import {name}")
                continue
            if owning is None or head != "backend":
                continue
            target = _target_module(name)
            if target is None or target == owning:
                continue
            allowed = MODULES[owning].depends_on
            if target not in allowed:
                errors.append(
                    f"{relative}:{line}: {owning} imports {target}, which it does not declare"
                )
    return errors


def _owning_module(path: Path, root: Path) -> str | None:
    """The module a backend file belongs to, from `backend/<name>/...`.

    NOT `backend/modules/<name>/`: a `modules` package would shadow
    `backend/modules.py`, which is where the declarations live, and every import
    of MODULES would break the moment the first module gained a directory. The
    layout a boundary check requires must be one the code can actually use.
    """

    parts = path.relative_to(root).parts
    if len(parts) >= 2 and parts[0] in MODULES:
        return parts[0]
    return None


def _target_module(name: str) -> str | None:
    parts = name.split(".")
    if len(parts) >= 2 and parts[0] == "backend" and parts[1] in MODULES:
        return parts[1]
    return None


def all_errors(root: Path | None = None) -> list[str]:
    base = root if root is not None else Path(__file__).resolve().parent
    return declaration_errors() + import_errors(base)
