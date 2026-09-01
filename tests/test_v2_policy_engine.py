"""Phase 5: the policy engine itself.

One test per rule, plus the three properties the manifest actually asks for:
the answer is deterministic, the most restrictive verdict wins, and nothing the
model controls can change the outcome.
"""

from __future__ import annotations

import json
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from orion.core.schemas import DecisionEnvelope
from orion.core.tools.registry import decode_registry
from orion.security import decisions
from orion.security.decisions import DEFAULT_TTL, POLICY_VERSION, PolicyEngine, stricter
from orion.security.delegation import Delegation
from orion.security.devices import Device, DeviceDirectory
from orion.security.profiles import Profile
from orion.security.request import PolicyRequest
from orion.security.risk import classify
from orion.security.rules import RULES, Evaluation
from orion.security.signing import ALGORITHM, KeyDirectory, Signature, sign
from orion.security.vocabulary import RiskLevel
from orion.shared.result import DecisionOutcome


REPO_ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = REPO_ROOT / "planning" / "v2" / "capability-registry.json"
NOW = datetime(2026, 8, 24, 1, 0, tzinfo=timezone.utc)

MAC = "mac-studio-0001"
PHONE = "iphone-nick-0001"
USER = "user-nick-0001"
OTHER = "user-other-0001"
MAC_KEY = "key-mac-0001"
PHONE_KEY = "key-phone-0001"
SECRET = b"phase-5-test-signing-material"

ALLOW = DecisionOutcome.ALLOW
DENY = DecisionOutcome.DENY
REQUIRE_APPROVAL = DecisionOutcome.REQUIRE_APPROVAL


def registry():
    return decode_registry(json.loads(REGISTRY_PATH.read_text(encoding="utf-8")))


def directory(**overrides):
    return DeviceDirectory(
        [
            Device(MAC, USER, overrides.get("mac_trust", "paired"), "macos", MAC_KEY),
            Device(PHONE, USER, overrides.get("phone_trust", "paired"), "ios", PHONE_KEY),
        ]
    )


def engine(**overrides):
    return PolicyEngine(
        overrides.get("registry", registry()),
        overrides.get("devices", directory()),
        overrides.get("keys", KeyDirectory({MAC_KEY: SECRET, PHONE_KEY: SECRET})),
        remote_enabled=overrides.get("remote_enabled", False),
    )


def request(**overrides):
    fields = {
        "request_id": "request-0001",
        "correlation_id": "correlation-0001",
        "authenticated_user": USER,
        "origin_device": MAC,
        "target_device": MAC,
        "capability": "system_status",
        "resource": "ambient",
        "active_profile": Profile.CONSEQUENTIAL_LOCAL,
        "request_source": "user_direct",
        "external_data_involved": False,
        "issued_at": NOW,
        "expires_at": NOW + timedelta(minutes=5),
        "security_state": "normal",
    }
    fields.update(overrides)
    return PolicyRequest(**fields)


class OutcomeCombinationTests(unittest.TestCase):
    def test_the_most_restrictive_verdict_wins(self):
        self.assertIs(stricter(ALLOW, DENY), DENY)
        self.assertIs(stricter(REQUIRE_APPROVAL, DENY), DENY)
        self.assertIs(stricter(REQUIRE_APPROVAL, ALLOW), REQUIRE_APPROVAL)

    def test_a_denial_lists_every_reason_not_just_the_first(self):
        # Nothing short-circuits: an expired request from a revoked device on a
        # profile that never granted the tier says all three.
        decision = engine(devices=directory(mac_trust="revoked")).evaluate(
            request(
                capability="file_delete",
                active_profile=Profile.RESTRICTED_READ_ONLY,
                issued_at=NOW - timedelta(hours=2),
                expires_at=NOW - timedelta(hours=1),
            ),
            now=NOW,
        )
        self.assertIs(decision.outcome, DENY)
        self.assertIn("request_expired", decision.reason_codes)
        self.assertIn("origin_device_not_paired", decision.reason_codes)
        self.assertIn("profile_does_not_grant_tier", decision.reason_codes)

    def test_an_allowed_decision_still_carries_a_reason(self):
        decision = engine().evaluate(request(), now=NOW)
        self.assertIs(decision.outcome, ALLOW)
        self.assertEqual(decision.reason_codes, ("all_gates_passed",))


