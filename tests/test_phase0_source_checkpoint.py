from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "orion_v2_source_checkpoint",
    REPO_ROOT / "scripts" / "orion_v2_source_checkpoint.py",
)
assert SPEC is not None and SPEC.loader is not None
checkpoint = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = checkpoint
SPEC.loader.exec_module(checkpoint)


class SourceCheckpointTests(unittest.TestCase):
    def test_includes_current_source_test_and_handoff_paths(self):
        for path in (
            "native/Orion/Sources/Orion/NewView.swift",
            "openclaw-plugins/orion-control/src/new.ts",
            "orion/core/runtime/__init__.py",
            "planning/v2/PHASE_1_PLAN.md",
            "scripts/orion-repair",
            "tests/test_orion_recall.py",
            "HANDOFF.md",
        ):
            with self.subTest(path=path):
                self.assertTrue(checkpoint.checkpoint_path(path))

    def test_excludes_backups_workspace_archives_and_secrets(self):
        for path in (
            ".builds/Orion-LATEST.app/Contents/MacOS/Orion",
            ".builds/openclaw.json.pre-change",
            "openclaw-workspace/MEMORY.md",
            "planning/_archive/workspace/MEMORY.md",
            ".env",
            ".env.save",
            "random-private-export.txt",
            "../native/Orion/escape.swift",
            "/native/Orion/absolute.swift",
        ):
            with self.subTest(path=path):
                self.assertFalse(checkpoint.checkpoint_path(path))

    def test_selection_is_sorted_and_reports_exclusions(self):
        included, excluded = checkpoint.select_untracked(
            ["tests/z.py", ".builds/a", "scripts/a", "openclaw-workspace/USER.md"]
        )
        self.assertEqual(included, ["scripts/a", "tests/z.py"])
        self.assertEqual(excluded, [".builds/a", "openclaw-workspace/USER.md"])


if __name__ == "__main__":
    unittest.main()
