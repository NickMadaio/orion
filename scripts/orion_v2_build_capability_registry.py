#!/usr/bin/env python3
"""Generate the capability registry from the live catalog.

Seventy-eight entries typed by hand would be wrong somewhere and would drift the
first time catalog.ts changed. This derives everything derivable -- risk,
approval, reversibility, tier, required argument names -- and applies a reviewed
overlay for what cannot be derived: the dotted capability name, the context
domain, and the return shape.

Read-only with respect to the plugin. It writes only the registry.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from orion.core.tools.registry import decode_registry  # noqa: E402

PLUGIN = REPO_ROOT / "openclaw-plugins" / "orion-control"
REGISTRY = REPO_ROOT / "planning" / "v2" / "capability-registry.json"

# Capability-name prefix and context domain per tier. The domain is the field
# Phase 3's firewall was waiting on: until a capability says it belongs to
# `health` or `files`, the isolation matrix cannot be applied to a real request.
TIER_RULES = {
    "desktop_read":           ("files",    "files"),
    "home_read":              ("files",    "files"),
    "test_workspace":         ("files",    "files"),
    "scratch_workspace":      ("files",    "files"),
    "desktop_test_workspace": ("files",    "files"),
    "desktop_modify":         ("files",    "files"),
    "desktop_direct_write":   ("files",    "files"),
    "scratch_direct_write":   ("files",    "files"),
    "file_mutate":            ("files",    "files"),
    "app_control":            ("application", "computer"),
    "browser_control":        ("browser",  "computer"),
    "media_control":          ("system",   "computer"),
    "ambient_info":           ("device",   "computer"),
    "simulation":             ("simulation", "general"),
    "reminders":              ("reminder", "calendar"),
    "calendar":               ("calendar", "calendar"),
    "health_tracking":        ("health",   "health"),
    "messages_read":          ("messages", "conversation"),
    "messages_send":          ("messages", "conversation"),
    # Everything that reconfigures Orion itself is security, not general. A
    # capability that can rewrite Orion's own permissions is a security
    # capability whatever else it looks like.
    "self_modification":      ("orion.self", "security"),
    "self_plugin":            ("orion.plugin", "security"),
    "self_scripts":           ("orion.script", "security"),
    "self_config":            ("orion.config", "security"),
    "self_tuning":            ("orion.tuning", "security"),
}

# Per-action departures from the tier rule, each because the tier is a coarser
# thing than the action.
ACTION_OVERRIDES = {
    "clock_now":     ("general.clock.read", "general"),
    "weather_now":   ("general.weather.read", "general"),
    "system_status": ("device.status.read", "computer"),
}

# What each execution kind actually changes outside ORION.
EFFECTS_BY_KIND = {
    "list_directory":  ["reads_files"],
    "path_metadata":   ["reads_files"],
    "read_text":       ["reads_files"],
    "ambient_read":    ["reads_device_state"],
    "simulate":        [],
    "app_control":     ["launches_process", "quits_process"],
    "browser_control": ["launches_process", "network_request"],
    "media_control":   ["controls_media"],
    "reminder":        ["writes_files"],
    "calendar":        ["reads_user_data"],
    "health_log":      ["writes_files", "reads_user_data"],
    "messages_read":   ["reads_user_data"],
    "messages_send":   ["sends_message"],
    "self_source":     ["reads_files"],
    "self_modify":     ["writes_files", "changes_orion_config"],
    "self_repair":     ["writes_files", "changes_orion_config"],
    "self_tuning":     ["changes_orion_config"],
    "create_only_text": ["writes_files"],
    "mutate_text":     ["writes_files"],
    "mutate_file":     ["writes_files"],
    "create_directory": ["writes_files"],
    # file_move / file_rename / file_delete. Listed separately from mutate_file
    # because moving and deleting are not writing, and a policy that treats them
    # the same is a policy that lets a delete through a write rule.
    "file_mutate":     ["moves_files", "deletes_files"],
}


def read_catalog() -> list[dict]:
    """Ask the compiled catalog what it contains.

    Parsing catalog.ts with regular expressions was tried and produced fields
    leaking between entries; the compiled module is the only reliable answer.
    """

    script = """
