"""Phase 6: the central redaction middleware.

The manifest's never-log list is: access tokens, refresh tokens, passwords,
cookies, raw secrets, private keys, and complete sensitive prompts outside
secure-debug mode. One test per way each of those hides.
"""

from __future__ import annotations

import json
import unittest

from orion.core.audit.patterns import (
    BENIGN_FIELD_NAMES,
    CREDENTIAL_SHAPES,
    field_is_prompt,
    field_is_sensitive,
    normalize_field,
)
from orion.core.audit.redaction import (
    MAX_DEPTH,
    MAX_STRING,
    Redaction,
    redact,
    redact_text,
    redacted_summary,
)


SAMPLES = {
    "openai_style_key": "sk-abcdefghijklmnopqrstuvwxyz012345",
    "github_token": "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "aws_access_key": "AKIAIOSFODNN7EXAMPLE",
    "slack_token": "xoxb-0000000000-abcdefghijklmnop",
    "google_api_key": "AIzaSyA0000000000000000000000000000000",
    "stripe_live_key": "sk_live_0000000000000000abcd",
    "private_key": "-----BEGIN RSA PRIVATE KEY-----",
    "jwt": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop",
    "bearer_header": "Bearer abcdefghijklmnopqrstuvwxyz",
    "basic_auth_header": "Basic YWxhZGRpbjpvcGVuc2VzYW1l0000",
    "url_credentials": "https://nick:hunter2@example.internal/path",
    "discord_webhook": "https://discord.com/api/webhooks/123456/abcdefghijklmnopqrstuvwx",
}


class FieldNameTests(unittest.TestCase):
    def test_a_credential_field_is_recognised_in_every_spelling(self):
        for name in ("api_key", "apiKey", "X-Api-Key", "API KEY", "refresh_token", "sessionToken"):
            self.assertTrue(field_is_sensitive(name), name)

    def test_a_field_that_merely_contains_a_credential_word_is_not(self):
        # `tokenizer_version` is not a token. Substring matching would strike it,
        # which is how over-redaction starts hiding the record's useful half.
        for name in ("tokenizer_version", "goal", "resource", "planHash", "user"):
            self.assertFalse(field_is_sensitive(name), name)

    def test_the_routers_token_counts_survive(self):
        # Phase 2's inference records carry TokenCounts under `tokens`. Blanking
        # it would hide the cost telemetry the router exists to produce.
        for name in BENIGN_FIELD_NAMES:
            self.assertFalse(field_is_sensitive(name), name)

    def test_prompt_fields_are_recognised(self):
        for name in ("prompt", "system_prompt", "transcript", "messages", "conversation"):
            self.assertTrue(field_is_prompt(name), name)
        self.assertFalse(field_is_prompt("goal"))

    def test_normalization_splits_camel_case_and_punctuation(self):
        self.assertEqual(normalize_field("X-Api-Key"), "x_api_key")
        self.assertEqual(normalize_field("sessionToken"), "session_token")


class ValueShapeTests(unittest.TestCase):
    def test_every_shape_is_struck_and_none_survives_verbatim(self):
        for rule, sample in SAMPLES.items():
            result = redact({"note": f"prefix {sample} suffix"})
            self.assertIn(rule, result.rules, rule)
            self.assertNotIn(sample, json.dumps(result.value), rule)

    def test_every_declared_shape_has_a_sample(self):
        # A pattern nobody tests is a pattern that can stop matching silently.
        self.assertEqual(set(CREDENTIAL_SHAPES), set(SAMPLES))

    def test_surrounding_text_is_kept(self):
        text, struck = redact_text("the key is sk-abcdefghijklmnopqrstuvwxyz012345 ok")
        self.assertTrue(text.startswith("the key is "))
        self.assertTrue(text.endswith(" ok"))
        self.assertEqual([item.rule for item in struck], ["openai_style_key"])


class StructureTests(unittest.TestCase):
    def test_a_sensitive_field_takes_its_whole_subtree(self):
        result = redact({"credentials": {"nested": {"deep": "value"}}})
        self.assertEqual(result.value["credentials"], "[redacted:sensitive_field]")

    def test_lists_and_nesting_are_walked(self):
        result = redact({"steps": [{"password": "x"}, {"note": SAMPLES["private_key"]}]})
        self.assertEqual(result.value["steps"][0]["password"], "[redacted:sensitive_field]")
        self.assertIn("private_key", result.rules)

    def test_the_report_records_paths_and_rules_but_never_content(self):
        result = redact({"headers": {"Authorization": "Bearer abcdefghijklmnopqrst"}})
        self.assertEqual(
            result.redactions,
            (Redaction(path="headers.Authorization", rule="sensitive_field"),),
        )
        self.assertNotIn("abcdefghijklmnopqrst", repr(result.redactions))

    def test_absurd_nesting_is_bounded_rather_than_walked(self):
        value: object = "bottom"
        for _ in range(MAX_DEPTH + 3):
            value = {"deeper": value}
        result = redact(value)
        self.assertIn("too_deeply_nested", result.rules)

    def test_long_values_are_truncated(self):
        result = redact({"note": "x" * (MAX_STRING + 100)})
        self.assertIn("truncated", result.rules)
        self.assertLessEqual(len(result.value["note"]), MAX_STRING)

    def test_a_non_json_value_raises_rather_than_being_repred(self):
        # repr() is how an object's private attributes end up in a log.
        class Holder:
            def __init__(self):
                self.token = SAMPLES["openai_style_key"]

        with self.assertRaises(ValueError):
            redact({"holder": Holder()})

    def test_numbers_and_booleans_pass_through(self):
        result = redact({"count": 3, "ok": True, "ratio": 1.5, "missing": None})
        self.assertEqual(result.value, {"count": 3, "ok": True, "ratio": 1.5, "missing": None})
        self.assertTrue(result.clean)


class PromptTests(unittest.TestCase):
    def test_prompts_are_dropped_by_default(self):
        result = redact({"prompt": "the entire conversation"})
        self.assertEqual(result.value["prompt"], "[omitted:prompt]")
        self.assertIn("prompt_dropped", result.rules)

    def test_secure_debug_keeps_the_prompt_but_not_a_credential_inside_it(self):
        # The manifest's exemption is for the prompt. It is not an exemption for
        # whatever somebody pasted into the prompt.
        result = redact(
            {"prompt": f"my key is {SAMPLES['openai_style_key']}"}, keep_prompts=True
        )
        self.assertIn("my key is ", result.value["prompt"])
        self.assertNotIn(SAMPLES["openai_style_key"], result.value["prompt"])
        self.assertIn("openai_style_key", result.rules)


class SummaryTests(unittest.TestCase):
    def test_summary_is_sorted_and_deduplicated(self):
        redactions = (
            Redaction("a", "sensitive_field"),
            Redaction("b", "openai_style_key"),
            Redaction("c", "sensitive_field"),
        )
        self.assertEqual(redacted_summary(redactions), ("openai_style_key", "sensitive_field"))


if __name__ == "__main__":
    unittest.main()
