from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "orion_v2_live_smoke", REPO_ROOT / "scripts" / "orion_v2_live_smoke.py"
)
assert SPEC is not None and SPEC.loader is not None
smoke = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = smoke
SPEC.loader.exec_module(smoke)


def valid_record(goal: str) -> dict:
    return {
        "taskId": "orion-fixture",
        "goal": goal,
        "status": "succeeded",
        "authorization": {"binding": "run", "turnCount": 1},
        "validation": {"status": "ready", "valid": True},
        "steps": [
            {
                "status": "verified",
                "request": {"action": "system_status", "arguments": {}},
                "verification": {"observed": True},
            }
        ],
    }


class LiveSmokeTests(unittest.TestCase):
    def test_parses_the_same_nested_shape_as_gateway_client(self):
        raw = 'diagnostic\n' + json.dumps(
            {"status": "ok", "result": {"payloads": [{"text": "marker"}]}}
        )
        payload = smoke.parse_agent_payload(raw)
        self.assertEqual(smoke.extract_reply(payload), "marker")

    def test_ledger_reader_only_returns_rows_appended_after_the_offset(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ledger.jsonl"
            path.write_text(json.dumps({"goal": "old"}) + "\n")
            offset = path.stat().st_size
            with path.open("a") as handle:
                handle.write(json.dumps({"goal": "new"}) + "\n")
            self.assertEqual(smoke.new_ledger_records(path, offset), [{"goal": "new"}])

    def test_accepts_only_authenticated_verified_system_status(self):
        goal = "phase 0 fixture"
        self.assertEqual(smoke.validate_record(valid_record(goal), goal), [])

        wrong_action = valid_record(goal)
        wrong_action["steps"][0]["request"]["action"] = "browser_open_url"
        self.assertIn("unexpected action executed", smoke.validate_record(wrong_action, goal))

        unbound = valid_record(goal)
        unbound["authorization"] = {"binding": "none", "turnCount": 0}
        errors = smoke.validate_record(unbound, goal)
        self.assertIn("authorization was not bound to a user turn", errors)
        self.assertIn("authorization contained no authenticated turn", errors)


if __name__ == "__main__":
    unittest.main()
