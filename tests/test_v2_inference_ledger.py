"""Phase 2 slice 2: the inference ledger.

Two things these tests defend. First, that a row can answer the four questions
OpenClaw currently cannot -- how long, what it cost, why it failed, did it fall
back. Second, and more important, that the ledger never becomes a transcript.
"""

from __future__ import annotations

import json
import unittest
from datetime import datetime, timezone
from pathlib import Path

from orion.core.models.contract import ModelRef, Rates, RoleBinding
from orion.core.models.telemetry import (
    EXECUTORS,
    OUTCOMES,
    SCHEMA_VERSION,
    SOURCES,
    Fallback,
    TokenCounts,
    assert_carries_no_transcript,
    decode_record,
    encode_record,
    estimate_cost,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = REPO_ROOT / "orion" / "core" / "schemas" / "inference-record.schema.json"


def row(**overrides):
    record = {
        "schema_version": SCHEMA_VERSION,
        "ts": "2026-08-20T18:00:00Z",
        "role": "reasoning",
        "provider": "anthropic",
        "model": "claude-haiku-4-5-20251001",
        "latency_ms": 1240,
        "tokens": {"input": 3, "output": 121, "cache_read": 10198, "cache_write": 1264},
        "estimated_cost_usd": 0.0021,
        "fallback": {"fired": False, "from": None},
        "outcome": "succeeded",
        "failure_reason": None,
        "context_tokens": 11465,
        "correlation_id": "orion-task-0001",
        "source": "agent",
        "executor": "openclaw",
    }
    record.update(overrides)
    return record


class RecordDecodingTests(unittest.TestCase):
    def test_decodes_a_full_row_and_round_trips_it(self):
        decoded = decode_record(row())
        self.assertEqual(decoded.role, "reasoning")
        self.assertEqual(decoded.latency_ms, 1240)
        self.assertEqual(decoded.ts, datetime(2026, 8, 20, 18, 0, tzinfo=timezone.utc))
        self.assertEqual(decode_record(encode_record(decoded)), decoded)

    def test_records_the_four_fields_openclaw_does_not(self):
        # Latency, real cost, failure reason and fallback usage are the whole
        # reason this ledger exists; OpenClaw records the other two already.
        decoded = decode_record(
            row(
                outcome="failed",
                failure_reason="upstream_timeout",
                fallback={"fired": True, "from": "anthropic/claude-haiku-4-5-20251001"},
            )
        )
        self.assertEqual(decoded.latency_ms, 1240)
        self.assertEqual(decoded.estimated_cost_usd, 0.0021)
        self.assertEqual(decoded.failure_reason, "upstream_timeout")
        self.assertTrue(decoded.fallback.fired)
        self.assertEqual(decoded.fallback.from_model, "anthropic/claude-haiku-4-5-20251001")

    def test_separates_which_surface_asked_from_who_routed_it(self):
        # The point of two fields: taking routing in-house later changes only
        # `executor`, and these rows become the migration's own evidence.
        for executor in EXECUTORS:
            decoded = decode_record(row(executor=executor))
            self.assertEqual(decoded.source, "agent")
            self.assertEqual(decoded.executor, executor)
        for source in SOURCES:
            self.assertEqual(decode_record(row(source=source)).source, source)
        # No surface name encodes the router, so a swap re-labels nothing.
        self.assertNotIn("openclaw", SOURCES)

    def test_an_absent_token_count_stays_null_and_never_becomes_zero(self):
        decoded = decode_record(row(tokens={"input": None, "output": None}))
        self.assertIsNone(decoded.tokens.input)
        self.assertIsNone(decoded.tokens.output)
        self.assertIsNone(decoded.tokens.cache_read)
        self.assertIsNone(encode_record(decoded)["tokens"]["input"])
        # Zero is a different, sayable answer.
        self.assertEqual(decode_record(row(tokens={"input": 0, "output": 0})).tokens.input, 0)

    def test_rejects_unknown_and_missing_fields(self):
        for mutate, expected in (
            (lambda r: r.__setitem__("extra", 1), "unknown"),
            (lambda r: r.pop("executor"), "missing"),
            (lambda r: r.pop("source"), "missing"),
            (lambda r: r.pop("latency_ms"), "missing"),
            (lambda r: r["tokens"].__setitem__("nope", 1), "unknown"),
            (lambda r: r.__setitem__("schema_version", 2), "unsupported schema version"),
        ):
            record = row()
            mutate(record)
            with self.assertRaises(ValueError) as caught:
                decode_record(record)
            self.assertIn(expected, str(caught.exception))

    def test_rejects_vocabularies_it_does_not_recognise(self):
        for field, value in (
            ("role", "planner"),
            ("outcome", "ok"),
            ("source", "openclaw_agent"),
            ("executor", "anthropic"),
        ):
            with self.assertRaises(ValueError) as caught:
                decode_record(row(**{field: value}))
            self.assertIn(field, str(caught.exception))

    def test_a_row_must_not_claim_a_fallback_it_cannot_name(self):
        with self.assertRaisesRegex(ValueError, "fired is true but"):
            decode_record(row(fallback={"fired": True, "from": None}))
        with self.assertRaisesRegex(ValueError, "fired is false"):
            decode_record(row(fallback={"fired": False, "from": "ollama/x"}))

    def test_a_failure_must_say_why(self):
        with self.assertRaisesRegex(ValueError, "failure_reason is missing"):
            decode_record(row(outcome="failed", failure_reason=None))

    def test_rejects_negative_and_non_finite_numbers(self):
        for field, value, expected in (
            ("latency_ms", -1, "must not be negative"),
            ("latency_ms", 1.5, "must be an integer"),
            ("estimated_cost_usd", -0.01, "must not be negative"),
            ("estimated_cost_usd", float("inf"), "finite"),
            ("context_tokens", -5, "must not be negative"),
        ):
            with self.assertRaises(ValueError) as caught:
                decode_record(row(**{field: value}))
            self.assertIn(expected, str(caught.exception))

    def test_timestamps_must_carry_a_timezone(self):
        with self.assertRaisesRegex(ValueError, "must include a timezone"):
            decode_record(row(ts="2026-08-20T18:00:00"))


class TranscriptContainmentTests(unittest.TestCase):
    """The ledger records cost and outcome. It never records conversation.

    This machine holds health and financial data. A cost ledger is exactly the
    file that grows a "first 200 characters of the prompt, for debugging" field
    and quietly becomes a conversation log nobody agreed to.
    """

    def test_rejects_a_field_named_like_conversation(self):
        for name in ("prompt", "completion", "messages", "content", "response",
                     "transcript", "text", "system", "user", "assistant", "query"):
            with self.assertRaises(ValueError) as caught:
                assert_carries_no_transcript({name: "anything"})
            self.assertIn("transcript-shaped", str(caught.exception))

    def test_rejects_conversation_hidden_under_an_innocent_name(self):
        # The other way it goes wrong: a field called `detail` holding 4 KB of it.
        with self.assertRaisesRegex(ValueError, "this is prose"):
            assert_carries_no_transcript({"detail": "x" * 257})

    def test_finds_it_nested_anywhere_in_the_row(self):
        with self.assertRaises(ValueError):
            assert_carries_no_transcript({"debug": {"trace": [{"prompt": "hi"}]}})

    def test_encoding_a_record_is_itself_guarded(self):
        # Not just decoding. A future writer that stuffs prose into a field
        # fails on the way out, not only on the way back in.
        decoded = decode_record(row(failure_reason="upstream_timeout", outcome="failed"))
        self.assertEqual(encode_record(decoded)["failure_reason"], "upstream_timeout")
        object.__setattr__(decoded, "failure_reason", "y" * 300)
        with self.assertRaisesRegex(ValueError, "this is prose"):
            encode_record(decoded)

    def test_a_real_row_passes_untouched(self):
        assert_carries_no_transcript(row())


class CostEstimationTests(unittest.TestCase):
    def test_prices_an_inference_from_the_roles_declared_rates(self):
        role = RoleBinding(
            "reasoning", ModelRef("anthropic", "m"), (), 60, 1,
            Rates(input_per_mtok=1.0, output_per_mtok=5.0, cache_read_per_mtok=0.1), None,
        )
        cost = estimate_cost(role, TokenCounts(input=1_000_000, output=200_000, cache_read=10_000))
        self.assertAlmostEqual(cost, 1.0 + 1.0 + 0.001)

    def test_no_rates_means_none_not_zero(self):
        # None means "cannot price this". 0.0 means "priced it, it was free" --
        # true for local Ollama, and also what OpenClaw wrongly records for every
        # cloud call today. Collapsing them would hide that bug forever.
        unpriced = RoleBinding("local", ModelRef("ollama", "m"), (), 60, 0, None, None)
        self.assertIsNone(estimate_cost(unpriced, TokenCounts(input=5, output=5)))

        free = RoleBinding(
            "local", ModelRef("ollama", "m"), (), 60, 0,
            Rates(input_per_mtok=0.0, output_per_mtok=0.0), None,
        )
        self.assertEqual(estimate_cost(free, TokenCounts(input=5, output=5)), 0.0)

    def test_missing_counts_do_not_inflate_the_estimate(self):
        role = RoleBinding(
            "reasoning", ModelRef("anthropic", "m"), (), 60, 1,
            Rates(input_per_mtok=1.0, output_per_mtok=5.0), None,
        )
        self.assertEqual(estimate_cost(role, TokenCounts(input=None, output=None)), 0.0)


class SchemaParityTests(unittest.TestCase):
    """Python is a reference implementation of the language-neutral schema. If
    they drift, the TypeScript and Swift writers inherit a validator that
    disagrees with the document they were handed."""

    def setUp(self):
        self.schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))

    def test_closed_vocabularies_match(self):
        props = self.schema["properties"]
        self.assertEqual(tuple(props["outcome"]["enum"]), OUTCOMES)
        self.assertEqual(tuple(props["source"]["enum"]), SOURCES)
        self.assertEqual(tuple(props["executor"]["enum"]), EXECUTORS)
        self.assertEqual(props["schema_version"]["const"], SCHEMA_VERSION)

    def test_schema_requires_source_and_executor_and_closes_the_row(self):
        self.assertIn("source", self.schema["required"])
        self.assertIn("executor", self.schema["required"])
        self.assertFalse(self.schema["additionalProperties"])

    def test_schema_carries_no_field_that_could_hold_conversation(self):
        # Run the guard over the schema's own field NAMES as keys -- passing a
        # list would check nothing, since the guard inspects dict keys.
        assert_carries_no_transcript({name: None for name in self.schema["properties"]})

    def test_that_guard_would_actually_catch_a_bad_schema(self):
        # Proves the previous test is not vacuous: the same call fails the
        # moment a conversational field is added to the schema.
        polluted = dict.fromkeys(self.schema["properties"])
        polluted["prompt"] = None
        with self.assertRaisesRegex(ValueError, "transcript-shaped"):
            assert_carries_no_transcript(polluted)


if __name__ == "__main__":
    unittest.main()