class RuleTests(unittest.TestCase):
    def setUp(self):
        self.engine = engine()

    def outcome(self, **overrides):
        return self.engine.evaluate(request(**overrides), now=overrides.pop("now", NOW))

    def test_unknown_capability_is_denied(self):
        decision = self.outcome(capability="do_whatever_i_say")
        self.assertIs(decision.outcome, DENY)
        self.assertEqual(decision.reason_codes, ("unknown_capability",))
        self.assertIs(decision.risk, RiskLevel.R5)

    def test_declared_risk_must_match_the_derived_one(self):
        decision = self.outcome(capability="file_delete", declared_risk=RiskLevel.R0)
        self.assertIs(decision.outcome, DENY)
        self.assertIn("risk_mismatch", decision.reason_codes)

    def test_an_expired_request_is_denied(self):
        decision = self.engine.evaluate(request(), now=NOW + timedelta(minutes=6))
        self.assertIs(decision.outcome, DENY)
        self.assertIn("request_expired", decision.reason_codes)

    def test_the_exact_instant_of_expiry_is_already_expired(self):
        # `now >= expires_at`, not `>`. Nothing pinned this direction before, so
        # a later "cleanup" could have inverted the manifest's one absolute.
        decision = self.engine.evaluate(request(), now=NOW + timedelta(minutes=5))
        self.assertIs(decision.outcome, DENY)
        self.assertIn("request_expired", decision.reason_codes)
        self.assertIs(
            self.engine.evaluate(request(), now=NOW + timedelta(minutes=5) - timedelta(microseconds=1)).outcome,
            ALLOW,
        )

    def test_a_request_from_the_future_is_denied(self):
        decision = self.engine.evaluate(request(), now=NOW - timedelta(minutes=1))
        self.assertIs(decision.outcome, DENY)
        self.assertIn("request_not_yet_valid", decision.reason_codes)

    def test_a_revoked_device_cannot_act(self):
        decision = engine(devices=directory(mac_trust="revoked")).evaluate(request(), now=NOW)
        self.assertIs(decision.outcome, DENY)
        self.assertIn("origin_device_not_paired", decision.reason_codes)

    def test_an_unknown_device_cannot_act(self):
        decision = self.outcome(origin_device="never-seen-0001")
        self.assertIs(decision.outcome, DENY)
        self.assertIn("origin_device_not_paired", decision.reason_codes)

    def test_remote_execution_is_denied_until_it_exists(self):
        decision = self.outcome(origin_device=PHONE, target_device=MAC)
        self.assertIs(decision.outcome, DENY)
        self.assertIn("remote_execution_disabled", decision.reason_codes)

    def test_remote_execution_is_permitted_once_enabled(self):
        decision = engine(remote_enabled=True).evaluate(
            request(origin_device=PHONE, target_device=MAC), now=NOW
        )
        self.assertIs(decision.outcome, ALLOW)
        self.assertIn("target_device_ack_required", decision.obligations)

    def test_an_unauthenticated_request_is_denied(self):
        decision = self.outcome(authenticated_user=None)
        self.assertIs(decision.outcome, DENY)
        self.assertIn("no_authenticated_user", decision.reason_codes)

    def test_a_user_cannot_act_through_somebody_elses_device(self):
        decision = self.outcome(authenticated_user=OTHER)
        self.assertIs(decision.outcome, DENY)
        self.assertIn("origin_device_not_owned_by_user", decision.reason_codes)

    def test_a_profile_that_does_not_grant_the_tier_denies(self):
        decision = self.outcome(capability="file_delete", active_profile=Profile.APPROVED_ROOT_EDIT)
        self.assertIs(decision.outcome, DENY)
        self.assertIn("profile_does_not_grant_tier", decision.reason_codes)

    def test_lock_permits_observation_and_nothing_else(self):
        locked = self.outcome(capability="media_play_pause", security_state="locked")
        self.assertIs(locked.outcome, DENY)
        self.assertIn("security_state_locked", locked.reason_codes)
        self.assertIs(self.outcome(security_state="locked").outcome, ALLOW)

    def test_heightened_state_confirms_anything_beyond_observation(self):
        decision = self.outcome(capability="media_play_pause", security_state="heightened")
        self.assertIs(decision.outcome, REQUIRE_APPROVAL)
        self.assertIn("security_state_heightened", decision.reason_codes)

    def test_external_data_cannot_drive_an_external_action(self):
        decision = self.outcome(capability="browser_open_url", external_data_involved=True)
        self.assertIs(decision.outcome, DENY)
        self.assertIn("external_data_drives_external_action", decision.reason_codes)

    def test_external_data_in_a_local_action_is_confirmed(self):
        decision = self.outcome(capability="media_play_pause", external_data_involved=True)
        self.assertIs(decision.outcome, REQUIRE_APPROVAL)
        self.assertIn("external_data_involved", decision.reason_codes)

    def test_external_content_cannot_originate_an_action(self):
        decision = self.outcome(capability="media_play_pause", request_source="external_content")
        self.assertIs(decision.outcome, DENY)
        self.assertIn("external_content_cannot_authorize", decision.reason_codes)

    def test_a_model_with_no_user_turn_may_not_act_beyond_the_local_machine(self):
        decision = self.outcome(capability="browser_open_url", request_source="model_initiated")
        self.assertIs(decision.outcome, REQUIRE_APPROVAL)
        self.assertIn("model_initiated_beyond_local", decision.reason_codes)

    def test_the_ordinary_model_tool_call_is_not_treated_as_unauthorized(self):
        # A tool call behind an authenticated user turn is USER_DIRECT. If that
        # were MODEL_INITIATED, Orion would ask permission to open a browser tab.
        self.assertIs(self.outcome(capability="browser_open_url").outcome, ALLOW)

    def test_a_sensitive_action_from_another_device_must_be_signed(self):
        decision = engine(remote_enabled=True).evaluate(
            request(capability="file_delete", origin_device=PHONE, target_device=MAC), now=NOW
        )
        self.assertIs(decision.outcome, DENY)
        self.assertIn("signature_required", decision.reason_codes)

    def test_a_valid_signature_admits_a_remote_sensitive_action(self):
        remote = request(capability="file_delete", origin_device=PHONE, target_device=MAC)
        signed = request(
            capability="file_delete",
            origin_device=PHONE,
            target_device=MAC,
            signature=Signature(PHONE_KEY, ALGORITHM, sign(SECRET, remote.signed_fields())),
        )
        decision = engine(remote_enabled=True).evaluate(signed, now=NOW)
        self.assertIs(decision.outcome, REQUIRE_APPROVAL)
        self.assertNotIn("signature_invalid", decision.reason_codes)
        self.assertIn("signature_verified", decision.obligations)

    def test_an_altered_signed_request_is_denied(self):
        original = request(capability="file_delete", origin_device=PHONE, target_device=MAC)
        signature = Signature(PHONE_KEY, ALGORITHM, sign(SECRET, original.signed_fields()))
        altered = request(
            capability="file_delete",
            origin_device=PHONE,
            target_device=MAC,
            resource="/Users/nick/Desktop/taxes.pdf",
            signature=signature,
        )
        decision = engine(remote_enabled=True).evaluate(altered, now=NOW)
        self.assertIs(decision.outcome, DENY)
        self.assertIn("signature_invalid", decision.reason_codes)

    def test_a_signature_under_an_unknown_key_is_denied(self):
        decision = engine(keys=KeyDirectory()).evaluate(
            request(signature=Signature(MAC_KEY, ALGORITHM, sign(SECRET, {"a": "b"}))), now=NOW
        )
        self.assertIs(decision.outcome, DENY)
        self.assertIn("signing_key_unknown", decision.reason_codes)

    def test_a_signature_made_with_another_devices_key_is_denied(self):
        # Verifying against ANY registered key would let this user's phone sign a
        # request claiming to come from their Mac -- and the decision would carry
        # a `signature_verified` obligation saying it had been checked.
        local = request(capability="file_delete")
        forged = request(
            capability="file_delete",
            signature=Signature(PHONE_KEY, ALGORITHM, sign(SECRET, local.signed_fields())),
        )
        decision = engine().evaluate(forged, now=NOW)
        self.assertIs(decision.outcome, DENY)
        self.assertIn("signature_key_is_not_the_origin_devices", decision.reason_codes)
        self.assertNotIn("signature_verified", decision.obligations)

    def test_a_request_source_of_remote_device_is_remote_even_on_one_device(self):
        # `origin != target` only catches a request that admits where it is
        # going. Saying you are another device is the other way to be remote.
        decision = engine().evaluate(request(request_source="remote_device"), now=NOW)
        self.assertIs(decision.outcome, DENY)
        self.assertIn("remote_execution_disabled", decision.reason_codes)

    def test_a_resource_must_be_specific_and_may_not_climb_out(self):
        for resource in ("*", "   ", "any"):
            decision = engine().evaluate(request(capability="desktop_list", resource=resource), now=NOW)
            self.assertIn("resource_is_not_specific", decision.reason_codes, resource)
        escaping = engine().evaluate(
            request(capability="desktop_list", resource="~/Desktop/../../.ssh/id_ed25519"), now=NOW
        )
        self.assertIs(escaping.outcome, DENY)
        self.assertIn("resource_escapes_its_scope", escaping.reason_codes)

    def test_a_local_sensitive_action_needs_no_signature(self):
        # Same device, no transport to forge over. Demanding one here would deny
        # every destructive local action Orion performs today and prove nothing.
        decision = self.outcome(capability="file_delete")
        self.assertIs(decision.outcome, REQUIRE_APPROVAL)
        self.assertNotIn("signature_required", decision.reason_codes)

    def test_capability_approval_and_risk_approval_both_bite(self):
        decision = self.outcome(capability="file_delete")
        self.assertIs(decision.outcome, REQUIRE_APPROVAL)
        self.assertIn("capability_requires_approval", decision.reason_codes)
        self.assertIn("risk_requires_approval", decision.reason_codes)