const { ACTION_CATALOG } = require('./dist/catalog.js');
process.stdout.write(JSON.stringify(Object.entries(ACTION_CATALOG).map(([action, d]) => ({
  action, risk: d.risk, required: d.requiredArguments || [],
  approval: d.approvalRequired, reversible: d.reversible,
  tier: d.capabilityTier, kind: d.execution && d.execution.kind,
  verification: d.verification,
  hasValidator: typeof d.validateArguments === 'function',
}))));
"""
    result = subprocess.run(
        ["node", "-e", script], cwd=PLUGIN, capture_output=True, text=True, timeout=60
    )
    if result.returncode != 0:
        raise RuntimeError(f"could not read the catalog: {result.stderr.strip()[:400]}")
    return json.loads(result.stdout)


#: A leading action segment that merely repeats its tier, and can be dropped.
#: `messages_recent` under the `messages` prefix should be `messages.recent`,
#: not `messages.messages.recent`. Scope words like `desktop` and `home` are NOT
#: in here: they distinguish `files.desktop.list` from `files.home.list`, and
#: dropping them collided those two into one name.
REDUNDANT_HEAD = {
    "messages_read": "messages",
    "messages_send": "messages",
    "reminders": "reminder",
    "calendar": "calendar",
    "app_control": "app",
    "browser_control": "browser",
    "self_modification": "self",
    "self_plugin": "self_plugin",
    "self_scripts": "self_script",
    "self_config": "self_config",
    "self_tuning": "voice_tuning",
}

MAX_SEGMENTS = 4


def capability_name(action: str, tier: str) -> str:
    """A dotted name that is hierarchical AND unique.

    Uniqueness is not a nicety here: `desktop_list` and `home_list` both reduce
    to `files.list` under naive prefix-stripping, and the registry validator
    rejected the collision rather than letting two different capabilities answer
    to one name.
    """

    if action in ACTION_OVERRIDES:
        return ACTION_OVERRIDES[action][0]

    prefix, _ = TIER_RULES[tier]
    # Same reasoning as PREFIX_DOMAINS: a self_* action tiered `desktop_read`
    # must not be named `files.source.read`, because the name is what a reader
    # uses to understand what the capability touches.
    if action.startswith("self_"):
        prefix = {
            "self_source": "orion.source",
            "self_plugin": "orion.plugin",
            "self_script": "orion.script",
            "self_config": "orion.config",
            "self_repair": "orion.repair",
            "self_modify": "orion.self",
        }.get("_".join(action.split("_")[:2]), "orion.self")
    remainder = action
    head = REDUNDANT_HEAD.get(tier)
    if action.startswith("self_"):
        head = "_".join(action.split("_")[:2])
    if head and remainder.startswith(f"{head}_"):
        remainder = remainder[len(head) + 1:]
    elif head and remainder == head:
        remainder = "run"

    segments = [part for part in remainder.split("_") if part]
    prefix_segments = prefix.split(".")
    room = MAX_SEGMENTS - len(prefix_segments)
    if len(segments) > room:
        # Join the tail rather than truncating it: losing `explicit` from
        # `desktop_file_write_explicit` would name a guarded action as if it
        # were the unguarded one.
        segments = segments[: room - 1] + ["_".join(segments[room - 1:])]

    return ".".join(prefix_segments + segments)


#: Domain by action-name prefix, taking precedence over the tier rule.
#:
#: Tier and domain answer different questions and must not be conflated. Tier
#: says how an action is PERMISSION-GATED; domain says what it is ABOUT. The
#: read-only `self_*` actions are tiered `desktop_read` because reading Orion's
#: own source is gated like reading the Desktop -- a sensible permission call
#: that made tier a bad proxy for domain, and put `self_plugin_read` in `files`
#: when the material it reads is Orion's own authority code.
PREFIX_DOMAINS = (
    ("self_", "security"),
)


def domain_for(action: str, tier: str) -> str:
    if action in ACTION_OVERRIDES:
        return ACTION_OVERRIDES[action][1]
    for prefix, domain in PREFIX_DOMAINS:
        if action.startswith(prefix):
            return domain
    return TIER_RULES[tier][1]


def arguments_schema(required: list[str]) -> dict:
    """A closed object schema over the declared arguments.

    Property schemas are deliberately `{}` -- "this key is known, its type is not
    yet pinned here". Inventing a type for an argument nobody has verified would
    be a fabrication dressed as rigour, and 61 of the 78 actions already run a
    hand-written `validateArguments` in TypeScript that does the real per-value
    checking. What this schema DOES assert is the manifest's actual requirement:
    unknown fields are rejected.
    """

    return {
        "type": "object",
        "additionalProperties": False,
        "required": sorted(required),
        "properties": {name: {} for name in sorted(required)},
    }


def build() -> dict:
    entries = []
    for row in read_catalog():
        tier = row["tier"]
        if tier not in TIER_RULES:
            raise RuntimeError(f"{row['action']}: tier {tier!r} has no registry rule")
        effects = EFFECTS_BY_KIND.get(row["kind"])
        if effects is None:
            raise RuntimeError(f"{row['action']}: execution kind {row['kind']!r} has no effect mapping")
        entry = {
            "action": row["action"],
            "capability": capability_name(row["action"], tier),
            "domain": domain_for(row["action"], tier),
            "risk": row["risk"],
            "approval_required": bool(row["approval"]),
            "reversible": bool(row["reversible"]),
            "side_effects": effects,
            "resource_scope": tier,
            "platforms": ["macos"],
            "arguments": arguments_schema(row["required"]),
            "returns": {"type": "object"},
            "audit": "task_ledger",
        }
        if row["hasValidator"]:
            entry["note"] = "catalog.ts also runs a hand-written validateArguments for this action"
        entries.append(entry)

    entries.sort(key=lambda e: e["capability"])
    return {"schema_version": 1, "capabilities": entries}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    registry = build()
    decode_registry(registry)  # refuse to emit something the validator rejects

    names = [e["capability"] for e in registry["capabilities"]]
    print(f"actions      : {len(names)}")
    print(f"domains      : {sorted({e['domain'] for e in registry['capabilities']})}")
    print(f"needs approval: {sum(1 for e in registry['capabilities'] if e['approval_required'])}")
    print(f"no arguments : {sum(1 for e in registry['capabilities'] if not e['arguments']['required'])}")

    if args.write:
        REGISTRY.write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
        print(f"\nwrote {REGISTRY.relative_to(REPO_ROOT)}")
    else:
        print("\ndry run; pass --write")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
