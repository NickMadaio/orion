from __future__ import annotations

import importlib.util
import io
import json
import sqlite3
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock


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

    def test_selected_sources_do_not_read_unselected_stores(self):
        temporary, config, database = self.source_fixture()
        with temporary:
            values = seed_module.source_values(
                config, database.with_name("missing.sqlite"), ("gateway",)
            )
        self.assertEqual(values, {"gateway": "gateway-value"})

    def test_reads_anthropic_key_from_memory_stream(self):
        key = "sk-ant-" + ("a" * 80)
        self.assertEqual(seed_module.read_anthropic_secret(io.StringIO(key + "\n")), key)

    def test_rejects_malformed_anthropic_stdin(self):
        with self.assertRaisesRegex(ValueError, "invalid shape"):
            seed_module.read_anthropic_secret(io.StringIO("not-a-key"))

    def test_fifo_transfers_key_and_removes_itself(self):
        key = "sk-ant-" + ("b" * 80)
        with tempfile.TemporaryDirectory(dir="/private/tmp") as directory:
            fifo = Path(directory) / "secret.fifo"

            def write_secret():
                while not fifo.exists():
                    pass
                fifo.write_text(key, encoding="utf-8")

            writer = threading.Thread(target=write_secret)
            writer.start()
            self.assertEqual(seed_module.read_anthropic_fifo(fifo, timeout=2), key)
            writer.join(timeout=2)
            self.assertFalse(writer.is_alive())
            self.assertFalse(fifo.exists())

    def test_cli_fifo_path_is_narrowly_scoped(self):
        seed_module.validate_anthropic_fifo_path(
            Path("/private/tmp/orion-v2-anthropic-test.fifo")
        )
        with self.assertRaisesRegex(ValueError, "directly under"):
            seed_module.validate_anthropic_fifo_path(
                Path("/tmp/nested/orion-v2-anthropic-test.fifo")
            )

    def test_security_reads_and_deletes_target_the_explicit_login_keychain(self):
        keychain = object.__new__(seed_module.MacKeychain)
        keychain.security = "/usr/bin/security"
        keychain.timeout = 1
        keychain.keychain_path = Path("/Users/test/Library/Keychains/login.keychain-db")
        completed = seed_module.subprocess.CompletedProcess(
            args=[], returncode=0, stdout="private-value\n", stderr=""
        )
        with mock.patch.object(seed_module.subprocess, "run", return_value=completed) as run:
            self.assertEqual(keychain.get("service"), "private-value")
            self.assertEqual(run.call_args.args[0][-1], str(keychain.keychain_path))
        with mock.patch.object(seed_module.subprocess, "run", return_value=completed) as run:
            self.assertTrue(keychain.delete("service"))
            self.assertEqual(run.call_args.args[0][-1], str(keychain.keychain_path))

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