class RiskFloorTests(unittest.TestCase):
    """The floors are constants; a constant no test reads is a guess."""

    def synthetic(self, **overrides):
        base = registry().capabilities["messages_send"]
        return decode_registry(
            {
                "schema_version": 1,
                "capabilities": [
                    {
                        "action": "synthetic_action",
                        "capability": "conversation.synthetic.send",
                        "domain": base.domain.value,
                        "risk": overrides.get("risk", "low"),
                        "approval_required": False,
                        "reversible": overrides.get("reversible", True),
                        "side_effects": ["sends_message"],
                        "resource_scope": overrides.get("tier", "messages_send"),
                        "platforms": ["macos"],
                        "arguments": {"type": "object", "additionalProperties": False,
                                      "required": [], "properties": {}},
                        "returns": {"type": "object"},
                        "audit": "task_ledger",
                    }
                ],
            }
        )

    def test_an_r3_capability_always_needs_approval(self):
        # No live capability lands at R3 today, so COMMUNICATION_FLOOR was a
        # constant nothing exercised. This is the case it exists for.
        catalogue = self.synthetic()
        entry = catalogue.capabilities["synthetic_action"]
        self.assertIs(classify(entry), RiskLevel.R3)
        decision = PolicyEngine(catalogue, directory(), KeyDirectory({MAC_KEY: SECRET})).evaluate(
            request(capability="synthetic_action", active_profile=Profile.EXTERNAL_CONNECTED), now=NOW
        )
        self.assertIs(decision.outcome, REQUIRE_APPROVAL)
        self.assertIn("risk_requires_approval", decision.reason_codes)

    def test_a_destructive_tier_is_never_demoted_by_the_read_rule(self):
        # `low` + reversible demotes a read to R1 whatever tier it sits behind.
        # Applied to file_mutate or messages_send that would quietly lower a
        # destructive capability, and neither the ceiling check nor the parity
        # check would notice.
        for tier, expected in (("messages_send", RiskLevel.R3), ("file_mutate", RiskLevel.R4)):
            entry = self.synthetic(tier=tier).capabilities["synthetic_action"]
            self.assertIs(classify(entry), expected, tier)


