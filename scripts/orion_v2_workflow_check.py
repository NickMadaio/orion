#!/usr/bin/env python3
"""PHASE 75 — hold a change to the eighteen steps, and to the last line.

The manifest lists eighteen steps for every significant feature and then adds a
sentence that is worth more than the list:

    Do not ask one coding model to design, implement, review, and approve its
    own security-sensitive feature without independent review.

Most of the eighteen are judgement -- "define trust boundaries" is not something
a script can grade. Five of them ARE mechanical, and those five are the ones a
tired person skips, so those are the five this checks. The rest are printed as
a checklist, because a step nobody can see is a step nobody does.

  MECHANICAL
    8/10  tests exist and changed alongside the source
    12    security review: a change to the ENFORCEMENT path needs an
          independent review recorded in PHASE_GATES.json
    14    documentation: HANDOFF.md moved
    15    data inventory: a new capability tier is inventoried
    18    gates pass

WHAT COUNTS AS INDEPENDENT

Not the model that wrote the change. `PHASE_GATES.json` already carries a
`reviews` array with four entries, every one of them describing a reviewer with
no context of how the work was done and instructed to verify rather than trust.
That is the bar. A review written by the same session that made the change is
not one, and this refuses to accept it as one -- it checks that a review exists
covering the range, and it cannot check who wrote it, which is stated plainly
below rather than implied.

  orion_v2_workflow_check.py                 against origin/HEAD
  orion_v2_workflow_check.py --since <ref>
  orion_v2_workflow_check.py --checklist     the eighteen, for a human
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
GATES = REPO / "planning/v2/PHASE_GATES.json"
PLUGIN_SRC = "openclaw-plugins/orion-control/src/"

#: Kept in step with ENFORCEMENT_PLUGIN_FILES in selfrepair.ts. Duplicated
#: deliberately and narrowly: this script must work without importing the
#: plugin, and the list is short enough that a drift is visible. The check
#: below verifies it has not drifted.
ENFORCEMENT = {
    "approvals.ts", "catalog.ts", "controller.ts", "index.ts", "permissions.ts",
    "provenance.ts", "selfrepair.ts", "strictness.ts", "transcript.ts", "validator.ts",
}

STEPS = [
    ("1", "Define requirements", "judgement"),
    ("2", "Define trust boundaries", "judgement"),
    ("3", "Define data involved", "judgement"),
    ("4", "Define permissions required", "judgement"),
    ("5", "Define failure modes", "judgement"),
    ("6", "Define threat model", "judgement"),
    ("7", "Define schemas", "judgement"),
    ("8", "Define tests", "mechanical"),
    ("9", "Implement", "judgement"),
    ("10", "Run tests", "mechanical"),
    ("11", "Fresh-context code review", "judgement"),
    ("12", "Security review", "mechanical"),
    ("13", "Test failure/retry behaviour", "judgement"),
    ("14", "Update documentation", "mechanical"),
    ("15", "Update data inventory", "mechanical"),
    ("16", "Deploy to staging", "n/a"),
    ("17", "Validate staging", "n/a"),
    ("18", "Merge/deploy only after gates pass", "mechanical"),
]


def changed_files(since: str) -> list[str]:
    result = subprocess.run(
        ["git", "-C", str(REPO), "diff", "--name-only", f"{since}...HEAD"],
        capture_output=True, text=True,
    )
    tracked = [line for line in result.stdout.split("\n") if line.strip()]
    dirty = subprocess.run(
        ["git", "-C", str(REPO), "status", "--porcelain"],
        capture_output=True, text=True,
    ).stdout
    uncommitted = [line[3:].strip() for line in dirty.split("\n") if line.strip()]
    return sorted(set(tracked) | set(uncommitted))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", default="origin/HEAD")
    parser.add_argument("--checklist", action="store_true")
    arguments = parser.parse_args()

    if arguments.checklist:
        print("\n  Phase 75, the eighteen steps:\n")
        for number, text, kind in STEPS:
            mark = {"mechanical": "checked here", "judgement": "yours", "n/a": "no staging exists"}[kind]
            print(f"   {number:>2}. {text:<38} {mark}")
        print("\n  And the line that matters more than the list:")
        print("    Do not ask one coding model to design, implement, review and")
        print("    approve its own security-sensitive feature without independent review.\n")
        return 0

    failures: list[str] = []
    notes: list[str] = []
    files = changed_files(arguments.since)
    if not files:
        print("workflow check: nothing changed since " + arguments.since)
        return 0

    source = [f for f in files if f.startswith(PLUGIN_SRC) and f.endswith(".ts") and ".test." not in f]
    tests = [f for f in files if ".test.ts" in f]
    scripts = [f for f in files if f.startswith("scripts/")]
    enforcement = [f for f in source if Path(f).name in ENFORCEMENT]

    # The duplicated list, checked rather than trusted.
    selfrepair = (REPO / PLUGIN_SRC / "selfrepair.ts").read_text(encoding="utf-8")
    block = selfrepair.split("ENFORCEMENT_PLUGIN_FILES")[1].split("]")[0] if "ENFORCEMENT_PLUGIN_FILES" in selfrepair else ""
    declared = {part.strip().strip('",') for part in block.split("\n") if '"' in part}
    if declared and declared != ENFORCEMENT:
        failures.append(
            "the enforcement list in this script has drifted from selfrepair.ts: "
            f"only here {sorted(ENFORCEMENT - declared)}, only there {sorted(declared - ENFORCEMENT)}"
        )

    # 8/10 — source moved, tests did not.
    if source and not tests:
        failures.append(
            f"{len(source)} plugin source file(s) changed and no test file did. "
            "Step 8 is 'define tests', and it comes before step 9."
        )
    else:
        notes.append(f"tests moved alongside {len(source)} source file(s)")

    # 12 — a security review, for a change to the enforcement path.
    if enforcement:
        try:
            reviews = json.loads(GATES.read_text(encoding="utf-8")).get("reviews", [])
        except (OSError, json.JSONDecodeError):
            reviews = []
        recent = [r for r in reviews if r.get("on", "") >= "2026-09-01"]
        if not recent:
            failures.append(
                f"the enforcement path changed ({', '.join(Path(f).name for f in enforcement)}) "
                "and no review dated 2026-09-01 or later is recorded in PHASE_GATES.json `reviews`. "
                "The manifest's own line: do not let one model design, implement, review and approve "
                "its own security-sensitive feature."
            )
        else:
            notes.append(f"{len(recent)} recent review(s) recorded")
            # Stated, not enforced. This script cannot tell who wrote a review,
            # and pretending it can would be the same self-approval one level up.
            notes.append("NOTE: this cannot verify the reviewer was independent. Only a person can.")

    # 14 — documentation.
    if (source or scripts) and "HANDOFF.md" not in files:
        failures.append("source or scripts changed and HANDOFF.md did not (step 14)")
    else:
        notes.append("HANDOFF.md moved with the change")

    # 15 — the data inventory, when the capability surface moved.
    if any(Path(f).name in {"catalog.ts", "permissions.ts"} for f in source):
        if "planning/v2/DATA_INVENTORY.json" not in files:
            failures.append(
                "the capability surface changed and DATA_INVENTORY.json did not (step 15). "
                "Run scripts/orion_v2_inventory_check.py — it will name the tier."
            )
        else:
            notes.append("data inventory moved with the capability surface")

    # 18 — the gates.
    gate = subprocess.run(
        ["python3", str(REPO / "scripts/orion_v2_phase_gate.py")],
        capture_output=True, text=True,
    )
    if gate.returncode != 0:
        failures.append(f"the phase gate does not pass: {gate.stdout.strip()[:120]}")
    else:
        notes.append("phase gate passes")

    print("")
    print(f"  {len(files)} file(s) changed since {arguments.since}")
    for note in notes:
        print(f"  ok    {note}")
    for failure in failures:
        print(f"  FAIL  {failure}")
    print("")
    print(f"workflow check: {'OK' if not failures else f'FAIL ({len(failures)})'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
