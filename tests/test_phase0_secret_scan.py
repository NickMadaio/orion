from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "orion_v2_secret_scan", REPO_ROOT / "scripts" / "orion_v2_secret_scan.py"
)
assert SPEC is not None and SPEC.loader is not None
scanner = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = scanner
SPEC.loader.exec_module(scanner)


class SecretScanTests(unittest.TestCase):
    def test_finding_is_detected_but_value_is_never_rendered(self):
        secret = "ghp_" + "A" * 28
        finding = scanner.findings_in_text("example.txt", f"token={secret}")[0]
        rendered = scanner.render(finding)
        self.assertNotIn(secret, rendered)
        self.assertIn("rule=github_token", rendered)
        self.assertIn("fingerprint=", rendered)

    def test_build_and_dependency_directories_are_skipped(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            secret = "sk-" + "B" * 28
            (root / "visible.txt").write_text(secret)
            hidden = root / "node_modules" / "package"
            hidden.mkdir(parents=True)
            (hidden / "fixture.txt").write_text(secret)
            findings = scanner.scan_worktree(root)
            self.assertEqual([finding.path for finding in findings], ["visible.txt"])

    def test_gitignored_secret_is_only_scanned_in_inventory_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            (root / ".gitignore").write_text(".env\n")
            (root / ".env").write_text("sk-" + "E" * 32)
            self.assertEqual(scanner.scan_worktree(root), [])
            self.assertEqual(len(scanner.scan_worktree(root, include_ignored=True)), 1)

    def test_allowlist_matches_only_exact_fingerprint(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            secret = "AIza" + "C" * 34
            (root / "fixture.txt").write_text(secret)
            finding = scanner.scan_worktree(root)[0]
            allowlist = root / "allowlist.json"
            allowlist.write_text(
                json.dumps(
                    {
                        "entries": [
                            {
                                "path": finding.path,
                                "rule": finding.rule,
                                "fingerprint": finding.fingerprint,
                            }
                        ]
                    }
                )
            )
            output = StringIO()
            with redirect_stdout(output):
                result = scanner.main(
                    ["--root", str(root), "--allowlist", str(allowlist)]
                )
            self.assertEqual(result, 0)
            self.assertNotIn(secret, output.getvalue())

    def test_history_scan_finds_a_removed_secret_without_printing_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.name", "Test"], check=True)
            subprocess.run(
                ["git", "-C", str(root), "config", "user.email", "test@example.invalid"],
                check=True,
            )
            secret = "sk-" + "D" * 32
            target = root / "removed.txt"
            target.write_text(secret)
            subprocess.run(["git", "-C", str(root), "add", "removed.txt"], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "fixture"], check=True)
            target.unlink()
            subprocess.run(["git", "-C", str(root), "add", "-u"], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "remove fixture"], check=True)

            findings = scanner.scan_history(root)
            self.assertTrue(any(finding.path == "removed.txt" for finding in findings))
            self.assertTrue(all(secret not in scanner.render(finding) for finding in findings))


if __name__ == "__main__":
    unittest.main()
