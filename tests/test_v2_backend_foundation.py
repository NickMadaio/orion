"""Phase 10: the backend foundation.

Seventeen declared modules, three environments that cannot share anything, a
route table that cannot take ownership from a URL, and the worker that owns
Phase 8's sweep. Nothing here needs FastAPI, PostgreSQL, or a host.
"""

from __future__ import annotations

import ast
import shutil
import tempfile
import unittest
from pathlib import Path

from backend import boundaries
from backend.adapters.fastapi_app import FastAPIUnavailable, build_app
from backend.boundaries import (
    FORBIDDEN_QUALIFIED,
    FORBIDDEN_ROOTS,
    all_errors,
    cycles,
    declaration_errors,
    import_errors,
    transitive_dependencies,
)
from backend.environments import (
    CONFIGURATIONS,
    SEPARATED_FIELDS,
    Environment,
    EnvironmentConfig,
    ProductionSecretRefused,
    config_for,
    resolve_secret_reference,
    scope_of,
    separation_errors,
)
from backend.modules import DEPLOYABLES, MANIFEST_MODULES, MODULES, ModuleSpec
from backend.routes import FORBIDDEN_PATH_PARAMETERS, MUTATING, ROUTES, Route, route_errors
from backend.worker import PERIODIC, PeriodicTask, worker_errors
from orion.shared.result import Sensitivity


REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND = REPO_ROOT / "backend"


class ModuleGraphTests(unittest.TestCase):
    def test_all_seventeen_manifest_modules_are_declared(self):
        self.assertEqual(len(MANIFEST_MODULES), 17)
        self.assertEqual(sorted(MODULES), sorted(MANIFEST_MODULES))

    def test_a_module_declares_what_it_owns_and_offers(self):
        # Phase 1: "Empty packages are not a milestone." Seventeen empty
        # directories would satisfy the manifest's wording and check nothing.
        for name, spec in MODULES.items():
            self.assertTrue(spec.owns, name)
            self.assertTrue(spec.operations, name)
            self.assertTrue(spec.purpose.endswith("."), name)
            self.assertIsInstance(spec.sensitivity, Sensitivity)

    def test_a_module_that_owns_nothing_is_refused(self):
        with self.assertRaises(ValueError):
            ModuleSpec("empty", "Owns nothing.", (), (), Sensitivity.INTERNAL, ("do",))

    def test_a_module_cannot_depend_on_itself_or_repeat_a_dependency(self):
        with self.assertRaises(ValueError):
            ModuleSpec("loop", "Depends on itself.", ("x",), ("loop",), Sensitivity.INTERNAL, ("do",))
        with self.assertRaises(ValueError):
            ModuleSpec("twice", "Repeats.", ("x",), ("users", "users"), Sensitivity.INTERNAL, ("do",))

    def test_the_graph_is_acyclic_and_complete(self):
        self.assertEqual(declaration_errors(), [])
        self.assertEqual(cycles(), [])

    def test_a_cycle_would_be_found(self):
        broken = {
            "a": ModuleSpec("a", "A.", ("x",), ("b",), Sensitivity.INTERNAL, ("do",)),
            "b": ModuleSpec("b", "B.", ("y",), ("a",), Sensitivity.INTERNAL, ("do",)),
        }
        self.assertTrue(cycles(broken))
        self.assertTrue(declaration_errors(broken))

    def test_health_and_credentials_sit_at_the_top_of_the_sensitivity_scale(self):
        self.assertIs(MODULES["health"].sensitivity, Sensitivity.RESTRICTED)
        self.assertIs(MODULES["connectors"].sensitivity, Sensitivity.RESTRICTED)
        self.assertIs(MODULES["policies"].sensitivity, Sensitivity.RESTRICTED)

    def test_planning_reaches_health_only_through_its_declaration(self):
        self.assertIn("health", MODULES["planning"].depends_on)
        self.assertNotIn("health", transitive_dependencies("gmail"))
        self.assertNotIn("health", transitive_dependencies("calendar"))

    def test_one_deployable(self):
        # "Do not introduce microservices without a concrete need" is this number.
        self.assertEqual(DEPLOYABLES, ("orion-backend",))


