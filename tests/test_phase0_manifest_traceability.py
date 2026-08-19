from __future__ import annotations

import json
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


class ManifestTraceabilityTests(unittest.TestCase):
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
        self.assertFalse(gates["phases"]["1"]["entrySatisfied"])


if __name__ == "__main__":
    unittest.main()
