import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from orion.provider import OllamaProvider
from orion.runtime import OrionRuntime


class LocalModelDefaultTests(unittest.TestCase):
    """The local model is the resident qwen3.5:9b (2026-10-16), loaded once at one context size and kept."""

    def test_the_provider_defaults_to_the_resident_model(self):
        self.assertEqual(OllamaProvider().model, "qwen3.5:9b")

    def test_the_runtime_defaults_to_it_too(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch("orion.runtime.configured_value", return_value=None):
                runtime = OrionRuntime(Path(directory) / "data" / "orion.db")
            self.assertEqual(runtime.provider.model, "qwen3.5:9b")
            runtime.store.close()

    def test_the_chat_request_matches_the_resident_load(self):
        sent = {}

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def read(self):
                return b"{}"

        def fake_urlopen(request, timeout=0):
            sent.update(json.loads(request.data))
            return Response()

        with patch("orion.provider.urllib.request.urlopen", fake_urlopen), patch("orion.provider.json.load", return_value={}):
            OllamaProvider().chat([{"role": "user", "content": "hi"}], [])
        self.assertEqual(sent["model"], "qwen3.5:9b")
        self.assertEqual(sent["think"], False)
        self.assertEqual(sent["keep_alive"], "24h")
        self.assertEqual(sent["options"]["num_ctx"], 32768)


if __name__ == "__main__":
    unittest.main()
