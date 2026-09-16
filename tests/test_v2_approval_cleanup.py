import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from scripts.orion_v2_phone_pairing_check import cleanup_pairing_files

class ApprovalCleanupTests(unittest.TestCase):
    def test_container_failure_still_cleans_known_files_and_preserves_other_requests(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'request.json').write_text(json.dumps({'pairingID': 'owned-request'}))
            (root/'other.json').write_text(json.dumps({'pairingID': 'unrelated-request'}))
            def unavailable(): raise subprocess.CalledProcessError(1, 'simctl')
            cleanup_pairing_files(root, unavailable, ('request.json','other.json'), 'owned-request')
            self.assertFalse((root/'request.json').exists())
            self.assertTrue((root/'other.json').exists())
