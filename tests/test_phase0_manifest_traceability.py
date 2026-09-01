from __future__ import annotations

import json
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


class ManifestTraceabilityTests(unittest.TestCase):
    def load_gates(self):
        return json.loads(
            (REPO_ROOT / "planning" / "v2" / "PHASE_GATES.json").read_text(
                encoding="utf-8"
            )
        )

    def load_registry(self):
        return json.loads(
            (REPO_ROOT / "planning" / "v2" / "MANIFEST_PHASES.json").read_text(
                encoding="utf-8"
            )
        )

    def test_every_numbered_manifest_phase_is_registered_once(self):
        registry = self.load_registry()
        titles = registry["titles"]
        self.assertEqual(registry["schemaVersion"], 1)
        self.assertEqual(registry["phaseCount"], 85)
        self.assertEqual(len(titles), 85)
        self.assertEqual(len(set(titles)), 85)
        self.assertTrue(all(isinstance(title, str) and title for title in titles))
        self.assertEqual(titles[0], "Freeze, Inventory, and Understand Existing ORION")
        self.assertEqual(titles[84], "Final ORION Mobile Product Shape")

    def test_tracks_cover_all_phases_without_gaps_or_overlap(self):
        registry = self.load_registry()
        covered = []
        for track in registry["tracks"]:
            covered.extend(range(track["first"], track["last"] + 1))
        self.assertEqual(covered, list(range(85)))

    def test_current_statuses_match_the_enforced_phase_gate(self):
        registry = self.load_registry()
        gates = json.loads(
            (REPO_ROOT / "planning" / "v2" / "PHASE_GATES.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(registry["current"]["0"]["status"], gates["phases"]["0"]["status"])
        self.assertEqual(registry["current"]["1"]["status"], gates["phases"]["1"]["status"])
        self.assertTrue(gates["phases"]["1"]["entrySatisfied"])
        self.assertEqual(registry["current"]["0"]["status"], "complete")
        self.assertEqual(registry["current"]["1"]["status"], "complete")
        # Phase 1 closed on 2026-08-20 against PHASE_1_PLAN.md rather than the
        # manifest's literal exit gate. That divergence is not a footnote, so
        # the gate file has to keep carrying it forward in machine-readable
        # form; a later phase must not inherit it silently.
        self.assertTrue(
            any(
                deviation["id"] == "manifest_literal_exit_gate_not_met"
                for deviation in gates["phases"]["1"]["deviations"]
            )
        )
        self.assertEqual(registry["current"]["2"]["status"], gates["phases"]["2"]["status"])

    def test_an_accepted_deviation_records_who_accepted_it_and_when(self):
        # A deviation with no name and no date on it is not an accepted
        # deviation, it is an unreviewed one wearing the word "accepted".
        gates = self.load_gates()
        for phase, record in gates["phases"].items():
            for deviation in record.get("deviations", []):
                if deviation.get("severity") != "accepted":
                    continue
                for field in ("acceptedBy", "acceptedOn", "acceptedReading"):
                    self.assertTrue(
                        deviation.get(field),
                        f"phase {phase} deviation {deviation['id']} is accepted "
                        f"without {field}",
                    )

    def test_a_recorded_deviation_says_whose_acceptance_it_still_needs(self):
        # The counterpart to the test above. "accepted" needs a name and a date;
        # anything else needs to say what would make it accepted, or it is just
        # a note that ages into a fact nobody agreed to.
        gates = self.load_gates()
        for phase, record in gates["phases"].items():
            for deviation in record.get("deviations", []):
                if deviation.get("severity") == "accepted":
                    continue
                self.assertTrue(
                    deviation.get("acceptanceNeeded"),
                    f"phase {phase} deviation {deviation['id']} is unaccepted and "
                    f"does not say what acceptance would take",
                )
                self.assertTrue(
                    deviation.get("closingWork"),
                    f"phase {phase} deviation {deviation['id']} does not say what "
                    f"work would remove it",
                )

    def test_every_deferred_gate_amendment_carries_replacement_text(self):
        # The sweep that eventually amends these has to be reviewable in one
        # sitting, which means each entry must already say what it would become.
        gates = self.load_gates()
        pending = gates.get("pendingGateAmendments", {})
        for entry in pending.get("entries", []):
            self.assertIn(entry["phase"], gates["phases"])
            for field in ("gateText", "deadAssumption", "proposedText"):
                self.assertTrue(entry.get(field), f"{entry['phase']}: missing {field}")
            self.assertNotEqual(entry["gateText"], entry["proposedText"])

    def test_scope_the_manifest_does_not_cover_is_registered_not_improvised(self):
        # Wanting something the requirements source never mentions is normal.
        # Building it without saying so is how the manifest stops meaning
        # anything, so each entry has to say what exists and where it belongs.
        gates = self.load_gates()
        register = gates.get("scopeNotInManifest", {})
        self.assertTrue(register.get("protocol"))
        for entry in register.get("entries", []):
            for field in ("id", "raisedBy", "manifestCoverage", "layer", "wouldBelongNear"):
                self.assertTrue(entry.get(field), f"{entry.get('id')}: missing {field}")


if __name__ == "__main__":
    unittest.main()
