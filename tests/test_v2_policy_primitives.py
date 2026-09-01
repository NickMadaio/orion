"""Phase 5: the pieces a policy decision is made out of.

Risk derivation, the fourteen inputs, device trust, delegation, and signatures.
The engine itself is tested in test_v2_policy_engine.py.
"""

from __future__ import annotations

import json
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

from orion.core.tools.registry import decode_registry
from orion.security.delegation import Delegation
from orion.security.devices import Device, DeviceDirectory
from orion.security.profiles import PROFILE_TIERS, RISK_CEILING, Profile, grants, narrower_of
from orion.security.request import PolicyRequest
from orion.security.risk import SEVERITY_FLOOR, TIER_REACH, UnknownTier, classify, mismatch, tier_of
from orion.security.signing import ALGORITHM, KeyDirectory, Signature, canonical_bytes, sign, verify
from orion.security.vocabulary import (
    DeviceTrust,
    RequestSource,
    RiskLevel,
    SecurityState,
    at_least,
    at_most,
    highest,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = REPO_ROOT / "planning" / "v2" / "capability-registry.json"
NOW = datetime(2026, 8, 23, 20, 0, tzinfo=timezone.utc)
SECRET = b"phase-5-test-signing-material"


def registry():
    return decode_registry(json.loads(REGISTRY_PATH.read_text(encoding="utf-8")))


def request_fields(**overrides):
    fields = {
        "request_id": "request-0001",
        "correlation_id": "correlation-0001",
        "authenticated_user": "user-nick-0001",
        "origin_device": "mac-studio-0001",
        "target_device": "mac-studio-0001",
        "capability": "system_status",
        "resource": "none",
        "active_profile": "consequential_local",
        "request_source": "user_direct",
        "external_data_involved": False,
        "issued_at": "2026-08-23T20:00:00Z",
        "expires_at": "2026-08-23T20:05:00Z",
        "security_state": "normal",
    }
    fields.update(overrides)
    return fields


class RiskVocabularyTests(unittest.TestCase):
    def test_levels_are_ordered_by_reach(self):
        self.assertEqual([level.rank for level in RiskLevel], [0, 1, 2, 3, 4, 5])
        self.assertTrue(at_least(RiskLevel.R4, RiskLevel.R3))
        self.assertFalse(at_least(RiskLevel.R2, RiskLevel.R3))
        self.assertTrue(at_most(RiskLevel.R1, RiskLevel.R4))
        self.assertIs(highest((RiskLevel.R0, RiskLevel.R5, RiskLevel.R2)), RiskLevel.R5)

    def test_comparison_helpers_exist_because_str_enums_compare_as_strings(self):
        # RiskLevel subclasses str, so `<` already means string comparison. The
        # helpers exist so nothing accidentally relies on that.
        self.assertTrue(RiskLevel.R0 < RiskLevel.R1)  # string comparison, not reach
        self.assertTrue(at_least(RiskLevel.R1, RiskLevel.R0))


class RiskDerivationTests(unittest.TestCase):
    def setUp(self):
        self.registry = registry()

    def test_every_live_capability_classifies(self):
        levels = {action: classify(entry) for action, entry in self.registry.capabilities.items()}
        self.assertEqual(len(levels), 78)
        self.assertTrue(all(isinstance(level, RiskLevel) for level in levels.values()))

    def test_known_actions_land_where_expected(self):
        expected = {
            "system_status": RiskLevel.R0,
            "messages_recent": RiskLevel.R0,
            "self_plugin_read": RiskLevel.R0,
            "media_play_pause": RiskLevel.R1,
            "self_config_list": RiskLevel.R1,
            "browser_open_url": RiskLevel.R2,
            "calendar_event_add": RiskLevel.R2,
            "file_delete": RiskLevel.R4,
            "desktop_file_write_explicit": RiskLevel.R4,
            "messages_send": RiskLevel.R4,
            "self_config_authority_set": RiskLevel.R5,
        }
        for action, level in expected.items():
            self.assertIs(classify(self.registry.capabilities[action]), level, action)

    def test_a_simulation_reaches_nothing(self):
        # email_send is rated `high` and irreversible because it is described as
        # if it were real. It writes a line to a transcript.
        self.assertIs(classify(self.registry.capabilities["email_send"]), RiskLevel.R0)

    def test_an_irreversible_data_action_is_destructive(self):
        self.assertIs(classify(self.registry.capabilities["reminder_cancel"]), RiskLevel.R4)

    def test_an_irreversible_non_data_action_is_not(self):
        # A closed browser tab cannot be reopened by Orion and is not lost data.
        self.assertIs(classify(self.registry.capabilities["browser_close_tab"]), RiskLevel.R2)

    def test_a_read_stays_a_read_behind_a_powerful_tier(self):
        entry = self.registry.capabilities["self_config_list"]
        self.assertEqual(tier_of(entry), "self_config")
        self.assertIs(TIER_REACH["self_config"], RiskLevel.R5)
        self.assertIs(classify(entry), RiskLevel.R1)

    def test_side_effects_are_not_an_input(self):
        # The Phase 4 registry derives side_effects from a coarser `kind`, so
        # `reminder_list` claims writes_files and `calendar_event_add` claims
        # only reads_user_data. Risk must not move when they are wrong.
        entry = self.registry.capabilities["reminder_list"]
        self.assertIn("writes_files", entry.side_effects)
        self.assertIs(classify(entry), RiskLevel.R1)

    def test_an_unrecorded_tier_raises_rather_than_defaulting(self):
        entry = replace(
            self.registry.capabilities["system_status"],
            resource_scope="tier_invented_next_year",
        )
        with self.assertRaises(UnknownTier):
            classify(entry)

    def test_declared_risk_mismatch_is_detected(self):
        entry = self.registry.capabilities["file_delete"]
        self.assertTrue(mismatch(entry, RiskLevel.R0))
        self.assertFalse(mismatch(entry, RiskLevel.R4))
        self.assertFalse(mismatch(entry, None))

    def test_severity_floor_covers_every_catalog_word(self):
        self.assertEqual(set(SEVERITY_FLOOR), {"low", "medium", "high", "critical"})


class ProfileTests(unittest.TestCase):
    def test_ladder_order_is_least_to_most(self):
        rungs = [profile.rung for profile in Profile]
        self.assertEqual(rungs, sorted(rungs))
        self.assertIs(
            narrower_of(Profile.EXTERNAL_CONNECTED, Profile.RESTRICTED_READ_ONLY),
            Profile.RESTRICTED_READ_ONLY,
        )

    def test_destructive_tier_requires_raising_the_profile(self):
        self.assertFalse(grants(Profile.BROAD_LOCAL_FILESYSTEM, "file_mutate"))
        self.assertTrue(grants(Profile.CONSEQUENTIAL_LOCAL, "file_mutate"))

    def test_sending_a_message_sits_only_at_the_top(self):
        for profile in Profile:
            self.assertEqual(
                grants(profile, "messages_send"), profile is Profile.EXTERNAL_CONNECTED, profile
            )

    def test_recorded_ceilings_still_match_the_observed_maxima(self):
        # The ceiling is a tripwire, not a grant: it must equal what the profile
        # can actually reach today, so a capability that later exceeds it fails.
        entries = registry().capabilities.values()
        for profile in Profile:
            reachable = [classify(e) for e in entries if tier_of(e) in PROFILE_TIERS[profile]]
            self.assertIs(highest(tuple(reachable)), RISK_CEILING[profile], profile)


class DeviceTests(unittest.TestCase):
    def directory(self):
        return DeviceDirectory(
            [
                Device("mac-studio-0001", "user-nick-0001", DeviceTrust.PAIRED, "macos", "key-mac-0001"),
                Device("iphone-old-00001", "user-nick-0001", DeviceTrust.REVOKED, "ios"),
            ]
        )

    def test_an_unregistered_device_is_unknown_not_an_error(self):
        self.assertIs(self.directory().trust_of("never-seen-0001"), DeviceTrust.UNKNOWN)

    def test_ownership_is_answered_by_the_directory(self):
        directory = self.directory()
        self.assertTrue(directory.owns("user-nick-0001", "mac-studio-0001"))
        self.assertFalse(directory.owns("user-other-0001", "mac-studio-0001"))

    def test_a_paired_device_must_be_able_to_sign(self):
        with self.assertRaises(ValueError):
            Device("mac-studio-0002", "user-nick-0001", DeviceTrust.PAIRED, "macos")

    def test_revocation_returns_a_new_directory(self):
        before = self.directory()
        after = before.revoke("mac-studio-0001")
        self.assertIs(before.trust_of("mac-studio-0001"), DeviceTrust.PAIRED)
        self.assertIs(after.trust_of("mac-studio-0001"), DeviceTrust.REVOKED)

    def test_a_device_cannot_be_registered_twice(self):
        with self.assertRaises(ValueError):
            DeviceDirectory(
                [
                    Device("mac-studio-0001", "user-nick-0001", DeviceTrust.REVOKED, "macos"),
                    Device("mac-studio-0001", "user-nick-0001", DeviceTrust.PAIRED, "macos", "key-mac-0001"),
                ]
            )


class SigningTests(unittest.TestCase):
    def fields(self):
        return {"capability": "file_delete", "resource": "/Users/nick/Desktop/notes.txt"}

    def test_a_signature_covers_exactly_its_fields(self):
        value = sign(SECRET, self.fields())
        signature = Signature("key-mac-0001", ALGORITHM, value)
        self.assertTrue(verify(SECRET, self.fields(), signature))

    def test_an_altered_field_breaks_the_signature(self):
        signature = Signature("key-mac-0001", ALGORITHM, sign(SECRET, self.fields()))
        altered = {**self.fields(), "resource": "/Users/nick/Desktop/taxes.pdf"}
        self.assertFalse(verify(SECRET, altered, signature))

    def test_canonical_bytes_are_unambiguous(self):
        # Without length prefixes these two field sets serialize identically
        # under any separator scheme, and one signature would cover both.
        self.assertNotEqual(
            canonical_bytes({"a": "1", "b": "2"}),
            canonical_bytes({"a": "1\nb=2", "b": ""}),
        )

    def test_an_unknown_algorithm_is_false_not_an_exception(self):
        signature = Signature("key-mac-0001", "made-up-v9", sign(SECRET, self.fields()))
        self.assertFalse(verify(SECRET, self.fields(), signature))

    def test_a_signature_value_must_look_like_a_digest(self):
        for bad in ("", "not-hex" * 8, sign(SECRET, self.fields()).upper()):
            with self.assertRaises(ValueError):
                Signature("key-mac-0001", ALGORITHM, bad)

    def test_the_key_directory_holds_nothing_by_default(self):
        self.assertIsNone(KeyDirectory().secret_for("key-mac-0001"))
        self.assertEqual(KeyDirectory({"key-mac-0001": SECRET}).secret_for("key-mac-0001"), SECRET)


class DelegationTests(unittest.TestCase):
    def delegation(self, **overrides):
        fields = {
            "delegation_id": "delegation-0001",
            "delegator_id": "user-nick-0001",
            "delegate_id": "agent-helper-0001",
            "capabilities": ("desktop_list",),
            "max_risk": RiskLevel.R1,
            "profile": Profile.APPROVED_ROOT_EDIT,
            "expires_at": NOW + timedelta(hours=1),
        }
        fields.update(overrides)
        return Delegation(**fields)

    def test_a_delegation_narrows_and_never_widens(self):
        delegation = self.delegation(profile=Profile.EXTERNAL_CONNECTED)
        self.assertIs(
            delegation.effective_profile(Profile.RESTRICTED_READ_ONLY),
            Profile.RESTRICTED_READ_ONLY,
        )
        self.assertIs(
            self.delegation().effective_profile(Profile.EXTERNAL_CONNECTED),
            Profile.APPROVED_ROOT_EDIT,
        )

    def test_a_delegation_must_expire(self):
        with self.assertRaises(ValueError):
            self.delegation(expires_at=None)
        with self.assertRaises(ValueError):
            self.delegation(expires_at=datetime(2026, 8, 23, 21, 0))

    def test_scope_and_risk_are_both_checked(self):
        delegation = self.delegation()
        self.assertTrue(delegation.covers("desktop_list"))
        self.assertFalse(delegation.covers("file_delete"))
        self.assertTrue(delegation.permits_risk(RiskLevel.R1))
        self.assertFalse(delegation.permits_risk(RiskLevel.R2))

    def test_an_empty_delegation_is_refused(self):
        with self.assertRaises(ValueError):
            self.delegation(capabilities=())


class PolicyRequestTests(unittest.TestCase):
    def test_the_fourteen_inputs_are_present(self):
        request = PolicyRequest.from_dict(request_fields())
        self.assertEqual(request.capability, "system_status")
        self.assertIs(request.security_state, SecurityState.NORMAL)
        self.assertIs(request.request_source, RequestSource.USER_DIRECT)
        self.assertEqual(request.expires_at, NOW + timedelta(minutes=5))

    def test_a_model_supplied_payload_cannot_smuggle_an_outcome(self):
        for smuggled in ("outcome", "allow", "device_trust", "override", "risk"):
            with self.assertRaises(ValueError, msg=smuggled):
                PolicyRequest.from_dict({**request_fields(), smuggled: "ALLOW"})

    def test_every_request_expires(self):
        with self.assertRaises(ValueError):
            PolicyRequest.from_dict(
                request_fields(issued_at="2026-08-23T20:05:00Z", expires_at="2026-08-23T20:00:00Z")
            )

    def test_naive_timestamps_are_refused(self):
        with self.assertRaises(ValueError):
            PolicyRequest.from_dict(request_fields(issued_at="2026-08-23T20:00:00"))

    def test_trust_is_not_a_field_a_request_can_carry(self):
        self.assertNotIn("device_trust", {field for field in PolicyRequest.__dataclass_fields__})

    def test_signed_fields_cover_everything_that_changes_the_outcome(self):
        signed = PolicyRequest.from_dict(request_fields()).signed_fields()
        for field in ("capability", "resource", "origin_device", "target_device", "expires_at"):
            self.assertIn(field, signed)

    def test_a_delegation_cannot_arrive_inside_the_payload(self):
        with self.assertRaises(ValueError):
            PolicyRequest.from_dict({**request_fields(), "delegation": {"delegation_id": "x"}})


if __name__ == "__main__":
    unittest.main()