class ImportBoundaryTests(unittest.TestCase):
    def test_the_backend_does_not_import_the_mac_runtime(self):
        self.assertEqual(import_errors(BACKEND), [])
        self.assertEqual(all_errors(BACKEND), [])

    def test_the_forbidden_list_covers_the_mac_and_the_plugin(self):
        self.assertIn("openclaw", FORBIDDEN_ROOTS)
        self.assertIn("orion.mac", FORBIDDEN_QUALIFIED)
        self.assertIn("AppKit", FORBIDDEN_ROOTS)

    def sample_tree(self, files: dict[str, str]) -> Path:
        """A throwaway backend tree.

        Deliberately NOT written into the real one: a test that drops files into
        a shared working tree leaves them there when it crashes, and this
        repository's tree is shared with another assistant's uncommitted work.
        """

        root = Path(tempfile.mkdtemp()) / "backend"
        self.addCleanup(shutil.rmtree, root.parent, ignore_errors=True)
        for relative, source in files.items():
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(source, encoding="utf-8")
        return root

    def test_a_forbidden_import_would_be_caught(self):
        root = self.sample_tree({"anything.py": "from orion.mac import inference_ledger\n"})
        self.assertTrue(any("orion.mac" in error for error in import_errors(root)))

    def test_local_listener_exception_does_not_allow_outbound_clients(self):
        root = self.sample_tree({"adapters/local_today.py": "from http.server import HTTPServer\n"})
        self.assertEqual(import_errors(root), [])
        for source in ("import http.client\n", "import urllib.request\n", "import socket\n"):
            (root / "adapters/local_today.py").write_text(source)
            self.assertTrue(import_errors(root))
        (root / "adapters/local_today.py").unlink()
        (root / "other.py").write_text("from http.server import HTTPServer\n")
        self.assertTrue(import_errors(root))

    def test_only_the_egress_guard_may_reach_the_network(self):
        # Any other module importing an HTTP client is a fetch that never passed
        # the SSRF guard -- the one way that invariant reopens without anybody
        # editing the guard.
        root = self.sample_tree({"connectors/fetch.py": "import urllib.request\n"})
        self.assertTrue(any("only egress.py may reach the network" in error
                            for error in import_errors(root)), import_errors(root))
        allowed = self.sample_tree({"egress.py": "from urllib.parse import urlsplit\n"})
        self.assertEqual(import_errors(allowed), [])

    def test_a_cross_module_import_would_be_caught(self):
        # The check reads real import statements, so over the real tree it starts
        # trivially true and becomes load-bearing the moment module code appears.
        root = self.sample_tree(
            {"gmail/reader.py": "from backend.health import state\n"}
        )
        errors = import_errors(root)
        self.assertTrue(any("gmail imports health" in error for error in errors), errors)

    def test_a_declared_dependency_is_allowed(self):
        root = self.sample_tree(
            {"planning/day.py": "from backend.health import state\n"}
        )
        self.assertEqual(import_errors(root), [])


class EnvironmentTests(unittest.TestCase):
    def test_three_environments_exist(self):
        self.assertEqual({item.value for item in Environment}, {"dev", "staging", "production"})
        self.assertEqual(len(CONFIGURATIONS), 3)

    def test_no_two_environments_share_anything(self):
        self.assertEqual(separation_errors(), [])
        for field in SEPARATED_FIELDS:
            values = [getattr(config, field) for config in CONFIGURATIONS.values()]
            self.assertEqual(len(set(values)), 3, field)

    def test_a_shared_database_would_be_found(self):
        shared = dict(CONFIGURATIONS)
        shared[Environment.STAGING] = EnvironmentConfig(
            environment=Environment.STAGING, database="orion_production",
            secret_scope="orion/staging", credential_namespace="orion.staging",
            oauth_app="orion-staging", apns_environment="sandbox",
        )
        self.assertTrue(separation_errors(shared))

    def test_only_production_uses_production_apns(self):
        for environment, config in CONFIGURATIONS.items():
            expected = "production" if environment is Environment.PRODUCTION else "sandbox"
            self.assertEqual(config.apns_environment, expected, environment)
        with self.assertRaises(ValueError):
            EnvironmentConfig(
                environment=Environment.DEV, database="d", secret_scope="s",
                credential_namespace="c", oauth_app="o", apns_environment="production",
            )

    def test_a_local_runtime_cannot_resolve_a_production_secret(self):
        for environment in (Environment.DEV, Environment.STAGING):
            with self.assertRaises(ProductionSecretRefused):
                resolve_secret_reference("orion/production/database-password", environment=environment)

    def test_a_runtime_can_only_reach_its_own_scope(self):
        self.assertEqual(
            resolve_secret_reference("orion/dev/database-password", environment=Environment.DEV),
            "orion/dev/database-password",
        )
        with self.assertRaises(ProductionSecretRefused):
            resolve_secret_reference("orion/staging/database-password", environment=Environment.DEV)

    def test_resolution_returns_a_reference_not_a_value(self):
        # Anything that could return a secret value eventually gets asked to log
        # one. The secret store resolves; this decides whether it may.
        reference = resolve_secret_reference("orion/dev/api-token", environment="dev")
        self.assertEqual(scope_of(reference), config_for("dev").secret_scope)

    def test_the_production_refusal_names_production(self):
        # Two branches guard this; without a test for the first, the message a
        # developer sees would come from the generic one and the specific branch
        # would be dead code wearing the requirement's name.
        with self.assertRaises(ProductionSecretRefused) as refusal:
            resolve_secret_reference("orion/production/api-token", environment=Environment.DEV)
        self.assertIn("may not resolve orion/production/api-token", str(refusal.exception))
        with self.assertRaises(ProductionSecretRefused) as other:
            resolve_secret_reference("orion/staging/api-token", environment=Environment.DEV)
        self.assertIn("may only resolve", str(other.exception))

    def test_a_malformed_reference_is_refused(self):
        with self.assertRaises(ValueError):
            scope_of("just-a-name")


