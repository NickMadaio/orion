"""Phase 2 slice 4: turning OpenClaw's own records into ledger rows.

Fixtures only -- no live sessions, no filesystem. The point of putting the
normalizer in Core is that it is a pure function over already-parsed records,
which is what makes these tests possible and keeps Core free of I/O.
"""

from __future__ import annotations

import json
import unittest
from datetime import timezone
from pathlib import Path

from orion.core.models.contract import decode_contract
from orion.core.models.ingest import UnknownModel, dedupe, normalize_session, role_index
from orion.core.models.telemetry import encode_record


REPO_ROOT = Path(__file__).resolve().parents[1]
SEED = REPO_ROOT / "planning" / "v2" / "model-roles.seed.json"


def contract():
    return decode_contract(json.loads(SEED.read_text(encoding="utf-8")))


def turn(ts, model="claude-haiku-4-5-20251001", provider="anthropic", **message):
    body = {
        "role": "assistant",
        "model": model,
        "provider": provider,
        "usage": {"input": 10, "output": 20, "cacheRead": 100, "cacheWrite": 5},
    }
    body.update(message)
    return {"id": f"id-{ts}", "timestamp": ts, "message": body}


def user(ts, content="whatever the user said"):
    return {"id": f"u-{ts}", "timestamp": ts, "message": {"role": "user", "content": content}}


class NormalizationTests(unittest.TestCase):
    def setUp(self):
        self.contract = contract()

    def test_maps_a_model_back_to_the_role_that_owns_it(self):
        rows = normalize_session([user("2026-08-23T10:00:00Z"), turn("2026-08-23T10:00:02Z")],
                                 self.contract)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].role, "reasoning")
        self.assertEqual(rows[0].source, "agent")
        self.assertEqual(rows[0].executor, "openclaw")

    def test_derives_latency_from_the_gap_openclaw_leaves_behind(self):
        # OpenClaw records a timestamp, not a duration. The only recoverable
        # latency is the gap to whatever preceded the reply.
        rows = normalize_session(
            [user("2026-08-23T10:00:00.000Z"), turn("2026-08-23T10:00:02.500Z")],
            self.contract,
        )
        self.assertEqual(rows[0].latency_ms, 2500)

    def test_a_first_turn_with_nothing_before_it_reports_zero_not_a_guess(self):
        rows = normalize_session([turn("2026-08-23T10:00:00Z")], self.contract)
        self.assertEqual(rows[0].latency_ms, 0)

    def test_prices_from_the_contract_rather_than_openclaws_zero(self):
        # OpenClaw's own cost block reports 0 for every call including paid ones.
        # Trusting it would carry that bug forward forever.
        rows = normalize_session(
            [turn("2026-08-23T10:00:00Z", usage={"input": 1_000_000, "output": 0,
                                                 "cost": {"total": 0}})],
            self.contract,
        )
        self.assertIsNotNone(rows[0].estimated_cost_usd)
        self.assertAlmostEqual(rows[0].estimated_cost_usd, 1.0)

    def test_detects_a_failure_and_prefers_the_code_over_the_message(self):
        # A provider's error text is free-form and can echo the request. A code
        # is a bounded token, and the ledger is not a place for free text.
        rows = normalize_session(
            [turn("2026-08-23T10:00:00Z", stopReason="error", errorCode="rate_limited",
                  errorMessage="Your request about the user's medical results was rejected")],
            self.contract,
        )
        self.assertEqual(rows[0].outcome, "failed")
        self.assertEqual(rows[0].failure_reason, "rate_limited")
        self.assertNotIn("medical", json.dumps(encode_record(rows[0])))

    def test_a_failure_with_no_code_still_says_something_usable(self):
        rows = normalize_session(
            [turn("2026-08-23T10:00:00Z", stopReason="error")], self.contract
        )
        self.assertEqual(rows[0].failure_reason, "provider_error")

    def test_recognises_a_fallback_and_names_what_it_fell_back_from(self):
        rows = normalize_session(
            [turn("2026-08-23T10:00:00Z", model="qwen3.6:27b", provider="ollama")],
            self.contract,
        )
        self.assertEqual(rows[0].role, "reasoning")
        self.assertTrue(rows[0].fallback.fired)
        self.assertEqual(rows[0].fallback.from_model, "anthropic/claude-haiku-4-5-20251001")

    def test_a_model_that_is_a_primary_elsewhere_is_not_called_a_fallback(self):
        # llama3.2:3b is both the `fast` primary and a `reasoning` fallback.
        # A row using it is overwhelmingly `fast` doing its job.
        rows = normalize_session(
            [turn("2026-08-23T10:00:00Z", model="llama3.2:3b", provider="ollama")],
            self.contract,
        )
        self.assertEqual(rows[0].role, "fast")
        self.assertFalse(rows[0].fallback.fired)

    def test_an_undeclared_model_raises_instead_of_being_skipped(self):
        # Silently dropping it would let the contract look like the single
        # source of truth while real traffic flowed past it.
        with self.assertRaises(UnknownModel) as caught:
            normalize_session(
                [turn("2026-08-23T10:00:00Z", model="mystery-9", provider="anthropic")],
                self.contract,
            )
        self.assertIn("mystery-9", str(caught.exception))

    def test_a_retired_model_resolves_to_the_role_it_used_to_serve(self):
        rows = normalize_session(
            [turn("2026-08-23T10:00:00Z", model="claude-haiku-4-5", provider="anthropic")],
            self.contract,
        )
        self.assertEqual(rows[0].role, "reasoning")

    def test_absent_token_counts_stay_absent(self):
        rows = normalize_session(
            [turn("2026-08-23T10:00:00Z", usage={"input": 5})], self.contract
        )
        self.assertEqual(rows[0].tokens.input, 5)
        self.assertIsNone(rows[0].tokens.output)
        self.assertIsNone(rows[0].tokens.cache_read)

    def test_ignores_everything_that_is_not_a_billed_assistant_turn(self):
        rows = normalize_session(
            [
                user("2026-08-23T10:00:00Z"),
                {"type": "session", "timestamp": "2026-08-23T10:00:01Z"},
                {"timestamp": "2026-08-23T10:00:02Z",
                 "message": {"role": "assistant", "content": "no usage block"}},
                turn("2026-08-23T10:00:03Z"),
            ],
            self.contract,
        )
        self.assertEqual(len(rows), 1)

    def test_reads_epoch_milliseconds_as_well_as_iso(self):
        record = turn("2026-08-23T10:00:00Z")
        record["timestamp"] = 1787341879439
        rows = normalize_session([record], self.contract)
        self.assertEqual(rows[0].ts.tzinfo, timezone.utc)


