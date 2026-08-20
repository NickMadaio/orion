from __future__ import annotations

import ast
import importlib.util
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
BOUNDARY_ROOTS = (
    REPO_ROOT / "orion/core",
    REPO_ROOT / "orion/shared",
    REPO_ROOT / "orion/security",
)
FORBIDDEN_IMPORT_ROOTS = {
    "AppKit",
    "Foundation",
    "EventKit",
    "HealthKit",
    "Security",
    "SwiftUI",
    "anthropic",
    "ctypes",
    "deepgram",
    "elevenlabs",
    "http",
    "ollama",
    "openclaw",
    "os",
    "pathlib",
    "requests",
    "socket",
    "sqlite3",
    "subprocess",
    "urllib",
}
FORBIDDEN_QUALIFIED_IMPORTS = {
    "orion.mac_bridge",
    "orion.server",
    "orion.tools",
}


def imported_names(tree: ast.AST) -> list[tuple[int, str]]:
    names: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.extend((node.lineno, alias.name) for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.append((node.lineno, node.module))
        elif isinstance(node, ast.Call) and node.args:
            function = node.func
            dynamic_import = (
                isinstance(function, ast.Name) and function.id == "__import__"
            ) or (
                isinstance(function, ast.Attribute)
                and function.attr == "import_module"
                and isinstance(function.value, ast.Name)
                and function.value.id == "importlib"
            )
            if dynamic_import and isinstance(node.args[0], ast.Constant):
                value = node.args[0].value
                if isinstance(value, str):
                    names.append((node.lineno, value))
    return names


def import_violations(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    violations: list[str] = []
    for line, name in imported_names(tree):
        root = name.split(".", 1)[0]
        if root in FORBIDDEN_IMPORT_ROOTS or any(
            name == forbidden or name.startswith(f"{forbidden}.")
            for forbidden in FORBIDDEN_QUALIFIED_IMPORTS
        ):
            violations.append(f"{path.relative_to(REPO_ROOT)}:{line}: {name}")
    return violations


class V2ImportBoundaryTests(unittest.TestCase):
    def test_core_shared_and_security_import_firewall(self):
        violations: list[str] = []
        for root in BOUNDARY_ROOTS:
            self.assertTrue(root.is_dir(), f"missing boundary package: {root}")
            for path in sorted(root.rglob("*.py")):
                violations.extend(import_violations(path))
        self.assertEqual(violations, [])

    def test_firewall_detects_static_and_dynamic_imports(self):
        fixture = ast.parse(
            "import subprocess\n"
            "from orion.server import OrionServer\n"
            "importlib.import_module('anthropic.client')\n"
        )
        names = {name for _, name in imported_names(fixture)}
        self.assertEqual(
            names,
            {"subprocess", "orion.server", "anthropic.client"},
        )

    def test_legacy_cloud_module_is_not_shadowed_by_a_package(self):
        spec = importlib.util.find_spec("orion.cloud")
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.origin)
        self.assertEqual(Path(spec.origin).resolve(), REPO_ROOT / "orion/cloud.py")


if __name__ == "__main__":
    unittest.main()
