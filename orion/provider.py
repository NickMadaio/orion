from __future__ import annotations

import json
import urllib.request


class OllamaProvider:
    """Small provider boundary; later providers implement the same chat contract."""

    def __init__(self, model: str = "qwen3.5:9b", endpoint: str = "http://127.0.0.1:11434") -> None:
        self.model = model
        self.endpoint = endpoint.rstrip("/")

    def chat(self, messages: list[dict], tools: list[dict]) -> dict:
        body = json.dumps(
            {
                "model": self.model,
                "messages": messages,
                "tools": tools,
                "stream": False,
                # The resident model: same context and keep-alive as every other caller, so Ollama never reloads it.
                "think": False,
                "keep_alive": "24h",
                "options": {"num_ctx": 32768},
            }
        ).encode()
        request = urllib.request.Request(
            f"{self.endpoint}/api/chat", data=body, headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                return json.load(response)
        except Exception as error:
            raise RuntimeError(
                "Orion could not reach Ollama. Open the Ollama app, confirm qwen3.5:9b is installed, and try again."
            ) from error
