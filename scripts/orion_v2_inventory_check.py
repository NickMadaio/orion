#!/usr/bin/env python3
"""PHASE 71 — hold the data inventory to the system it describes.

"Update the inventory with every feature" is the manifest's own line, and it is
the one every data inventory fails at. A document you have to remember to
update is one that was true in October.

So the inventory is checked against the LIVE system, three ways:

  1. Every capability tier in the installed ACTION_CATALOG appears in exactly
     one entry's `tiers`. Add a tier and this fails until somebody writes down
     what data it touches — which is the point, because a new tier is exactly
     when the question "what does this reach" is cheap to answer and easy to
     skip.
  2. Every entry carries all ten fields the manifest names, non-empty. A field
     left blank is the field that mattered.
  3. Every configured store path in openclaw.json is named by some entry's
     `storage`. Redirecting the ledger somewhere new without saying so is a
     change to where the audit trail lives, and that should not be quiet.

Read-only. It runs against the installed plugin and the live config, so it is
answering about the machine rather than about the repository.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
INVENTORY = REPO / "planning/v2/DATA_INVENTORY.json"
DIST = Path.home() / ".openclaw/extensions/orion-control/dist"
CONFIG = Path.home() / ".openclaw/openclaw.json"

REQUIRED_FIELDS = (
    "data",
    "source",
    "purpose",
    "storage",
    "encryption",
    "retention",
    "modelExposure",
    "thirdPartyExposure",
    "deletion",
    "sensitivity",
)

#: Config keys that name a place data lives. Checked against `storage` text.
#: Not every key -- `browserPreference` names no store -- so this is a list, and
#: it is short enough to read.
PATH_KEYS = (
    "ledgerPath",
    "permissionStatePath",
    "permissionAuditPath",
    "healthLogPath",
    "remindersPath",
    "workshopPath",
    "testWorkspaceRoot",
    "scratchWorkspaceRoot",
    "approvalRoot",
    "strictnessStatePath",
)


def live_tiers() -> set[str]:
    """Tiers from the INSTALLED catalog — the code the daemon loads."""
    script = (
        "const { ACTION_CATALOG } = await import(process.argv[1] + '/catalog.js');"
        "process.stdout.write([...new Set(Object.values(ACTION_CATALOG)"
        ".map(d => d.capabilityTier))].join(','));"
    )
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script, str(DIST)],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip()[:200] or "could not read the catalog")
    return {tier for tier in result.stdout.split(",") if tier}


def main() -> int:
    failures: list[str] = []
    try:
        inventory = json.loads(INVENTORY.read_text(encoding="utf-8"))
        entries = inventory["entries"]
    except (OSError, KeyError, json.JSONDecodeError) as error:
        print(f"data inventory: FAIL cannot read the inventory ({error})")
        return 1

    # 2. every field, non-empty.
    for entry in entries:
        name = entry.get("data", "?")
        for field in REQUIRED_FIELDS:
            value = entry.get(field)
            if not isinstance(value, str) or not value.strip():
                failures.append(f"{name}: `{field}` is missing or empty")

    # 1. every live tier, exactly once.
    claimed: dict[str, list[str]] = {}
    for entry in entries:
        for tier in entry.get("tiers") or []:
            claimed.setdefault(tier, []).append(entry.get("data", "?"))
    try:
        tiers = live_tiers()
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print(f"data inventory: FAIL could not read the live catalog ({error})")
        return 1

    for tier in sorted(tiers):
        holders = claimed.get(tier, [])
        if not holders:
            failures.append(
                f"capability tier '{tier}' touches data and no inventory entry claims it. "
                "Add it to the entry whose data it reaches."
            )
        elif len(holders) > 1:
            failures.append(f"tier '{tier}' is claimed by {len(holders)} entries: {', '.join(holders)}")
    for tier in sorted(set(claimed) - tiers):
        failures.append(f"tier '{tier}' is inventoried but no longer exists in the catalog")

    # 3. every configured store is named somewhere.
    try:
        config = json.loads(CONFIG.read_text(encoding="utf-8"))
        plugin_config = config["plugins"]["entries"]["orion-control"]["config"]
    except (OSError, KeyError, json.JSONDecodeError):
        plugin_config = {}
    storage_text = " ".join(entry.get("storage", "") for entry in entries)
    for key in PATH_KEYS:
        value = plugin_config.get(key)
        if not isinstance(value, str):
            continue
        # Matched on the FILENAME rather than the full path: the inventory
        # describes where things live in words a person reads, and pinning an
        # absolute path would make it fail on any machine but this one.
        leaf = re.sub(r"[^A-Za-z0-9._-]", "", Path(value).name)
        if leaf and leaf not in storage_text:
            failures.append(
                f"config `{key}` points at {leaf}, which no inventory entry names under `storage`"
            )

    for failure in failures:
        print(f"  FAIL  {failure}")
    print(
        f"data inventory: {len(entries)} entries covering {len(tiers)} live tier(s) — "
        f"{'OK' if not failures else f'FAIL ({len(failures)})'}"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
