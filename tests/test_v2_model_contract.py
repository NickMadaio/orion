"""Phase 2 slice 1: the role-to-model contract.

The contract is the single place a model name is allowed to live. These tests
exist to keep it that: strict about shape, loud about secrets, and honest about
a role that has not been assigned yet.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from orion.core.models.contract import (
    _CREDENTIAL_SOURCES,
    ROLES,
    SCHEMA_VERSION,
    assert_carries_no_secret,
    decode_contract,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = REPO_ROOT / "orion" / "core" / "schemas" / "model-roles.schema.json"


def role(primary, fallbacks=(), **overrides):
    binding = {
        "primary": primary,
        "fallbacks": list(fallbacks),
        "timeout_seconds": 60,
        "max_retries": 1,
    }
    binding.update(overrides)
    return binding


def contract(**overrides):
    document = {
        "schema_version": SCHEMA_VERSION,
        "roles": {
            "reasoning": role(
                "anthropic/claude-haiku-4-5-20251001",
                ["ollama/qwen3.6:27b"],
                rates={"input_per_mtok": 1.0, "output_per_mtok": 5.0},
            ),
            "fast": role("ollama/llama3.2:3b"),
            "vision": role(None),
            "local": role("ollama/gpt-oss:20b"),
            "embedding": role("ollama/nomic-embed-text"),
            "stt": role("deepgram/nova-3"),
            "tts": role("local/mlx-audio", ["elevenlabs/eleven_turbo_v2_5"]),
            "coder": role("ollama/gpt-oss:20b"),
        },
        "providers": {
            "anthropic": {"credential": {"source": "keychain", "ref": "ORION OpenClaw Anthropic"}},
            "ollama": {
                "endpoint": "http://127.0.0.1:11434",
                "credential": {"source": "none"},
            },
            "deepgram": {"credential": {"source": "keychain", "ref": "ORION Deepgram"}},
            "elevenlabs": {"credential": {"source": "keychain", "ref": "ORION ElevenLabs"}},
            "local": {"credential": {"source": "none"}},
        },
    }
    document.update(overrides)
    return document


class ContractDecodingTests(unittest.TestCase):
    def test_decodes_every_manifest_role_and_orions_two_additions(self):
        decoded = decode_contract(contract())
        self.assertEqual(tuple(decoded.roles), ROLES)
        # The manifest's six, minus `fallback` which is a property not a role,
        # plus the two inference surfaces the manifest's list omitted.
        for name in ("reasoning", "fast", "vision", "local", "embedding"):
            self.assertIn(name, decoded.roles)
        for name in ("stt", "tts"):
            self.assertIn(name, decoded.roles)
        self.assertNotIn("fallback", decoded.roles)

    def test_a_chain_is_primary_then_fallbacks_in_order(self):
        decoded = decode_contract(contract())
        self.assertEqual(
            [str(ref) for ref in decoded.role("reasoning").chain()],
            ["anthropic/claude-haiku-4-5-20251001", "ollama/qwen3.6:27b"],
        )
        self.assertEqual(str(decoded.resolve("fast")), "ollama/llama3.2:3b")

    def test_an_unassigned_role_refuses_to_resolve_rather_than_substituting(self):
        # A caller that asked for vision and quietly got a text model would
        # produce confident nonsense. An error a human can read is better.
        decoded = decode_contract(contract())
        self.assertFalse(decoded.role("vision").assigned)
        with self.assertRaisesRegex(ValueError, "declared but unassigned"):
            decoded.resolve("vision")

    def test_rejects_unknown_fields_missing_roles_and_bad_versions(self):
        for mutate, expected in (
            (lambda d: d.__setitem__("extra", 1), "unknown"),
            (lambda d: d["roles"].pop("vision"), "missing"),
            (lambda d: d["roles"]["fast"].__setitem__("nope", 1), "unknown"),
            (lambda d: d["roles"].__setitem__("fallback", role("ollama/x")), "unknown"),
            (lambda d: d.__setitem__("schema_version", 2), "unsupported schema version"),
            (lambda d: d.__setitem__("schema_version", True), "unsupported schema version"),
        ):
            document = contract()
            mutate(document)
            with self.assertRaises(ValueError) as caught:
                decode_contract(document)
            self.assertIn(expected, str(caught.exception))

    def test_rejects_malformed_and_unroutable_model_references(self):
        for primary, expected in (
            ("claude-haiku-4-5", "provider/model"),
            ("Anthropic/claude", "provider/model"),
            ("mystery/model-x", "undeclared provider"),
            (42, "provider/model"),
        ):
            document = contract()
            document["roles"]["fast"]["primary"] = primary
            with self.assertRaises(ValueError) as caught:
                decode_contract(document)
            self.assertIn(expected, str(caught.exception))

    def test_rejects_a_chain_that_retries_the_same_model(self):
        # Looks like resilience, is not: whatever failed the first time is
        # still true the second time.
        document = contract()
        document["roles"]["fast"]["fallbacks"] = ["ollama/llama3.2:3b"]
        with self.assertRaisesRegex(ValueError, "same model twice"):
            decode_contract(document)

    def test_rejects_fallbacks_with_no_primary_to_fall_back_from(self):
        document = contract()
        document["roles"]["vision"]["fallbacks"] = ["ollama/llama3.2:3b"]
        with self.assertRaisesRegex(ValueError, "no primary"):
            decode_contract(document)

    def test_bounds_timeouts_retries_and_rates(self):
        for path, value, expected in (
            (("roles", "fast", "timeout_seconds"), 0, "between"),
            (("roles", "fast", "timeout_seconds"), 3601, "between"),
            (("roles", "fast", "timeout_seconds"), 1.5, "must be an integer"),
            (("roles", "fast", "max_retries"), -1, "between"),
            (("roles", "fast", "max_retries"), True, "must be an integer"),
        ):
            document = contract()
            target = document
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            with self.assertRaises(ValueError) as caught:
                decode_contract(document)
            self.assertIn(expected, str(caught.exception))

        for value, expected in ((-0.1, "must not be negative"), (float("inf"), "finite"), ("1", "must be a number")):
            document = contract()
            document["roles"]["reasoning"]["rates"]["input_per_mtok"] = value
            with self.assertRaises(ValueError) as caught:
                decode_contract(document)
            self.assertIn(expected, str(caught.exception))

    def test_a_keychain_provider_must_name_its_reference_and_none_must_not(self):
        document = contract()
        document["providers"]["deepgram"]["credential"].pop("ref")
        with self.assertRaisesRegex(ValueError, "ref is required"):
            decode_contract(document)

        document = contract()
        document["providers"]["ollama"]["credential"]["ref"] = "something"
        with self.assertRaisesRegex(ValueError, "must be absent"):
            decode_contract(document)


class PlaintextCredentialTests(unittest.TestCase):
    """`env_plaintext` records an uncomfortable truth so it can be closed.

    Deepgram and ElevenLabs keys sit readable in .env today. The contract could
    have claimed a Keychain reference that does not exist; instead it says what
    is true and makes the gap queryable.
    """

    def test_a_plaintext_provider_must_still_name_its_variable(self):
        document = contract()
        document["providers"]["deepgram"]["credential"] = {"source": "env_plaintext"}
        with self.assertRaisesRegex(ValueError, "ref is required when source is env_plaintext"):
            decode_contract(document)

    def test_plaintext_providers_are_listed_so_the_gap_can_be_asserted_shut(self):
        document = contract()
        document["providers"]["deepgram"]["credential"] = {
            "source": "env_plaintext",
            "ref": "DEEPGRAM_API_KEY",
        }
        document["providers"]["elevenlabs"]["credential"] = {
            "source": "env_plaintext",
            "ref": "ELEVENLABS_API_KEY",
        }
        decoded = decode_contract(document)
        self.assertEqual(decoded.plaintext_providers(), ("deepgram", "elevenlabs"))

    def test_a_fully_migrated_contract_reports_no_plaintext(self):
        # This is Phase 2 slice 5's exit criterion, expressed as an assertion
        # rather than a sentence in a plan.
        self.assertEqual(decode_contract(contract()).plaintext_providers(), ())

    def test_the_variable_name_is_not_mistaken_for_the_secret_itself(self):
        document = contract()
        document["providers"]["deepgram"]["credential"] = {
            "source": "env_plaintext",
            "ref": "DEEPGRAM_API_KEY",
        }
        decoded = decode_contract(document)
        self.assertEqual(decoded.providers["deepgram"].credential_ref, "DEEPGRAM_API_KEY")


class SecretContainmentTests(unittest.TestCase):
    """The contract records where a credential lives, never the credential."""

    def test_rejects_a_field_named_like_a_secret(self):
        for key in ("api_key", "apiKey", "SECRET", "token", "password"):
            document = contract()
            document["providers"]["anthropic"][key] = "placeholder"
            with self.assertRaises(ValueError) as caught:
                decode_contract(document)
            self.assertIn("secret", str(caught.exception).lower())

    def test_rejects_a_secret_shaped_value_anywhere_in_the_document(self):
        # The failure mode is human: someone pastes a real key to test
        # something and never takes it out.
        for planted in (
            "sk-ant-api03-" + "A" * 48,
            "Bearer abc.def.ghi",
            "x" * 44,
        ):
            with self.assertRaises(ValueError) as caught:
                assert_carries_no_secret({"providers": {"p": {"ref": planted}}})
            self.assertIn("secret-shaped", str(caught.exception))

    def test_accepts_the_real_contract_shape_unchanged(self):
        assert_carries_no_secret(contract())


class SeedContractTests(unittest.TestCase):
    """The seed contract is the one shipped in the repo, derived from what is
    actually running. These assertions are environment-independent; proving it
    still agrees with the live machine is `scripts/orion_v2_model_contract_check.py`,
    which reads config and source and exits non-zero on drift."""

    def setUp(self):
        self.seed = json.loads(
            (REPO_ROOT / "planning" / "v2" / "model-roles.seed.json").read_text(
                encoding="utf-8"
            )
        )
        self.contract = decode_contract(self.seed)

    def test_the_shipped_contract_decodes_and_covers_every_role(self):
        self.assertEqual(tuple(self.contract.roles), ROLES)

    def test_it_names_every_surface_that_performs_inference(self):
        # The five surfaces found on 2026-08-20. If a sixth appears and this
        # contract does not name it, the phase's central claim is false.
        chains = {
            str(ref)
            for binding in self.contract.roles.values()
            for ref in binding.chain()
        }
        for expected in (
            "anthropic/claude-haiku-4-5-20251001",   # OpenClaw agent
            "ollama/gpt-oss:20b",                    # LocalModel.swift
            "deepgram/nova-3",                       # DeepgramSpeech.swift
            "ollama/nomic-embed-text",               # memory search
        ):
            self.assertIn(expected, chains)
        self.assertTrue(any(ref.startswith("mlx/") for ref in chains))
        self.assertTrue(any(ref.startswith("elevenlabs/") for ref in chains))

    def test_no_provider_declares_a_plaintext_credential(self):
        # The manifest's "never give models credentials", as an assertion.
        # ElevenLabs and Deepgram both migrated to the login Keychain on
        # 2026-08-23; the Swift app grew a Keychain branch in the same pass so
        # Deepgram could follow.
        self.assertEqual(self.contract.plaintext_providers(), ())
        for name in ("anthropic", "deepgram", "elevenlabs"):
            self.assertEqual(
                self.contract.providers[name].credential_source, "keychain", name
            )

    def test_no_credential_reference_is_itself_a_credential(self):
        # A ref names a Keychain item. If one ever started holding the value,
        # every reader of this file would have the secret.
        for binding in self.contract.providers.values():
            if binding.credential_ref:
                self.assertLess(len(binding.credential_ref), 64)
                self.assertNotIn("sk-", binding.credential_ref)

    def test_vision_is_declared_and_honestly_unassigned(self):
        self.assertFalse(self.contract.role("vision").assigned)

    def test_local_roles_are_priced_at_zero_rather_than_left_unpriced(self):
        # Free and unpriceable are different claims. Ollama really is free.
        for name in ("fast", "local", "embedding"):
            rates = self.contract.role(name).rates
            self.assertIsNotNone(rates, f"{name} should be priced, not unpriced")
            self.assertEqual(rates.input_per_mtok, 0.0)

    def test_the_cloud_reasoning_role_is_priced(self):
        # The one role that actually costs money must be able to say so; this is
        # what makes OpenClaw's all-zero cost field fixable.
        self.assertIsNotNone(self.contract.role("reasoning").rates)
        self.assertGreater(self.contract.role("reasoning").rates.output_per_mtok, 0)

    def test_the_seed_carries_no_secret(self):
        assert_carries_no_secret(self.seed)


class SchemaParityTests(unittest.TestCase):
    """The JSON Schema is the language-neutral contract; Python is a reference
    implementation of it. If they drift, TypeScript and Swift consumers inherit
    a validator that disagrees with the document they were handed."""

    def setUp(self):
        self.schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))

    def test_schema_declares_exactly_the_python_role_set(self):
        roles = self.schema["properties"]["roles"]
        self.assertEqual(tuple(roles["required"]), ROLES)
        self.assertEqual(tuple(roles["properties"]), ROLES)
        self.assertFalse(roles["additionalProperties"])

    def test_schema_pins_the_same_version_and_closes_the_document(self):
        self.assertEqual(self.schema["properties"]["schema_version"]["const"], SCHEMA_VERSION)
        self.assertFalse(self.schema["additionalProperties"])
        self.assertEqual(
            sorted(self.schema["required"]), ["providers", "roles", "schema_version"]
        )

    def test_schema_role_fields_match_the_python_decoder(self):
        role_def = self.schema["$defs"]["role"]
        self.assertEqual(
            sorted(role_def["required"]),
            ["fallbacks", "max_retries", "primary", "timeout_seconds"],
        )
        self.assertEqual(
            sorted(role_def["properties"]),
            ["fallbacks", "max_retries", "note", "primary", "rates", "timeout_seconds"],
        )
        self.assertFalse(role_def["additionalProperties"])

    def test_schema_credential_vocabulary_matches(self):
        credential = self.schema["$defs"]["provider"]["properties"]["credential"]
        # Assert against the validator's own vocabulary, not a hand-copied
        # list -- a second copy is a second thing to forget to update.
        self.assertEqual(
            sorted(credential["properties"]["source"]["enum"]),
            sorted(_CREDENTIAL_SOURCES),
        )
        self.assertFalse(credential["additionalProperties"])


if __name__ == "__main__":
    unittest.main()
