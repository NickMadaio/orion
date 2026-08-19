from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "orion_v2_secret_inventory",
    REPO_ROOT / "scripts" / "orion_v2_secret_inventory.py",
)
assert SPEC is not None and SPEC.loader is not None
inventory = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = inventory
SPEC.loader.exec_module(inventory)


class SecretInventoryTests(unittest.TestCase):
    def test_dotenv_parser_returns_names_and_values_only_in_memory(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text("# comment\nexport API_KEY=private-one\nMODE=local\nnot valid\n")
            self.assertEqual(
                inventory.read_dotenv(path), {"API_KEY": "private-one", "MODE": "local"}
            )

    def test_rendered_inventory_never_contains_values_or_machine_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "repo"
            home = root / "home"
            repo.mkdir()
            (home / ".openclaw").mkdir(parents=True)
            (repo / ".env").write_text(
                "ANTHROPIC_API_KEY=private-one\nDISCORD_WEBHOOK_URL=private-hook\nMODE=local\n"
            )
            (repo / ".env.save").write_text("ANTHROPIC_API_KEY=private-one\n")
            (home / ".openclaw/openclaw.json").write_text(
                json.dumps(
                    {
                        "gateway": {"auth": {"token": "private-gateway"}},
                        "models": {
                            "providers": {
                                "anthropic": {"apiKey": "private-one"},
                                "ollama": {"apiKey": {"source": "env", "id": "OLLAMA_KEY"}},
                            }
                        },
                    }
                )
            )
            rendered = inventory.render_inventory(inventory.build_inventory(repo, home))
            for secret in ("private-one", "private-hook", "private-gateway", str(root)):
                self.assertNotIn(secret, rendered)
            parsed = json.loads(rendered)
            self.assertEqual(parsed["relationships"][0]["relationship"], "same")
            secret_fields = parsed["files"][2]["secretFields"]
            self.assertEqual(secret_fields[0]["storage"], "plaintext")
            self.assertEqual(secret_fields[2]["storage"], "secret_ref")

    def test_relationship_refuses_non_string_secret_refs(self):
        self.assertEqual(inventory.relationship("value", {"source": "env"}), "not_comparable")
        self.assertEqual(inventory.relationship("one", "two"), "different")
        self.assertEqual(inventory.relationship("same", "same"), "same")


if __name__ == "__main__":
    unittest.main()
