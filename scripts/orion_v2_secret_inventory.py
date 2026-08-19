#!/usr/bin/env python3
"""Inventory local secret locations without emitting values or fingerprints."""

from __future__ import annotations

import argparse
import json
import os
import re
import stat
import sys
import tempfile
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
SENSITIVE_NAME = re.compile(r"(?:KEY|TOKEN|SECRET|PASSWORD|WEBHOOK)", re.IGNORECASE)
OPENCLAW_SECRET_PATHS = (
    "gateway.auth.token",
    "models.providers.anthropic.apiKey",
    "models.providers.ollama.apiKey",
)


def read_dotenv(path: Path) -> dict[str, str]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return {}
    fields: dict[str, str] = {}
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("export "):
            stripped = stripped[7:].lstrip()
        name, separator, value = stripped.partition("=")
        name = name.strip()
        if separator and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
            fields[name] = value.strip()
    return fields


def read_json(path: Path) -> dict[str, Any]:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    if not isinstance(parsed, dict):
        raise ValueError(f"{path.name} must contain a JSON object")
    return parsed


def nested_value(document: dict[str, Any], dotted_path: str) -> Any:
    value: Any = document
    for component in dotted_path.split("."):
        if not isinstance(value, dict) or component not in value:
            return None
        value = value[component]
    return value


def storage_kind(value: Any) -> str:
    if value is None or value == "":
        return "missing"
    if isinstance(value, str):
        return "plaintext"
    if isinstance(value, dict):
        return "secret_ref"
    return "non_string"


def file_mode(path: Path) -> str | None:
    try:
        return f"{stat.S_IMODE(path.stat().st_mode):04o}"
    except FileNotFoundError:
        return None


def relationship(left: Any, right: Any) -> str:
    if not isinstance(left, str) or not left or not isinstance(right, str) or not right:
        return "not_comparable"
    return "same" if left == right else "different"


def build_inventory(repo: Path, home: Path) -> dict[str, Any]:
    env_path = repo / ".env"
    saved_path = repo / ".env.save"
    openclaw_path = home / ".openclaw/openclaw.json"
    env = read_dotenv(env_path)
    saved = read_dotenv(saved_path)
    openclaw = read_json(openclaw_path)

    files = [
        {
            "location": "repo:.env",
            "exists": env_path.exists(),
            "mode": file_mode(env_path),
            "fields": sorted(env),
            "sensitiveFields": sorted(name for name in env if SENSITIVE_NAME.search(name)),
        },
        {
            "location": "repo:.env.save",
            "exists": saved_path.exists(),
            "mode": file_mode(saved_path),
            "fields": sorted(saved),
            "sensitiveFields": sorted(name for name in saved if SENSITIVE_NAME.search(name)),
        },
        {
            "location": "home:.openclaw/openclaw.json",
            "exists": openclaw_path.exists(),
            "mode": file_mode(openclaw_path),
            "secretFields": [
                {"field": path, "storage": storage_kind(nested_value(openclaw, path))}
                for path in OPENCLAW_SECRET_PATHS
            ],
        },
    ]
    env_anthropic = env.get("ANTHROPIC_API_KEY")
    saved_anthropic = saved.get("ANTHROPIC_API_KEY")
    openclaw_anthropic = nested_value(openclaw, "models.providers.anthropic.apiKey")
    relationships = [
        {
            "left": "repo:.env:ANTHROPIC_API_KEY",
            "right": "repo:.env.save:ANTHROPIC_API_KEY",
            "relationship": relationship(env_anthropic, saved_anthropic),
        },
        {
            "left": "repo:.env:ANTHROPIC_API_KEY",
            "right": "home:.openclaw/openclaw.json:models.providers.anthropic.apiKey",
            "relationship": relationship(env_anthropic, openclaw_anthropic),
        },
    ]
    return {
        "schemaVersion": SCHEMA_VERSION,
        "redaction": "values and fingerprints omitted",
        "files": files,
        "relationships": relationships,
        "rotation": {
            "anthropicPreviouslyExposed": "unresolved",
            "requiredEvidence": "Nick confirms rotation after the historical terminal exposure",
        },
    }


def render_inventory(inventory: dict[str, Any]) -> str:
    return json.dumps(inventory, indent=2, ensure_ascii=False) + "\n"


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
    parser.add_argument("--repo", type=Path, default=repo)
    parser.add_argument("--home", type=Path, default=Path.home())
    parser.add_argument(
        "--output", type=Path, default=repo / "planning/v2/CURRENT_SECRET_INVENTORY.json"
    )
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args(argv)

    try:
        payload = render_inventory(build_inventory(arguments.repo, arguments.home))
        if arguments.check:
            if arguments.output.read_text(encoding="utf-8") != payload:
                print("secret inventory: FAIL snapshot is stale")
                return 1
            print("secret inventory: current (values omitted)")
            return 0
        write_atomic(arguments.output, payload)
    except (OSError, ValueError) as error:
        print(f"secret inventory: FAIL {error}")
        return 1
    print("secret inventory: wrote redacted metadata")
    return 0


if __name__ == "__main__":
    sys.exit(main())