class DelegationRuleTests(unittest.TestCase):
    def delegation(self, **overrides):
        fields = {
            "delegation_id": "delegation-0001",
            "delegator_id": USER,
            "delegate_id": USER,
            "capabilities": ("desktop_list",),
            "max_risk": RiskLevel.R1,
            "profile": Profile.APPROVED_ROOT_EDIT,
            "expires_at": NOW + timedelta(hours=1),
        }
        fields.update(overrides)
        return Delegation(**fields)

    def test_a_delegated_request_within_scope_is_allowed(self):
        decision = engine().evaluate(
            request(capability="desktop_list", resource="~/Desktop", delegation=self.delegation()),
            now=NOW,
        )
        self.assertIs(decision.outcome, ALLOW)

    def test_a_delegation_cannot_widen_the_active_profile(self):
        decision = engine().evaluate(
            request(
                capability="file_delete",
                delegation=self.delegation(
                    capabilities=("file_delete",),
                    max_risk=RiskLevel.R5,
                    profile=Profile.EXTERNAL_CONNECTED,
                ),
                active_profile=Profile.APPROVED_ROOT_EDIT,
            ),
            now=NOW,
        )
        self.assertIs(decision.outcome, DENY)
        self.assertIn("profile_does_not_grant_tier", decision.reason_codes)

    def test_an_expired_delegation_is_denied(self):
        decision = engine().evaluate(
            request(
                capability="desktop_list",
                delegation=self.delegation(expires_at=NOW - timedelta(minutes=1)),
            ),
            now=NOW,
        )
        self.assertIs(decision.outcome, DENY)
        self.assertIn("delegation_expired", decision.reason_codes)

    def test_a_delegation_that_does_not_name_the_capability_is_denied(self):
        decision = engine().evaluate(
            request(capability="media_play_pause", delegation=self.delegation()), now=NOW
        )
        self.assertIs(decision.outcome, DENY)
        self.assertIn("delegation_does_not_cover_capability", decision.reason_codes)

    def test_a_delegation_issued_to_somebody_else_is_denied(self):
        decision = engine().evaluate(
            request(
                capability="desktop_list",
                delegation=self.delegation(delegate_id="agent-helper-0001"),
            ),
            now=NOW,
        )
        self.assertIs(decision.outcome, DENY)
        self.assertIn("delegation_not_for_this_user", decision.reason_codes)


