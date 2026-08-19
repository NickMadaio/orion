from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "orion_v2_secretref_plan", REPO_ROOT / "scripts" / "orion_v2_secretref_plan.py"
)
assert SPEC is not None and SPEC.loader is not None
plan_module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = plan_module
SPEC.loader.exec_module(plan_module)


class SecretRefPlanTests(unittest.TestCase):
    def test_plan_targets_the_three_audited_plaintext_locations(self):
        plan = plan_module.build_plan()
        self.assertEqual(
            [(target["type"], target["path"]) for target in plan["targets"]],
            [
                ("gateway.auth.token", "gateway.auth.token"),
                ("models.providers.apiKey", "models.providers.anthropic.apiKey"),
                ("auth-profiles.token.token", "profiles.ollama:local.token"),
            ],
        )
        self.assertEqual(plan["targets"][2]["agentId"], "main")

    def test_every_provider_is_fixed_keychain_lookup_without_a_shell(self):
        plan = plan_module.build_plan()
        self.assertEqual(set(plan["providerUpserts"]), set(plan_module.PROVIDERS))
        for name, definition in plan["providerUpserts"].items():
            with self.subTest(provider=name):
                self.assertEqual(definition["source"], "exec")
                self.assertEqual(definition["command"], "/usr/bin/security")
                self.assertFalse(definition["jsonOnly"])
                self.assertTrue(definition["allowInsecurePath"])
                self.assertEqual(definition["args"][:3], ["find-generic-password", "-w", "-s"])
                self.assertEqual(definition["args"][-2:], ["-a", "openclaw"])
                self.assertNotIn("shell", definition)

    def test_rendered_plan_contains_no_credential_value_or_value_placeholder(self):
        rendered = plan_module.render_plan(plan_module.build_plan())
        parsed = json.loads(rendered)
        self.assertNotIn("private", rendered.lower())
        self.assertNotIn("token_value", rendered.lower())
        self.assertEqual(
            {target["ref"]["id"] for target in parsed["targets"]}, {"value"}
        )
        self.assertTrue(parsed["options"]["scrubAuthProfilesForProviderTargets"])


if __name__ == "__main__":
    unittest.main()
