"""Phase 4: the capability registry.

The live executor keeps its flat action names -- renaming 78 of them would break
working prompts, a thousand ledger rows, and the approval hashes that gate a
re-call. So the registry maps each onto the structured contract the manifest
asks for, and these tests defend that mapping.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from orion.core.context.domains import Domain
from orion.core.tools.registry import (
    MUTATING_EFFECTS,
    SCHEMA_VERSION,
    Capability,
    decode_registry,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = REPO_ROOT / "planning" / "v2" / "capability-registry.json"
SCHEMA_PATH = REPO_ROOT / "orion" / "core" / "schemas" / "capability.schema.json"


def entry(**overrides):
    base = {
        "action": "system_status",
        "capability": "device.status.read",
        "domain": "computer",
        "risk": "low",
        "approval_required": False,
        "reversible": True,
        "side_effects": ["reads_device_state"],
        "resource_scope": "ambient_info",
        "platforms": ["macos"],
        "arguments": {"type": "object", "additionalProperties": False,
                      "required": [], "properties": {}},
        "returns": {"type": "object"},
        "audit": "task_ledger",
    }
    base.update(overrides)
    return base


def registry(*entries):
    return {"schema_version": SCHEMA_VERSION,
            "capabilities": list(entries) or [entry()]}


class DecodingTests(unittest.TestCase):
    def test_decodes_a_minimal_registry(self):
        decoded = decode_registry(registry())
        self.assertEqual(len(decoded.capabilities), 1)
        self.assertIsInstance(decoded.capabilities["system_status"], Capability)

    def test_capability_names_must_be_dotted(self):
        for bad in ("system_status", "Device.Status", "device", "a.b.c.d.e", ""):
            with self.assertRaises(ValueError):
                decode_registry(registry(entry(capability=bad)))

    def test_an_action_cannot_appear_twice(self):
        with self.assertRaisesRegex(ValueError, "appears twice"):
            decode_registry(registry(entry(), entry(capability="device.status.other")))

    def test_two_actions_cannot_claim_one_capability_name(self):
        # This is not hypothetical: desktop_list and home_list both reduced to
        # files.list under the first naming rule, and the collision would have
        # meant two different capabilities answering to one name.
        with self.assertRaisesRegex(ValueError, "claimed by both"):
            decode_registry(registry(entry(), entry(action="desktop_list")))

    def test_no_capability_may_claim_the_credentials_domain(self):
        with self.assertRaisesRegex(ValueError, "credentials"):
            decode_registry(registry(entry(domain="credentials")))

    def test_argument_schemas_must_reject_unknown_fields(self):
        # The manifest's "reject unknown fields by default", enforced where a
        # capability declares its arguments. A schema permitting extra keys is
        # the exact hole that forced the Phase 2 bridge to fail open.
        for arguments in (
            {"type": "object", "additionalProperties": True},
            {"type": "object"},
            {"type": "string", "additionalProperties": False},
        ):
            with self.assertRaises(ValueError):
                decode_registry(registry(entry(arguments=arguments)))

    def test_a_mutating_action_must_record_an_audit(self):
        # A destructive action that records nothing cannot be investigated
        # afterwards, which is what the ledger is for.
        with self.assertRaisesRegex(ValueError, "records no audit"):
            decode_registry(registry(entry(
                action="file_delete", capability="files.delete",
                domain="files", side_effects=["deletes_files"], audit="none")))

    def test_critical_risk_without_approval_is_refused(self):
        with self.assertRaisesRegex(ValueError, "critical"):
            decode_registry(registry(entry(risk="critical", approval_required=False)))

    def test_side_effects_must_come_from_the_closed_vocabulary(self):
        with self.assertRaises(ValueError):
            decode_registry(registry(entry(side_effects=["does_something"])))
        with self.assertRaisesRegex(ValueError, "repeats itself"):
            decode_registry(registry(entry(side_effects=["reads_files", "reads_files"])))

    def test_unknown_and_missing_fields_are_refused(self):
        with self.assertRaisesRegex(ValueError, "unknown"):
            decode_registry(registry(entry(extra=1)))
        incomplete = entry()
        del incomplete["platforms"]
        with self.assertRaisesRegex(ValueError, "missing"):
            decode_registry(registry(incomplete))


class ShippedRegistryTests(unittest.TestCase):
    """The registry actually in the repo, generated from the live catalog."""

    def setUp(self):
        self.raw = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
        self.registry = decode_registry(self.raw)

    def test_it_covers_a_substantial_catalog(self):
        self.assertGreaterEqual(len(self.registry.capabilities), 78)

    def test_every_capability_declares_all_nine_manifest_fields(self):
        for action, capability in self.registry.capabilities.items():
            self.assertTrue(capability.capability, action)
            self.assertTrue(capability.arguments, action)
            self.assertTrue(capability.returns, action)
            self.assertTrue(capability.side_effects is not None, action)
            self.assertIn(capability.risk, ("low", "medium", "high", "critical"), action)
            self.assertTrue(capability.resource_scope, action)
            self.assertIsInstance(capability.approval_required, bool)
            self.assertTrue(capability.audit, action)
            self.assertTrue(capability.platforms, action)

    def test_every_capability_names_a_context_domain(self):
        # This is what Phase 3's firewall was waiting on. Until a capability
        # says it belongs to `health` or `files`, the isolation matrix can be
        # defined but never applied to a real request.
        for action, capability in self.registry.capabilities.items():
            self.assertIsInstance(capability.domain, Domain, action)
            self.assertIsNot(capability.domain, Domain.CREDENTIALS, action)

    def test_domain_lookup_answers_for_a_live_action(self):
        self.assertIs(self.registry.domain_of("system_status"), Domain.COMPUTER)
        self.assertIs(self.registry.domain_of("desktop_list"), Domain.FILES)
        with self.assertRaisesRegex(ValueError, "unknown action"):
            self.registry.domain_of("no_such_action")

    def test_health_actions_are_in_the_health_domain(self):
        # The pairing has to be sane, not merely present. A health action
        # labelled `files` would let the firewall hand health data to a file task.
        health = {c.action for c in self.registry.in_domain(Domain.HEALTH)}
        self.assertTrue(any(a.startswith("supplement") for a in health))
        self.assertTrue(any(a.startswith("workout") for a in health))
        for capability in self.registry.capabilities.values():
            if capability.action.startswith(("supplement", "workout")):
                self.assertIs(capability.domain, Domain.HEALTH, capability.action)

    def test_reconfiguring_orion_is_a_security_capability(self):
        # Anything that can rewrite Orion's own config or permissions is a
        # security capability whatever else it looks like.
        for capability in self.registry.capabilities.values():
            if capability.action.startswith(("self_config", "self_plugin", "self_script")):
                self.assertIs(capability.domain, Domain.SECURITY, capability.action)

    def test_no_capability_permits_unknown_arguments(self):
        for action, capability in self.registry.capabilities.items():
            self.assertIs(capability.arguments["additionalProperties"], False, action)

    def test_every_mutating_capability_is_audited(self):
        for capability in self.registry.capabilities.values():
            if capability.mutates:
                self.assertNotEqual(capability.audit, "none", capability.action)

    def test_no_capability_looks_like_arbitrary_command_execution(self):
        for action in self.registry.capabilities:
            for token in ("exec", "shell", "eval", "bash", "run_command"):
                self.assertNotIn(token, action.lower())

    def test_mutating_and_read_only_are_both_represented(self):
        # A registry where everything mutates, or nothing does, means the effect
        # mapping was not really applied.
        mutating = [c for c in self.registry.capabilities.values() if c.mutates]
        read_only = [c for c in self.registry.capabilities.values() if c.reads_only]
        self.assertGreater(len(mutating), 5)
        self.assertGreater(len(read_only), 5)
        for capability in read_only:
            self.assertFalse(set(capability.side_effects) & MUTATING_EFFECTS)


class SchemaParityTests(unittest.TestCase):
    def setUp(self):
        self.schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        self.definition = self.schema["$defs"]["capability"]

    def test_the_schema_requires_the_same_fields_the_decoder_does(self):
        self.assertEqual(
            sorted(self.definition["required"]),
            sorted(["action", "capability", "domain", "risk", "approval_required",
                    "reversible", "side_effects", "resource_scope", "platforms",
                    "arguments", "returns", "audit"]),
        )
        self.assertFalse(self.definition["additionalProperties"])

    def test_the_schema_excludes_credentials_from_the_domain_vocabulary(self):
        domains = self.definition["properties"]["domain"]["enum"]
        self.assertNotIn("credentials", domains)
        for domain in Domain:
            if domain is Domain.CREDENTIALS:
                continue
            self.assertIn(domain.value, domains)

    def test_the_schema_pins_arguments_closed(self):
        arguments = self.definition["properties"]["arguments"]
        self.assertEqual(arguments["properties"]["additionalProperties"]["const"], False)
        self.assertEqual(arguments["properties"]["type"]["const"], "object")


if __name__ == "__main__":
    unittest.main()
