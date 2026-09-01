"""Phase 2 slice 7: the Mac-side adapter that resolves roles and writes rows.

Core defines the contract and the record and performs no I/O; this adapter does
the I/O. Its defining property is that it fails soft -- a voice daemon must
never go silent because a telemetry file was unwritable.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from orion.core.models.contract import decode_contract
from orion.core.models.telemetry import TokenCounts, decode_record
from orion.mac import inference_ledger as adapter


REPO_ROOT = Path(__file__).resolve().parents[1]
SEED = REPO_ROOT / "planning" / "v2" / "model-roles.seed.json"


class RoleResolutionTests(unittest.TestCase):
    def test_resolves_a_role_to_a_bare_model_name(self):
        # Bare, not provider/model: it is what every caller passes to its client.
        self.assertEqual(adapter.resolve("local", "unused", SEED), "gpt-oss:20b")

    def test_a_missing_contract_leaves_the_caller_on_its_own_default(self):
        self.assertEqual(
            adapter.resolve("local", "compiled-in-default", Path("/definitely/absent.json")),
            "compiled-in-default",
        )

    def test_a_malformed_contract_does_not_take_the_caller_down(self):
        with tempfile.TemporaryDirectory() as directory:
            broken = Path(directory) / "broken.json"
            broken.write_text("{ this is not json", encoding="utf-8")
            self.assertIsNone(adapter.load_contract(broken))
            self.assertEqual(adapter.resolve("local", "safe", broken), "safe")

    def test_an_unassigned_role_falls_back_rather_than_substituting(self):
        self.assertEqual(adapter.resolve("vision", "no-vision-model", SEED), "no-vision-model")


class AppendTests(unittest.TestCase):
    def setUp(self):
        self.contract = decode_contract(json.loads(SEED.read_text(encoding="utf-8")))
        self.directory = tempfile.TemporaryDirectory()
        self.ledger = Path(self.directory.name) / "inference-ledger.jsonl"

    def tearDown(self):
        self.directory.cleanup()

    def rows(self):
        return [
            json.loads(line)
            for line in self.ledger.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    def test_writes_one_valid_row_that_core_can_decode_back(self):
        ok = adapter.append(
            "tts", "mlx/Marvis-AI_marvis-tts-250m-v0.2-MLX-8bit", 412,
            source="tts_daemon", ledger=self.ledger, contract=self.contract,
            now=datetime(2026, 8, 23, 12, 0, tzinfo=timezone.utc),
        )
        self.assertTrue(ok)
        row = self.rows()[0]
        self.assertEqual(row["role"], "tts")
        self.assertEqual(row["provider"], "mlx")
        self.assertEqual(row["executor"], "direct")
        # Round-trips through the Core validator, so a writer cannot emit a row
        # the reader will later reject.
        decode_record(row)

    def test_appends_rather_than_truncating(self):
        for index in range(3):
            adapter.append("tts", "mlx/m", index, source="tts_daemon",
                           ledger=self.ledger, contract=self.contract)
        self.assertEqual(len(self.rows()), 3)

    def test_creates_the_ledger_private_to_the_user(self):
        adapter.append("tts", "mlx/m", 1, source="tts_daemon",
                       ledger=self.ledger, contract=self.contract)
        self.assertEqual(self.ledger.stat().st_mode & 0o777, 0o600)

    def test_prices_a_paid_role_from_the_contract(self):
        adapter.append(
            "reasoning", "anthropic/claude-haiku-4-5-20251001", 100,
            source="native_app", tokens=TokenCounts(input=1_000_000, output=0),
            ledger=self.ledger, contract=self.contract,
        )
        self.assertAlmostEqual(self.rows()[0]["estimated_cost_usd"], 1.0)

    def test_records_a_failure_with_its_reason(self):
        adapter.append("tts", "elevenlabs/eleven_flash_v2_5", 50, source="tts_daemon",
                       outcome="failed", failure_reason="http_429",
                       fell_back_from="mlx/Marvis-AI_marvis-tts-250m-v0.2-MLX-8bit",
                       ledger=self.ledger, contract=self.contract)
        row = self.rows()[0]
        self.assertEqual(row["outcome"], "failed")
        self.assertEqual(row["failure_reason"], "http_429")
        self.assertTrue(row["fallback"]["fired"])


class FailSoftTests(unittest.TestCase):
    """Telemetry must never be why a user cannot hear their assistant."""

    def test_an_unwritable_ledger_returns_false_instead_of_raising(self):
        self.assertFalse(
            adapter.append("tts", "mlx/m", 1, source="tts_daemon",
                           ledger=Path("/definitely/not/writable/led.jsonl"))
        )

    def test_a_nonsense_role_returns_false_instead_of_raising(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertFalse(
                adapter.append("not_a_role", "mlx/m", 1, source="tts_daemon",
                               ledger=Path(directory) / "l.jsonl")
            )

    def test_a_reference_with_no_provider_still_produces_a_valid_row(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / "l.jsonl"
            self.assertTrue(
                adapter.append("local", "bare-model-name", 5, source="native_app",
                               ledger=ledger)
            )
            decode_record(json.loads(ledger.read_text().strip()))


if __name__ == "__main__":
    unittest.main()
