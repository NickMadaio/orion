from __future__ import annotations

import importlib.util
import tempfile
import unittest
import urllib.error
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "orion_v2_anthropic_key_status",
    REPO_ROOT / "scripts" / "orion_v2_anthropic_key_status.py",
)
assert SPEC is not None and SPEC.loader is not None
status_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(status_module)


class Response:
    def __init__(self, status):
        self.status = status

    def close(self):
        return None


class AnthropicKeyStatusTests(unittest.TestCase):
    def test_reads_quoted_key(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text('OTHER=x\nANTHROPIC_API_KEY="private-value"\n', encoding="utf-8")
            self.assertEqual(status_module.read_env_key(path), "private-value")

    def test_classifies_only_authoritative_statuses(self):
        self.assertEqual(status_module.classify_status(200), "valid")
        self.assertEqual(status_module.classify_status(401), "invalid")
        self.assertEqual(status_module.classify_status(403), "accepted_limited")
        self.assertEqual(status_module.classify_status(429), "accepted_limited")
        self.assertEqual(status_module.classify_status(500), "unverified")

    def test_http_error_body_is_never_read(self):
        def rejected(request, timeout):
            raise urllib.error.HTTPError(request.full_url, 401, "secret response", {}, None)

        self.assertEqual(status_module.check_key("private-value", rejected), "invalid")

    def test_success_body_is_never_read(self):
        self.assertEqual(
            status_module.check_key(
                "private-value", lambda request, timeout: Response(200)
            ),
            "valid",
        )


if __name__ == "__main__":
    unittest.main()
