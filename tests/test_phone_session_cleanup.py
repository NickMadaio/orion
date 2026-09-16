import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from scripts.orion_phone_session_scenario import cleanup_session_files

class PhoneSessionCleanupTests(unittest.TestCase):
    def test_all_observed_containers_cleaned_when_current_lookup_fails(self):
        with tempfile.TemporaryDirectory() as root:
            directories = [Path(root)/name for name in ('A','B','C')]
            for directory in directories:
                directory.mkdir()
                (directory/'request.json').write_text(json.dumps({'challenge':'our-challenge'}))
                (directory/'local-today.json').write_text(json.dumps({'token':'our-fixture-token'}))
                (directory/'other.json').write_text(json.dumps({'challenge':'other-challenge'}))
            def missing(): raise subprocess.CalledProcessError(1, 'simctl')
            cleanup_session_files(directories, missing, ('request.json','other.json'), 'our-challenge','our-fixture-token')
            for directory in directories:
                self.assertFalse((directory/'request.json').exists())
                self.assertFalse((directory/'local-today.json').exists())
                self.assertTrue((directory/'other.json').exists())

    def test_current_container_added_and_unrelated_token_preserved(self):
        with tempfile.TemporaryDirectory() as root:
            current = Path(root)
            (current/'response.json').write_text(json.dumps({'challenge':'our-challenge'}))
            (current/'local-today.json').write_text(json.dumps({'token':'unrelated-fixture-token'}))
            cleanup_session_files([], lambda:current, ('response.json',), 'our-challenge','our-fixture-token')
            self.assertFalse((current/'response.json').exists())
            self.assertTrue((current/'local-today.json').exists())

class HTTPBootstrapCleanupTests(unittest.TestCase):
    def test_every_observed_container_cleaned_on_lookup_failure(self):
        from scripts.orion_phone_http_session_scenario import cleanup_http_bootstraps
        with tempfile.TemporaryDirectory() as root:
            folders = [Path(root)/name for name in ('initial','intermediate')]
            for folder in folders:
                folder.mkdir()
                (folder/'http-session-bootstrap.json').write_text(json.dumps({'token':'our-grant'}))
                (folder/'local-today.json').write_text(json.dumps({'token':'other-token'}))
            def missing(): raise subprocess.CalledProcessError(1,'simctl')
            cleanup_http_bootstraps(folders,missing,'our-grant','our-legacy-token')
            for folder in folders:
                self.assertFalse((folder/'http-session-bootstrap.json').exists())
                self.assertTrue((folder/'local-today.json').exists())