class TranscriptExclusionTests(unittest.TestCase):
    def test_no_message_content_survives_into_a_row(self):
        # The strongest form of the privacy promise: feed the normalizer a
        # session stuffed with sensitive text and prove none of it comes out.
        secret = "the user's cholesterol was 233 and their bank balance is 4102"
        records = [
            user("2026-08-23T10:00:00Z", content=secret),
            turn("2026-08-23T10:00:02Z", content=[{"type": "text", "text": secret}]),
        ]
        rows = normalize_session(records, contract())
        rendered = json.dumps([encode_record(r) for r in rows])
        self.assertNotIn("cholesterol", rendered)
        self.assertNotIn("4102", rendered)
        self.assertNotIn(secret, rendered)


class DeduplicationTests(unittest.TestCase):
    def test_a_rerun_over_the_same_sessions_adds_nothing(self):
        # Ingestion runs repeatedly over the same files; without this every
        # total doubles on the second run.
        rows = normalize_session(
            [turn("2026-08-23T10:00:00Z"), turn("2026-08-23T10:00:05Z")], contract()
        )
        seen: set[str] = set()
        self.assertEqual(len(dedupe(rows, seen)), 2)
        self.assertEqual(len(dedupe(rows, seen)), 0)


class RoleIndexTests(unittest.TestCase):
    def test_every_routed_and_retired_model_is_reachable(self):
        index = role_index(contract())
        self.assertEqual(index["anthropic/claude-haiku-4-5-20251001"].role, "reasoning")
        self.assertEqual(index["ollama/llama3.2:3b"].role, "fast")
        self.assertEqual(index["ollama/gemma4:31b"].role, "local")
        self.assertIsNone(index["ollama/llama3.2:3b"].fell_back_from)


if __name__ == "__main__":
    unittest.main()
