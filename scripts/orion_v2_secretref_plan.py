#!/usr/bin/env python3
"""Generate the value-free OpenClaw Keychain SecretRef migration plan."""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any


PROTOCOL_VERSION = 1
ACCOUNT = "openclaw"
PROVIDERS = {
    "orion_gateway_keychain": "ORION OpenClaw Gateway",
    "orion_anthropic_keychain": "ORION OpenClaw Anthropic",
    "orion_ollama_keychain": "ORION OpenClaw Ollama",
}


def provider(service: str) -> dict[str, Any]:
    return {
        "source": "exec",
        "command": "/usr/bin/security",
        "args": [
            "find-generic-password",
            "-w",
            "-s",
            service,
            "-a",
            ACCOUNT,
        ],
        "jsonOnly": False,
        "allowInsecurePath": True,
        "timeoutMs": 5000,
        "maxOutputBytes": 16384,
    }


def reference(name: str) -> dict[str, str]:
    return {"source": "exec", "provider": name, "id": "value"}


def build_plan() -> dict[str, Any]:
    return {
        "version": PROTOCOL_VERSION,
        "protocolVersion": PROTOCOL_VERSION,
        "providerUpserts": {
            name: provider(service) for name, service in sorted(PROVIDERS.items())
        },
        "targets": [
            {
                "type": "gateway.auth.token",
                "path": "gateway.auth.token",
                "pathSegments": ["gateway", "auth", "token"],
                "ref": reference("orion_gateway_keychain"),
            },
            {
                "type": "models.providers.apiKey",
                "path": "models.providers.anthropic.apiKey",
                "pathSegments": ["models", "providers", "anthropic", "apiKey"],
                "providerId": "anthropic",
                "ref": reference("orion_anthropic_keychain"),
            },
            {
                "type": "auth-profiles.token.token",
                "path": "profiles.ollama:local.token",
                "pathSegments": ["profiles", "ollama:local", "token"],
                "agentId": "main",
                "ref": reference("orion_ollama_keychain"),
            },
        ],
        "options": {
            "scrubEnv": True,
            "scrubAuthProfilesForProviderTargets": True,
            "scrubLegacyAuthJson": True,
        },
    }


def render_plan(plan: dict[str, Any]) -> str:
    return json.dumps(plan, indent=2, ensure_ascii=False) + "\n"


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
    parser.add_argument(
        "--output",
        type=Path,
        default=repo / "planning/v2/OPENCLAW_SECRETREF_PLAN.json",
    )
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args(argv)
    payload = render_plan(build_plan())
    if arguments.check:
        try:
            existing = arguments.output.read_text(encoding="utf-8")
        except OSError:
            print("secretref plan: FAIL plan missing")
            return 1
        if existing != payload:
            print("secretref plan: FAIL plan is stale")
            return 1
        print("secretref plan: current (3 Keychain targets, values omitted)")
        return 0
    try:
        write_atomic(arguments.output, payload)
    except OSError as error:
        print(f"secretref plan: FAIL {error}")
        return 1
    print("secretref plan: wrote 3 Keychain targets (values omitted)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
