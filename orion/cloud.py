from __future__ import annotations

import json
import os
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


def configured_value(name: str, project_root: Path) -> str | None:
    """Read only a requested configuration value; never log or return unrelated secrets."""
    if value := os.environ.get(name):
        return value
    env_file = project_root / ".env"
    if not env_file.exists():
        return None
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        if key.strip() == name:
            return value.strip().strip('"').strip("'") or None
    return None


# USD per million tokens. Update when Anthropic changes list pricing.
# Source: Anthropic API pricing, July 2026.
PRICES: dict[str, tuple[float, float]] = {
    "claude-haiku-4-5-20251001": (1.0, 5.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-opus-5": (5.0, 25.0),
    "claude-fable-5": (10.0, 50.0),
}
DEFAULT_PRICE = (3.0, 15.0)


def estimate_cost(model: str, usage: dict) -> float:
    price_in, price_out = PRICES.get(model, DEFAULT_PRICE)
    tokens_in = int(usage.get("input_tokens", 0)) + int(usage.get("cache_read_input_tokens", 0))
    tokens_out = int(usage.get("output_tokens", 0))
    return (tokens_in * price_in + tokens_out * price_out) / 1_000_000


class AnthropicProvider:
    """Anthropic Messages client normalized to Orion's provider contract.

    Both this and OllamaProvider return the same shape, so the agent loop never
    needs to know which tier answered:
        {"message": {"role", "content", "tool_calls": [...]}, "usage": {...}}
    """

    def __init__(self, api_key: str, model: str) -> None:
        self.api_key = api_key
        self.model = model

    @staticmethod
    def _to_anthropic(messages: list[dict]) -> tuple[str, list[dict]]:
        system = "\n".join(str(m["content"]) for m in messages if m.get("role") == "system")
        converted: list[dict] = []
        for message in messages:
            role = message.get("role")
            if role == "system":
                continue
            if role == "tool":
                converted.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": message.get("tool_call_id") or message.get("tool_name", "tool"),
                                "content": str(message.get("content", "")),
                            }
                        ],
                    }
                )
                continue
            if role == "assistant" and message.get("tool_calls"):
                blocks: list[dict] = []
                if text := (message.get("content") or "").strip():
                    blocks.append({"type": "text", "text": text})
                for call in message["tool_calls"]:
                    function = call.get("function", {})
                    blocks.append(
                        {
                            "type": "tool_use",
                            "id": call.get("id") or function.get("name", "tool"),
                            "name": function.get("name", ""),
                            "input": function.get("arguments") or {},
                        }
                    )
                converted.append({"role": "assistant", "content": blocks})
                continue
            if content := (message.get("content") or "").strip():
                converted.append({"role": role, "content": content})
        return system, converted

    def chat(self, messages: list[dict], tools: list[dict] | None = None) -> dict:
        system, conversation = self._to_anthropic(messages)
        payload: dict[str, Any] = {
            "model": self.model,
            "max_tokens": 4096,
            "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}] if system else [],
            "messages": conversation,
        }
        if tools:
            payload["tools"] = [
                {
                    "name": tool["function"]["name"],
                    "description": tool["function"].get("description", ""),
                    "input_schema": tool["function"].get("parameters", {"type": "object", "properties": {}}),
                }
                for tool in tools
            ]
        request = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps(payload).encode(),
            headers={
                "content-type": "application/json",
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
            },
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            result = json.load(response)

        text_parts, tool_calls = [], []
        for block in result.get("content", []):
            if block.get("type") == "text":
                text_parts.append(block.get("text", ""))
            elif block.get("type") == "tool_use":
                tool_calls.append(
                    {"id": block.get("id"), "function": {"name": block.get("name"), "arguments": block.get("input", {})}}
                )
        message: dict[str, Any] = {"role": "assistant", "content": "".join(text_parts)}
        if tool_calls:
            message["tool_calls"] = tool_calls
        return {"message": message, "usage": result.get("usage", {}), "model": self.model}


@dataclass(frozen=True)
class RoutingDecision:
    tier: str  # "local" | "fast" | "deep"
    reason: str


class ModelRouter:
    """Chooses the cheapest tier that can plausibly do the job.

    The old router treated local as the default and cloud as an exception. That
    is backwards for a general assistant: a 20B local model is excellent at
    picking tools and terrible at open-ended reasoning. So local now handles
    what it is actually good at, and anything conversational goes to Haiku,
    which costs about a tenth of a cent per exchange.
    """

    DEEP_SIGNALS = (
        "write code", "debug", "refactor", "architecture", "prove", "derive",
        "analyze", "compare in detail", "research", "essay", "step by step",
        "why does", "explain how", "design a",
    )

    def __init__(self, enabled: bool, fast_model: str | None, deep_model: str | None, budget_usd: float = 15.0) -> None:
        self.enabled = enabled
        self.fast_model = fast_model
        self.deep_model = deep_model
        self.budget_usd = budget_usd

    def decide(self, user_text: str, spent_this_month: float = 0.0, local_failed: bool = False) -> RoutingDecision:
        if not self.enabled or not self.fast_model:
            return RoutingDecision("local", "cloud is disabled; running fully local")
        if spent_this_month >= self.budget_usd:
            return RoutingDecision("local", f"monthly budget of ${self.budget_usd:.2f} is spent; staying local")

        lowered = user_text.lower()
        if local_failed:
            return RoutingDecision("fast", "the local model failed to produce a usable answer")
        long_request = len(user_text) > 700
        if self.deep_model and (long_request or any(signal in lowered for signal in self.DEEP_SIGNALS)):
            return RoutingDecision("deep", "the request needs sustained reasoning")
        return RoutingDecision("fast", "normal conversation")


# Backwards-compatible alias for the previous name.
CloudRouter = ModelRouter
