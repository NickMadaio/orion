#!/usr/bin/env python3
"""Run one non-mutating ORION tool through the installed normal agent route.

The smoke prints only a sanitized pass/fail summary. Raw model output, tool
output, configuration, and ledger evidence are parsed in memory and never
copied into the terminal or a new log file.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any


ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def parse_agent_payload(raw: str) -> dict[str, Any]:
    clean = ANSI.sub("", raw).strip()
    for candidate in [clean, *reversed(clean.splitlines())]:
        candidate = candidate.strip()
        if not candidate.startswith("{"):
            continue
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    raise ValueError("agent response was not a JSON object")


def extract_reply(payload: dict[str, Any]) -> str:
    scopes: list[dict[str, Any]] = []
    for key in ("result",):
        nested = payload.get(key)
        if isinstance(nested, dict):
            scopes.append(nested)
    scopes.append(payload)
    nested = payload.get("data")
    if isinstance(nested, dict):
        scopes.append(nested)

    for scope in scopes:
        for key in ("payloads", "messages", "outputs"):
            items = scope.get(key)
            if not isinstance(items, list):
                continue
            parts: list[str] = []
            for item in items:
                if isinstance(item, dict) and isinstance(item.get("text"), str):
                    text = item["text"].strip()
                    if text:
                        parts.append(text)
                elif isinstance(item, str) and item.strip():
                    parts.append(item.strip())
            if parts:
                return "\n\n".join(parts).strip()

        for key in ("text", "reply", "message", "content", "output"):
            value = scope.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
            if isinstance(value, dict) and isinstance(value.get("text"), str):
                text = value["text"].strip()
                if text:
                    return text
    return ""


def ledger_size(path: Path) -> int:
    try:
        return path.stat().st_size
    except FileNotFoundError:
        return 0


def new_ledger_records(path: Path, offset: int) -> list[dict[str, Any]]:
    try:
        with path.open("rb") as handle:
            handle.seek(offset)
            payload = handle.read().decode("utf-8", errors="replace")
    except FileNotFoundError:
        return []

    records: list[dict[str, Any]] = []
    for line in payload.splitlines():
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(record, dict):
            records.append(record)
    return records


def validate_record(record: dict[str, Any], goal: str) -> list[str]:
    errors: list[str] = []
    if record.get("goal") != goal:
        errors.append("goal mismatch")
    if record.get("status") != "succeeded":
        errors.append("task did not succeed")

    validation = record.get("validation")
    if not isinstance(validation, dict) or validation.get("status") != "ready":
        errors.append("policy validation was not ready")
    elif validation.get("valid") is not True:
        errors.append("policy validation was not valid")

    authorization = record.get("authorization")
    if not isinstance(authorization, dict):
        errors.append("authorization provenance missing")
    else:
        if authorization.get("binding") in (None, "none"):
            errors.append("authorization was not bound to a user turn")
        if not isinstance(authorization.get("turnCount"), int) or authorization["turnCount"] < 1:
            errors.append("authorization contained no authenticated turn")

    steps = record.get("steps")
    if not isinstance(steps, list) or len(steps) != 1:
        errors.append("expected exactly one executed step")
        return errors
    step = steps[0]
    if not isinstance(step, dict):
        errors.append("step record was malformed")
        return errors
    request = step.get("request")
    if not isinstance(request, dict) or request.get("action") != "system_status":
        errors.append("unexpected action executed")
    if step.get("status") != "verified":
        errors.append("step was not verified")
    verification = step.get("verification")
    if not isinstance(verification, dict) or verification.get("observed") is not True:
        errors.append("independent verification did not observe the result")
    return errors


def main(argv: list[str] | None = None) -> int:
    home = Path.home()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, default=home / ".openclaw/bin/openclaw")
    parser.add_argument(
        "--ledger",
        type=Path,
        default=home / ".openclaw/orion-controlled/task-ledger.jsonl",
    )
    parser.add_argument("--timeout", type=int, default=90)
    arguments = parser.parse_args(argv)

    if not arguments.binary.is_file():
        print("live smoke: FAIL openclaw binary missing")
        return 1

    nonce = uuid.uuid4().hex[:12]
    marker = f"ORION_V2_SMOKE_OK_{nonce}"
    goal = f"ORION v2 non-mutating live smoke {nonce}"
    session = f"orion-v2-phase0-smoke-{nonce}"
    prompt = (
        "This is a non-mutating internal validation requested by Nick. "
        "You are authorized to read system status only. Do not use exec and do not run "
        "any other ORION action. If needed, use tool_search/tool_describe/tool_call only "
        "to reach orion_task_run. Call orion_task_run exactly once with this payload: "
        f'{{"graph":{{"goal":"{goal}","steps":[{{"id":"status","action":'
        '"system_status","arguments":{}}]}}}. '
        f"After it succeeds, reply with exactly {marker}"
    )

    before = ledger_size(arguments.ledger)
    started = time.monotonic()
    try:
        completed = subprocess.run(
            [
                str(arguments.binary),
                "agent",
                "--session-key",
                session,
                "--message",
                prompt,
                "--json",
                "--timeout",
                str(arguments.timeout),
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=arguments.timeout + 20,
        )
    except subprocess.TimeoutExpired:
        print("live smoke: FAIL agent timed out")
        return 1

    if completed.returncode != 0:
        print(f"live smoke: FAIL agent exit {completed.returncode}")
        return 1
    try:
        payload = parse_agent_payload(completed.stdout)
    except ValueError:
        print("live smoke: FAIL unreadable agent response")
        return 1
    if extract_reply(payload) != marker:
        print("live smoke: FAIL agent did not return the expected marker")
        return 1

    records = [record for record in new_ledger_records(arguments.ledger, before) if record.get("goal") == goal]
    if len(records) != 1:
        print(f"live smoke: FAIL expected one matching ledger row, found {len(records)}")
        return 1
    errors = validate_record(records[0], goal)
    if errors:
        print(f"live smoke: FAIL {'; '.join(errors)}")
        return 1

    elapsed_ms = int((time.monotonic() - started) * 1000)
    authorization = records[0]["authorization"]
    print(
        "live smoke: ok "
        f"elapsed_ms={elapsed_ms} binding={authorization['binding']} "
        f"task={records[0].get('taskId', 'recorded')}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
