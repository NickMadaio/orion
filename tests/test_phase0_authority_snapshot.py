from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "orion_v2_authority_snapshot",
    REPO_ROOT / "scripts" / "orion_v2_authority_snapshot.py",
)
assert SPEC is not None and SPEC.loader is not None
snapshot = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = snapshot
SPEC.loader.exec_module(snapshot)


def fixture() -> dict:
    return {
        "profile": "trusted_local",
        "profileSource": "permission-state.json",
        "dist": "/Users/example/private/plugin.js",
        "drift": False,
        "exec": {"security": "allowlist", "ask": "off", "askFallback": "deny"},
        "availability": [
            {
                "tier": "ambient_info",
                "flag": "enableAmbientInfo",
                "configOn": True,
                "profileOn": True,
                "available": True,
                "unresolved": False,
                "privateConfig": "must disappear",
            }
        ],
        "capabilities": [
            {
                "kind": "command",
                "name": "orion-example",
                "pattern": "/Users/example/private/orion-example",
                "spellings": ["private path"],
                "level": "APPROVAL",
                "rule": "coarse command",
                "because": "the exec layer cannot distinguish its subcommands",
                "enforcedBy": "exec allowlist",
                "coarse": True,
                "signals": [{"evidence": {"text": "private source excerpt"}}],
                "subs": [
                    {"name": "write", "level": "APPROVAL", "signals": ["private"]},
                    {"name": "read", "level": "AUTO"},
                ],
            },
            {
                "kind": "action",
                "name": "system_status",
                "tier": "ambient_info",
                "risk": "low",
                "reversible": True,
                "level": "AUTO",
                "rule": "default",
                "because": "read-only status",
                "enforcedBy": "plugin gate",
                "execution": {"private": "must disappear"},
            },
        ],
    }


class AuthoritySnapshotTests(unittest.TestCase):
    def test_normalizes_counts_and_stable_order(self):
        normalized = snapshot.normalize_authority(fixture())
        self.assertEqual(
            normalized["counts"],
            {"total": 2, "AUTO": 1, "NOTIFY": 0, "APPROVAL": 1, "NEVER": 0},
        )
        self.assertEqual(
            [item["name"] for item in normalized["capabilities"]],
            ["system_status", "orion-example"],
        )
        self.assertTrue(normalized["installedPluginParity"])

    def test_drops_paths_source_evidence_and_config_extras(self):
        rendered = snapshot.render_snapshot(snapshot.normalize_authority(fixture()))
        for private_field in ("/Users/example", "pattern", "spellings", "signals", "privateConfig"):
            self.assertNotIn(private_field, rendered)
        command = snapshot.normalize_authority(fixture())["capabilities"][1]
        self.assertEqual(
            command["subcommands"],
            [{"name": "read", "level": "AUTO"}, {"name": "write", "level": "APPROVAL"}],
        )

    def test_rejects_unknown_levels_and_duplicate_entries(self):
        unknown = fixture()
        unknown["capabilities"][0]["level"] = "SILENT"
        with self.assertRaisesRegex(ValueError, "unknown level"):
            snapshot.normalize_authority(unknown)

        duplicate = fixture()
        duplicate["capabilities"].append(dict(duplicate["capabilities"][1]))
        with self.assertRaisesRegex(ValueError, "duplicate"):
            snapshot.normalize_authority(duplicate)


if __name__ == "__main__":
    unittest.main()
