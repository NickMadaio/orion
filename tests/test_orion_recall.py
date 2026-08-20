import os
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
RECALL = REPO / "scripts" / "orion-recall"


class OrionRecallTests(unittest.TestCase):
    def run_recall(self, query: str) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as tmp:
            fake = Path(tmp) / ".openclaw" / "bin" / "openclaw"
            fake.parent.mkdir(parents=True)
            fake.write_text(
                "#!/bin/sh\n"
                "printf '%s\\n' \\\n"
                "  '0.80 sessions/main/diag.jsonl:1-3' \\\n"
                "  'User: Run a safe read-only diagnostic browser probe.' \\\n"
                "  'Assistant: BROWSER OK' \\\n"
                "  '' \\\n"
                "  '0.70 memory/2026-08-11.md:1-3' \\\n"
                '  "Nick\'s browser means Opera Air unless he says otherwise."\n',
                encoding="utf-8",
            )
            fake.chmod(0o755)
            env = os.environ.copy()
            env["HOME"] = tmp
            return subprocess.run(
                [str(RECALL), query],
                check=False,
                capture_output=True,
                text=True,
                env=env,
                timeout=10,
            )

    def test_hides_diagnostic_sessions_for_normal_recall(self) -> None:
        result = self.run_recall("remember my browser")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("browser means Opera Air", result.stdout)
        self.assertNotIn("diagnostic browser probe", result.stdout)

    def test_keeps_diagnostic_sessions_when_query_names_them(self) -> None:
        result = self.run_recall("browser diagnostic")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("diagnostic browser probe", result.stdout)


if __name__ == "__main__":
    unittest.main()