class ModelCannotOverrideTests(unittest.TestCase):
    def test_the_engine_reads_nothing_the_model_can_set_beyond_the_proposal(self):
        # The only model-controlled inputs are which capability and which
        # resource. Everything else is looked up (trust, ownership, risk,
        # profile) or supplied by the harness (source, state, clock).
        decision_a = engine().evaluate(request(capability="file_delete"), now=NOW)
        decision_b = engine().evaluate(
            request(capability="file_delete", declared_risk=RiskLevel.R4), now=NOW
        )
        self.assertIs(decision_a.outcome, decision_b.outcome)

    def test_evaluation_is_deterministic(self):
        first = engine().evaluate(request(capability="file_delete"), now=NOW)
        second = engine().evaluate(request(capability="file_delete"), now=NOW)
        self.assertEqual(first, second)

    def test_reason_codes_are_ordered_independently_of_rule_order(self):
        decision = engine(devices=directory(mac_trust="revoked")).evaluate(
            request(capability="file_delete", active_profile=Profile.RESTRICTED_READ_ONLY), now=NOW
        )
        self.assertEqual(list(decision.reason_codes), sorted(decision.reason_codes))

    def test_every_rule_is_evaluated_for_every_decision(self):
        # A rule that stops being called stops enforcing. Instrument the tuple
        # the engine actually reads -- wrapping the rules in this test file and
        # counting those would only prove this test can count.
        called: list[str] = []

        def watched(rule):
            def wrapper(evaluation):
                called.append(rule.__name__)
                return rule(evaluation)

            return wrapper

        original = decisions.RULES
        decisions.RULES = tuple(watched(rule) for rule in original)
        try:
            engine().evaluate(request(), now=NOW)
        finally:
            decisions.RULES = original
        self.assertEqual(sorted(called), sorted(rule.__name__ for rule in RULES))

    def test_the_evaluation_record_exposes_only_looked_up_facts(self):
        fields = set(Evaluation.__dataclass_fields__)
        self.assertIn("origin_trust", fields)
        self.assertIn("effective_profile", fields)
        self.assertNotIn("claimed_outcome", fields)


