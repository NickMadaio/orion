#!/usr/bin/env python3
"""Verify replacement and saved Anthropic keys without printing values."""

from __future__ import annotations

import argparse
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable


API_URL = "https://api.anthropic.com/v1/models?limit=1"
API_VERSION = "2023-06-01"
ACCOUNT = "openclaw"
LOGIN_KEYCHAIN = Path.home() / "Library" / "Keychains" / "login.keychain-db"


def read_env_key(path: Path) -> str:
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        if name.strip() != "ANTHROPIC_API_KEY":
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if value:
            return value
    raise ValueError(f"ANTHROPIC_API_KEY is missing from {path.name}")


def read_keychain(service: str) -> str:
    completed = subprocess.run(
        [
            "/usr/bin/security",
            "find-generic-password",
            "-w",
            "-a",
            ACCOUNT,
            "-s",
            service,
            str(LOGIN_KEYCHAIN),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=45,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"Keychain read failed (exit {completed.returncode})")
    value = completed.stdout.rstrip("\r\n")
    if not value:
        raise ValueError("Keychain Anthropic value is empty")
    return value


def classify_status(status: int) -> str:
    if 200 <= status < 300:
        return "valid"
    if status == 401:
        return "invalid"
    if status in {403, 429}:
        return "accepted_limited"
    return "unverified"


def check_key(
    key: str,
    opener: Callable[..., object] = urllib.request.urlopen,
) -> str:
    request = urllib.request.Request(
        API_URL,
        headers={
            "x-api-key": key,
            "anthropic-version": API_VERSION,
            "user-agent": "orion-v2-phase0-key-status/1",
        },
        method="GET",
    )
    try:
        response = opener(request, timeout=15)
        status = int(getattr(response, "status"))
        close = getattr(response, "close", None)
        if callable(close):
            close()
        return classify_status(status)
    except urllib.error.HTTPError as error:
        return classify_status(error.code)
    except (OSError, urllib.error.URLError, TimeoutError):
        return "unverified"


def main(argv: list[str] | None = None) -> int:
    repo = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--saved", type=Path, default=repo / ".env.save")
    parser.add_argument("--service", default="ORION OpenClaw Anthropic")
    parser.add_argument("--live-check", action="store_true")
    arguments = parser.parse_args(argv)
    if not arguments.live_check:
        print("anthropic key status: FAIL --live-check is required")
        return 2
    try:
        replacement = read_keychain(arguments.service)
        saved = read_env_key(arguments.saved)
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
        print(f"anthropic key status: FAIL {error}")
        return 1
    replacement_status = check_key(replacement)
    saved_status = check_key(saved)
    relation = "yes" if replacement == saved else "no"
    print(
        "anthropic key status: "
        f"replacement={replacement_status} saved={saved_status} "
        f"same_value={relation} values=omitted"
    )
    if replacement_status not in {"valid", "accepted_limited"}:
        return 1
    if saved_status == "invalid":
        return 0
    if saved_status in {"valid", "accepted_limited"}:
        return 3
    return 1


if __name__ == "__main__":
    sys.exit(main())
