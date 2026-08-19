from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "orion_v2_phase_gate", REPO_ROOT / "scripts" / "orion_v2_phase_gate.py"
)
assert SPEC is not None and SPEC.loader is not None
gate = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = gate
SPEC.loader.exec_module(gate)


def phase_document(secret_status: str = "blocked") -> dict:
    allowed = secret_status == "passed"
    secret = {
        "id": "secrets_accounted_for",
        "status": secret_status,
        "evidence": "inventory.json",
    }
    if not allowed:
        secret["reason"] = "user confirmation required"
    return {
        "schemaVersion": 1,
        "phases": {
            "0": {
                "status": "blocked" if not allowed else "complete",
                "requirements": [
                    {"id": "architecture", "status": "passed", "evidence": "status.md"},
                    secret,
                ],
                "nextPhaseAllowed": allowed,
            },
            "1": {
                "status": "planned",
                "entryRequiresPhase": "0",
                "entrySatisfied": allowed,
            },
        },
    }


class PhaseGateTests(unittest.TestCase):
    def test_current_versioned_gate_is_valid_and_blocks_phase_one(self):
        current = json.loads((REPO_ROOT / "planning/v2/PHASE_GATES.json").read_text())
        self.assertEqual(gate.validate_gate(current), [])
        self.assertFalse(current["phases"]["0"]["nextPhaseAllowed"])
        self.assertEqual(
            [item["id"] for item in gate.blocked_requirements(current["phases"]["0"])],
            ["secrets_accounted_for"],
        )

    def test_all_passed_requirements_open_the_next_phase(self):
        document = phase_document("passed")
        self.assertEqual(gate.validate_gate(document), [])
        self.assertTrue(document["phases"]["1"]["entrySatisfied"])

    def test_mismatched_or_unexplained_gates_fail_validation(self):
        mismatch = phase_document("blocked")
        mismatch["phases"]["0"]["nextPhaseAllowed"] = True
        self.assertTrue(any("disagrees" in error for error in gate.validate_gate(mismatch)))

        unexplained = phase_document("blocked")
        del unexplained["phases"]["0"]["requirements"][1]["reason"]
        self.assertTrue(any("needs a reason" in error for error in gate.validate_gate(unexplained)))


if __name__ == "__main__":
    unittest.main()