class EnvelopeTests(unittest.TestCase):
    def test_an_allowed_decision_produces_the_phase_1_envelope(self):
        decision = engine().evaluate(request(), now=NOW)
        envelope = decision.to_envelope(decision_id="decision-0001", decided_at=NOW)
        self.assertIsInstance(envelope, DecisionEnvelope)
        self.assertEqual(envelope.proposal_id, "request-0001")
        self.assertEqual(str(envelope.policy_version), POLICY_VERSION)
        self.assertEqual(envelope.expires_at - envelope.decided_at, DEFAULT_TTL)

    def test_a_denial_has_no_authorization_envelope(self):
        decision = engine().evaluate(request(capability="unknown_thing"), now=NOW)
        with self.assertRaises(ValueError):
            decision.to_envelope(decision_id="decision-0002", decided_at=NOW)

    def test_a_decision_must_expire(self):
        decision = engine().evaluate(request(), now=NOW)
        with self.assertRaises(ValueError):
            decision.to_envelope(decision_id="decision-0003", decided_at=NOW, ttl=timedelta(0))

    def test_obligations_name_the_audit_sink_and_the_context_domain(self):
        decision = engine().evaluate(request(capability="messages_recent"), now=NOW)
        self.assertIn("audit:task_ledger", decision.obligations)
        self.assertIn("context_domain:conversation", decision.obligations)


class LiveCoverageTests(unittest.TestCase):
    def test_every_live_capability_reaches_a_decision(self):
        policy = engine()
        outcomes = {
            action: policy.evaluate(
                request(capability=action, active_profile=Profile.EXTERNAL_CONNECTED), now=NOW
            ).outcome
            for action in registry().capabilities
        }
        self.assertEqual(len(outcomes), 78)
        self.assertFalse([action for action, outcome in outcomes.items() if outcome is DENY])

    def test_nothing_reaches_r3_today_and_that_is_recorded(self):
        # messages_send is the manifest's R3 case and is also irreversible, so
        # it classifies R4. R3 exists for the connectors later phases add.
        levels = {classify(entry) for entry in registry().capabilities.values()}
        self.assertNotIn(RiskLevel.R3, levels)


if __name__ == "__main__":
    unittest.main()