class RouteTableTests(unittest.TestCase):
    def test_the_declared_table_is_valid(self):
        self.assertEqual(route_errors(), [])
        self.assertTrue(ROUTES)

    def test_no_route_takes_an_owner_from_the_path(self):
        for route in ROUTES:
            for parameter in FORBIDDEN_PATH_PARAMETERS:
                self.assertNotIn(parameter, route.path, route.path)

    def test_a_user_id_in_a_path_is_refused(self):
        errors = route_errors([Route("GET", "/users/{user_id}/tasks", "tasks", "list_tasks")])
        self.assertTrue(any("ownership comes from the session" in error for error in errors))

    def test_every_mutating_route_is_owner_scoped_and_audited(self):
        for route in ROUTES:
            if route.method in MUTATING and route.path != "/auth/session":
                self.assertTrue(route.owner_scoped, route.path)
                self.assertTrue(route.audited, route.path)

    def test_a_route_must_name_an_operation_its_module_offers(self):
        errors = route_errors([Route("GET", "/tasks", "tasks", "delete_everything")])
        self.assertTrue(any("does not offer" in error for error in errors))

    def test_an_unaudited_or_unscoped_mutation_is_refused(self):
        for route, expected in (
            (Route("POST", "/tasks", "tasks", "create_task", audited=False), "without an audit record"),
            (Route("POST", "/tasks", "tasks", "create_task", owner_scoped=False), "without an owner"),
            (Route("GET", "/jobs", "jobs", "submit_job"), "may not name a mutating operation"),
            (Route("GET", "/audit", "audit", "read_trail", requires_session=False), "is unauthenticated"),
        ):
            errors = route_errors([route])
            self.assertTrue(any(expected in error for error in errors), (route.path, errors))

    def test_the_liveness_probe_is_the_only_route_without_a_module(self):
        self.assertTrue(any(route.path == "/health" and not route.module for route in ROUTES))
        errors = route_errors([Route("GET", "/secret", "", "liveness",
                                     requires_session=False, owner_scoped=False, audited=False)])
        self.assertTrue(any("only an unauthenticated" in error for error in errors))

    def test_only_the_health_check_is_unauthenticated_for_reads(self):
        unauthenticated = [route.path for route in ROUTES if not route.requires_session]
        self.assertEqual(sorted(unauthenticated), ["/auth/session", "/health"])


class WorkerTests(unittest.TestCase):
    def test_the_job_sweep_has_an_owner_at_last(self):
        # Phase 8 ended with "sweep(now) needs an owner". This is it.
        self.assertEqual(worker_errors(), [])
        sweep = next(task for task in PERIODIC if task.name == "sweep_jobs")
        self.assertEqual(sweep.module, "jobs")
        self.assertFalse(sweep.skippable)

    def test_losing_the_sweep_is_an_error(self):
        errors = worker_errors([task for task in PERIODIC if task.name != "sweep_jobs"])
        self.assertTrue(any("leases would never expire" in error for error in errors))

    def test_every_periodic_task_names_a_real_module(self):
        for task in PERIODIC:
            self.assertIn(task.module, MODULES, task.name)

    def test_an_interval_must_be_positive(self):
        with self.assertRaises(ValueError):
            PeriodicTask("bad", "jobs", 0, "Runs never.", skippable=True)


class AdapterTests(unittest.TestCase):
    def test_the_suite_does_not_need_fastapi(self):
        # The import is inside build_app precisely so this file can exist in a
        # repository whose Python has no third-party dependencies.
        source = ast.parse((REPO_ROOT / "backend/adapters/fastapi_app.py").read_text(encoding="utf-8"))
        top_level = [
            name.name
            for node in source.body
            if isinstance(node, (ast.Import, ast.ImportFrom))
            for name in getattr(node, "names", [])
        ]
        self.assertNotIn("fastapi", [item.split(".")[0] for item in top_level])

    def test_binding_without_fastapi_fails_loudly(self):
        try:
            import fastapi  # noqa: F401
        except ImportError:
            with self.assertRaises(FastAPIUnavailable):
                build_app({(route.method, route.path): None for route in ROUTES})
        else:  # pragma: no cover -- only if somebody installs it
            self.skipTest("FastAPI is installed in this environment")

    def test_handlers_must_match_the_route_table(self):
        with self.assertRaises(ValueError):
            build_app({("GET", "/nonexistent"): None})


if __name__ == "__main__":
    unittest.main()
