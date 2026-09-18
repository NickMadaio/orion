"""The deployment candidate, not the previous installation, must pass deferral review."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class DeferredCandidateTests(unittest.TestCase):
    def check(self, catalog):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path/'package.json').write_text('{"type":"module"}')
            if catalog is not None:
                (path/'catalog.js').write_text(catalog)
            return subprocess.run(['python3', str(ROOT/'scripts/orion_v2_deferred_check.py')],
                env=dict(os.environ, ORION_CATALOG_DIST=str(path)), capture_output=True, text=True)

    def test_safe_candidate(self):
        result = self.check('export const ACTION_CATALOG={email_send:{execution:{kind:"simulate"}}};')
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_candidate_purchase_cannot_hide_behind_installed_catalog(self):
        result = self.check('export const ACTION_CATALOG={email_send:{execution:{kind:"simulate"}},place_order:{execution:{kind:"simulate"}}};')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('purchas', result.stdout)

    def test_real_email_send_refused(self):
        result = self.check('export const ACTION_CATALOG={email_send:{execution:{kind:"send"}}};')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('email_send', result.stdout)

    def test_missing_and_malformed_candidates_refuse(self):
        for catalog in [None, 'not javascript']:
            with self.subTest(catalog=catalog):
                self.assertNotEqual(self.check(catalog).returncode, 0)
