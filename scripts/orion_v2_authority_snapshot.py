#!/usr/bin/env python3
"""Export a sanitized, versioned snapshot of ORION's live authority map."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
LEVELS = ("AUTO", "NOTIFY", "APPROVAL", "NEVER")
AVAILABILITY_FIELDS = (
    "tier",
    "flag",
    "configOn",
    "profileOn",
    "available",
    "unresolved",
)


def require_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{field} must be a non-empty string")
    return value


def normalize_subcommands(value: Any, capability: str) -> list[dict[str, str]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{capability}.subs must be a list")
    normalized: list[dict[str, str]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise ValueError(f"{capability}.subs[{index}] must be an object")
        level = require_text(item.get("level"), f"{capability}.subs[{index}].level")
        if level not in LEVELS:
            raise ValueError(f"{capability}.subs[{index}] has unknown level {level!r}")
        normalized.append(
            {
                "name": require_text(item.get("name"), f"{capability}.subs[{index}].name"),
                "level": level,
            }
        )
    return sorted(normalized, key=lambda item: item["name"])


def normalize_capability(item: Any, index: int) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise ValueError(f"capabilities[{index}] must be an object")
    name = require_text(item.get("name"), f"capabilities[{index}].name")
    kind = require_text(item.get("kind"), f"{name}.kind")
    if kind not in ("action", "command"):
        raise ValueError(f"{name} has unknown kind {kind!r}")
    level = require_text(item.get("level"), f"{name}.level")
    if level not in LEVELS:
        raise ValueError(f"{name} has unknown level {level!r}")

    normalized: dict[str, Any] = {
        "kind": kind,
        "name": name,
        "level": level,
        "rule": require_text(item.get("rule"), f"{name}.rule"),
        "because": require_text(item.get("because"), f"{name}.because"),
        "enforcedBy": require_text(item.get("enforcedBy"), f"{name}.enforcedBy"),
    }
    if kind == "action":
        normalized.update(
            {
                "tier": require_text(item.get("tier"), f"{name}.tier"),
                "risk": require_text(item.get("risk"), f"{name}.risk"),
                "reversible": item.get("reversible"),
            }
        )
        if not isinstance(normalized["reversible"], bool):
            raise ValueError(f"{name}.reversible must be a boolean")
    else:
        if item.get("coarse") is True:
            normalized["coarse"] = True
        if item.get("escapeHatch") is True:
            normalized["escapeHatch"] = True
        subs = normalize_subcommands(item.get("subs"), name)
        if subs:
            normalized["subcommands"] = subs
    return normalized


def normalize_authority(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("authority report must be an object")
    capabilities = raw.get("capabilities")
    if not isinstance(capabilities, list):
        raise ValueError("capabilities must be a list")
    normalized_capabilities = [
        normalize_capability(item, index) for index, item in enumerate(capabilities)
    ]
    keys = [(item["kind"], item["name"]) for item in normalized_capabilities]
    if len(keys) != len(set(keys)):
        raise ValueError("authority report contains duplicate kind/name entries")
    normalized_capabilities.sort(
        key=lambda item: (LEVELS.index(item["level"]), item["kind"], item["name"])
    )

    availability = raw.get("availability")
    if not isinstance(availability, list):
        raise ValueError("availability must be a list")
    normalized_availability: list[dict[str, Any]] = []
    for index, item in enumerate(availability):
        if not isinstance(item, dict):
            raise ValueError(f"availability[{index}] must be an object")
        tier = require_text(item.get("tier"), f"availability[{index}].tier")
        row = {field: item[field] for field in AVAILABILITY_FIELDS if field in item}
        row["tier"] = tier
        normalized_availability.append(row)
    normalized_availability.sort(key=lambda item: item["tier"])

    exec_policy = raw.get("exec")
    if not isinstance(exec_policy, dict):
        raise ValueError("exec must be an object")
    normalized_exec = {
        field: exec_policy.get(field) for field in ("security", "ask", "askFallback")
    }
    counts = {level: 0 for level in LEVELS}
    for capability in normalized_capabilities:
        counts[capability["level"]] += 1

    return {
        "schemaVersion": SCHEMA_VERSION,
        "profile": require_text(raw.get("profile"), "profile"),
        "profileSource": require_text(raw.get("profileSource"), "profileSource"),
        "installedPluginParity": raw.get("drift") is False,
        "execPolicy": normalized_exec,
        "counts": {"total": len(normalized_capabilities), **counts},
        "availability": normalized_availability,
        "capabilities": normalized_capabilities,
    }


def render_snapshot(snapshot: dict[str, Any]) -> str:
    return json.dumps(snapshot, indent=2, ensure_ascii=False) + "\n"


def write_atomic(path: Path, payload: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False
    )
    temporary = Path(handle.name)
    try:
        with handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def main(argv: list[str] | None = None) -> int:
    repo = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--authority", type=Path, default=repo / "scripts/orion-authority")
    parser.add_argument(
        "--output", type=Path, default=repo / "planning/v2/CURRENT_AUTHORITY.json"
    )
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args(argv)

    try:
        completed = subprocess.run(
            [str(arguments.authority), "show", "--json"],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        print("authority snapshot: FAIL authority report unavailable")
        return 1
    if completed.returncode != 0:
        print(f"authority snapshot: FAIL authority exit {completed.returncode}")
        return 1
    try:
        snapshot = normalize_authority(json.loads(completed.stdout))
    except (json.JSONDecodeError, ValueError) as error:
        print(f"authority snapshot: FAIL {error}")
        return 1
    payload = render_snapshot(snapshot)

    if arguments.check:
        try:
            existing = arguments.output.read_text(encoding="utf-8")
        except OSError:
            print("authority snapshot: FAIL snapshot missing")
            return 1
        if existing != payload:
            print("authority snapshot: FAIL snapshot is stale")
            return 1
        print(f"authority snapshot: current ({snapshot['counts']['total']} capabilities)")
        return 0

    write_atomic(arguments.output, payload)
    print(f"authority snapshot: wrote {snapshot['counts']['total']} capabilities")
    return 0


if __name__ == "__main__":
    sys.exit(main())
