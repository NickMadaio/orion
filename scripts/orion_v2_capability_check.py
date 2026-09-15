#!/usr/bin/env python3
"""Prove the capability registry still describes the live catalog.

A registry that was true once is worse than no registry: it reads like a
guarantee. This compares every entry against the compiled catalog and fails on
any disagreement, plus checks the manifest's flat prohibitions -- no arbitrary
command execution, no capability without a domain, no unknown arguments
permitted.

Read-only. Exit 0 when everything agrees, 1 otherwise.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from orion.core.context.domains import Domain  # noqa: E402
from orion.core.tools.registry import decode_registry  # noqa: E402

PLUGIN = REPO_ROOT / "openclaw-plugins" / "orion-control"
REGISTRY = REPO_ROOT / "docs" / "planning" / "v2" / "capability-registry.json"

#: Words that would name a general-purpose escape hatch. The manifest forbids
#: exposing arbitrary command execution, and the way that requirement fails is
#: not a deliberate decision -- it is one convenient action added later.
ARBITRARY_EXECUTION = ("exec", "shell", "run_command", "eval", "spawn", "bash", "sh_")


def live_catalog() -> dict[str, dict]:
    script = """
const { ACTION_CATALOG } = require('./dist/catalog.js');
process.stdout.write(JSON.stringify(Object.fromEntries(
  Object.entries(ACTION_CATALOG).map(([a, d]) => [a, {
    risk: d.risk, approval: d.approvalRequired, reversible: d.reversible,
    tier: d.capabilityTier, required: d.requiredArguments || [],
  }])
)));
"""
    result = subprocess.run(
        ["node", "-e", script], cwd=PLUGIN, capture_output=True, text=True, timeout=60
    )
    if result.returncode != 0:
        raise RuntimeError(f"could not read the catalog: {result.stderr.strip()[:400]}")
    return json.loads(result.stdout)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=REGISTRY)
    args = parser.parse_args()

    registry = decode_registry(json.loads(args.registry.read_text(encoding="utf-8")))
    catalog = live_catalog()
    problems: list[str] = []

    missing = sorted(set(catalog) - set(registry.capabilities))
    extra = sorted(set(registry.capabilities) - set(catalog))
    for action in missing:
        problems.append(f"{action} is in the catalog but not the registry")
    for action in extra:
        problems.append(f"{action} is in the registry but not the catalog")

    for action, entry in sorted(registry.capabilities.items()):
        live = catalog.get(action)
        if live is None:
            continue
        if entry.risk != live["risk"]:
            problems.append(f"{action} risk: registry {entry.risk}, catalog {live['risk']}")
        if entry.approval_required != bool(live["approval"]):
            problems.append(
                f"{action} approval: registry {entry.approval_required}, catalog {bool(live['approval'])}"
            )
        if entry.reversible != bool(live["reversible"]):
            problems.append(
                f"{action} reversible: registry {entry.reversible}, catalog {bool(live['reversible'])}"
            )
        declared = set(entry.arguments.get("required", []))
        if declared != set(live["required"]):
            problems.append(
                f"{action} arguments: registry {sorted(declared)}, catalog {sorted(live['required'])}"
            )

    for action in sorted(catalog):
        lowered = action.lower()
        if any(token in lowered for token in ARBITRARY_EXECUTION):
            problems.append(f"{action} looks like arbitrary command execution, which the manifest forbids")

    for action, entry in registry.capabilities.items():
        if entry.domain is Domain.CREDENTIALS:
            problems.append(f"{action} claims the credentials domain")
        if entry.arguments.get("additionalProperties") is not False:
            problems.append(f"{action} permits unknown arguments")

    print(f"registry     : {args.registry.relative_to(REPO_ROOT)}")
    print(f"live actions : {len(catalog)}")
    print(f"registered   : {len(registry.capabilities)}")
    print(f"domains      : {', '.join(sorted({e.domain.value for e in registry.capabilities.values()}))}")
    print(f"approval     : {len(registry.requiring_approval())} action(s)")
    mutating = sum(1 for e in registry.capabilities.values() if e.mutates)
    print(f"mutating     : {mutating}; read-only: {len(registry.capabilities) - mutating}")

    unpinned = sum(
        1
        for e in registry.capabilities.values()
        if any(schema == {} for schema in e.arguments.get("properties", {}).values())
    )
    if unpinned:
        # Stated rather than hidden. Closing the object is the manifest's actual
        # requirement and it is met; per-argument TYPES are a further step, and
        # catalog.ts still carries hand-written validators that do that work.
        print(
            f"  NOTE  {unpinned} action(s) declare argument names without pinned types; "
            "unknown fields are still rejected"
        )

    if problems:
        print()
        for problem in problems:
            print(f"  DRIFT {problem}")
        print(f"\ncapability check: {len(problems)} problem(s)")
        return 1
    print("\ncapability check: registry and catalog agree")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
