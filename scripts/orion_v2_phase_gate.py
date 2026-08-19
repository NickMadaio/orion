#!/usr/bin/env python3
"""Validate ORION v2 phase gates and refuse skipped-phase work."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


ALLOWED_REQUIREMENT_STATUS = {"passed", "blocked"}
ALLOWED_PHASE_STATUS = {"not_started", "planned", "blocked", "in_progress", "complete"}


def validate_gate(document: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(document, dict) or document.get("schemaVersion") != 1:
        return ["unsupported or missing schemaVersion"]
    phases = document.get("phases")
    if not isinstance(phases, dict) or not phases:
        return ["phases must be a non-empty object"]

    allowed_by_phase: dict[str, bool] = {}
    for phase_id, phase in phases.items():
        if not isinstance(phase, dict):
            errors.append(f"phase {phase_id} must be an object")
            continue
        if phase.get("status") not in ALLOWED_PHASE_STATUS:
            errors.append(f"phase {phase_id} has invalid status")
        requirements = phase.get("requirements")
        if requirements is None:
            continue
        if not isinstance(requirements, list) or not requirements:
            errors.append(f"phase {phase_id} requirements must be a non-empty list")
            continue
        seen: set[str] = set()
        all_passed = True
        for index, requirement in enumerate(requirements):
            if not isinstance(requirement, dict):
                errors.append(f"phase {phase_id} requirement {index} must be an object")
                all_passed = False
                continue
            requirement_id = requirement.get("id")
            if not isinstance(requirement_id, str) or not requirement_id:
                errors.append(f"phase {phase_id} requirement {index} has no id")
            elif requirement_id in seen:
                errors.append(f"phase {phase_id} repeats requirement {requirement_id}")
            else:
                seen.add(requirement_id)
            status = requirement.get("status")
            if status not in ALLOWED_REQUIREMENT_STATUS:
                errors.append(f"phase {phase_id} requirement {requirement_id} has invalid status")
                all_passed = False
            elif status != "passed":
                all_passed = False
                if not requirement.get("reason"):
                    errors.append(
                        f"phase {phase_id} blocked requirement {requirement_id} needs a reason"
                    )
            if not requirement.get("evidence"):
                errors.append(f"phase {phase_id} requirement {requirement_id} needs evidence")
        if phase.get("nextPhaseAllowed") is not all_passed:
            errors.append(f"phase {phase_id} nextPhaseAllowed disagrees with requirements")
        allowed_by_phase[phase_id] = all_passed

    for phase_id, phase in phases.items():
        if not isinstance(phase, dict) or "entryRequiresPhase" not in phase:
            continue
        previous = str(phase["entryRequiresPhase"])
        expected = allowed_by_phase.get(previous, False)
        if phase.get("entrySatisfied") is not expected:
            errors.append(f"phase {phase_id} entrySatisfied disagrees with phase {previous}")
    return errors


def blocked_requirements(phase: dict[str, Any]) -> list[dict[str, Any]]:
    requirements = phase.get("requirements", [])
    if not isinstance(requirements, list):
        return []
    return [item for item in requirements if isinstance(item, dict) and item.get("status") != "passed"]


def main(argv: list[str] | None = None) -> int:
    repo = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", type=Path, default=repo / "planning/v2/PHASE_GATES.json")
    parser.add_argument("--phase", default="0")
    parser.add_argument("--require-open", action="store_true")
    arguments = parser.parse_args(argv)

    try:
        document = json.loads(arguments.file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"phase gate: FAIL {error}")
        return 2
    errors = validate_gate(document)
    if errors:
        print(f"phase gate: FAIL {'; '.join(errors)}")
        return 2
    phase = document["phases"].get(arguments.phase)
    if not isinstance(phase, dict):
        print(f"phase gate: FAIL unknown phase {arguments.phase}")
        return 2
    blocked = blocked_requirements(phase)
    is_open = phase.get("nextPhaseAllowed") is True
    if blocked:
        names = ",".join(str(item.get("id")) for item in blocked)
        print(f"phase gate: phase {arguments.phase} blocked ({names})")
    else:
        print(f"phase gate: phase {arguments.phase} requirements passed")
    if arguments.require_open and not is_open:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
