from __future__ import annotations

import json
import os
import urllib.request
from dataclasses import dataclass
from pathlib import Path


def configured_value(name: str, project_root: Path) -> str | None:
    """Read only a requested configuration value; never log or return unrelated secrets."""
    if value := os.environ.get(name):
        return value
    env_file = project_root / ".env"
    if not env_file.exists():
        return None
    for line in env_file.read_text().splitlines():
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip().strip('"')
    return None


class AnthropicProvider:
    """Minimal Anthropic Messages client behind Orion's provider boundary."""

    def __init__(self, api_key: str, model: str) -> None:
        self.api_key = api_key
        self.model = model

    def chat(self, messages: list[dict]) -> dict:
        system = "\n".join(str(item["content"]) for item in messages if item.get("role") == "system")
        conversation = [{"role": item["role"], "content": item["content"]} for item in messages if item.get("role") in {"user", "assistant"}]
        body = json.dumps({"model": self.model, "max_tokens": 2048, "system": system, "messages": conversation}).encode()
        request = urllib.request.Request(
            "https://api.anthropic.com/v1/messages", data=body,
            headers={"content-type": "application/json", "x-api-key": self.api_key, "anthropic-version": "2023-06-01"},
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.load(response)
        text = "".join(block.get("text", "") for block in result.get("content", []) if block.get("type") == "text")
        return {"message": {"role": "assistant", "content": text or "I could not generate a response."}, "usage": result.get("usage", {})}


@dataclass(frozen=True)
class RoutingDecision:
    use_cloud: bool
    requires_approval: bool
    reason: str


class CloudRouter:
    def __init__(self, enabled: bool, model: str | None) -> None:
        self.enabled = enabled
        self.model = model

    def decide(self, user_text: str, local_failed: bool = False) -> RoutingDecision:
        if not self.enabled or not self.model:
            return RoutingDecision(False, False, "local-first routing is active")
        high_tier = any(name in self.model.lower() for name in ("opus", "max"))
        if high_tier:
            return RoutingDecision(False, True, "the configured cloud tier requires approval")
        difficult = len(user_text) > 900 or any(term in user_text.lower() for term in ("research", "compare", "analyze", "multi-step", "complex"))
        return RoutingDecision(local_failed or difficult, False, "local model failed" if local_failed else "task complexity")
