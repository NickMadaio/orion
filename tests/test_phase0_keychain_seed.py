from __future__ import annotations

import importlib.util
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "orion_v2_keychain_seed", REPO_ROOT / "scripts" / "orion_v2_keychain_seed.py"
)
assert SPEC is not None and SPEC.loader is not None
seed_module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = seed_module
SPEC.loader.exec_module(seed_module)


class FakeKeychain:
    def __init__(self, values=None, fail_service=None):
        self.values = dict(values or {})
        self.fail_service = fail_service

    def get(self, service):
        return self.values.get(service)

    def add(self, service, value):
        if service == self.fail_service:
            return False
        if service in self.values:
            return False
        self.values[service] = value
        return True

    def delete(self, service):
        self.values.pop(service, None)
        return True


class KeychainSeedTests(unittest.TestCase):
    def source_fixture(self):
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        config = root / "openclaw.json"
        database = root / "agent.sqlite"
        config.write_text(
            json.dumps(
                {
                    "gateway": {"auth": {"token": "gateway-value"}},
                    "models": {"providers": {"anthropic": {"apiKey": "anthropic-value"}}},
                }
            )
        )
        with sqlite3.connect(database) as connection:
            connection.execute(
                "CREATE TABLE auth_profile_store (store_key TEXT PRIMARY KEY, store_json TEXT, updated_at INTEGER)"
            )
            connection.execute(
                "INSERT INTO auth_profile_store VALUES (?, ?, ?)",
                (
                    "primary",
                    json.dumps(
                        {
                            "version": 1,
                            "profiles": {
                                "ollama:local": {
                                    "provider": "ollama",
                                    "type": "token",
                                    "token": "ollama-value",
                                }
                            },
                        }
                    ),
                    1,
                ),
            )
        return temporary, config, database

    def test_reads_the_three_sources_without_rendering_values(self):
        temporary, config, database = self.source_fixture()
        with temporary:
            values = seed_module.source_values(config, database)
        self.assertEqual(set(values), {"gateway", "anthropic", "ollama"})
        rendered = seed_module.render_status(
            seed_module.statuses(values, FakeKeychain())
        )
        for value in values.values():
            self.assertNotIn(value, rendered)

    def test_seed_is_idempotent_and_refuses_silent_replacement(self):
        values = {"gateway": "g", "anthropic": "a", "ollama": "o"}
        keychain = FakeKeychain()
        self.assertTrue(all(value == "matches_source" for value in seed_module.seed(values, keychain).values()))
        self.assertTrue(all(value == "matches_source" for value in seed_module.seed(values, keychain).values()))

        keychain.values[seed_module.SERVICES["gateway"]] = "different"
        with self.assertRaisesRegex(ValueError, "manual review"):
            seed_module.seed(values, keychain)

    def test_failure_rolls_back_only_new_items(self):
        values = {"gateway": "g", "anthropic": "a", "ollama": "o"}
        existing_service = seed_module.SERVICES["gateway"]
        failing_service = seed_module.SERVICES["ollama"]
        keychain = FakeKeychain({existing_service: "g"}, fail_service=failing_service)
        with self.assertRaisesRegex(RuntimeError, "ollama"):
            seed_module.seed(values, keychain)
        self.assertEqual(keychain.values, {existing_service: "g"})


if __name__ == "__main__":
    unittest.main()
