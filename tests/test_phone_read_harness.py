import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("phone_read_check", Path(__file__).resolve().parents[1] / "scripts/orion_v2_phone_read_check.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BootstrapCleanupTests(unittest.TestCase):
    def test_cleanup_preserves_unknown_or_malformed_files(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bootstrap.json"
            for content in ('{', '[]', 'null', '{"token":"someone-else"}'):
                path.write_text(content)
                self.assertFalse(module.remove_matching_bootstrap(path, "fixture-grant"))
                self.assertEqual(path.read_text(), content)
            path.write_text('{"token":"fixture-grant"}')
            self.assertTrue(module.remove_matching_bootstrap(path, "fixture-grant"))
            self.assertFalse(path.exists())
            self.assertFalse(module.remove_matching_bootstrap(path, "fixture-grant"))
