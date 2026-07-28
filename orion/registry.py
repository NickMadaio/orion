from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass(frozen=True)
class RegisteredTool:
    """One Orion capability plus the safety policy that governs it.

    `parameters` is a JSON Schema object. The registry builds the model-facing
    tool schema from it, so registering a tool is the *only* step needed to make
    it available to every provider. Nothing should hand-write a schema again.
    """

    name: str
    handler: Callable[..., dict]
    permission_level: int
    timeout_seconds: int
    description: str = ""
    parameters: dict[str, Any] = field(default_factory=lambda: {"type": "object", "properties": {}})

    def schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


class ToolRegistry:
    """The single registration point for Orion capabilities and their safety policy."""

    def __init__(self) -> None:
        self._tools: dict[str, RegisteredTool] = {}

    def register(self, tool: RegisteredTool) -> None:
        if tool.name in self._tools:
            raise ValueError(f"Tool already registered: {tool.name}")
        self._tools[tool.name] = tool

    def get(self, name: str) -> RegisteredTool:
        return self._tools[name]

    def has(self, name: str) -> bool:
        return name in self._tools

    def names(self) -> list[str]:
        return sorted(self._tools)

    def schemas(self, max_permission_level: int = 0) -> list[dict[str, Any]]:
        """Model-facing tool list.

        Only tools at or below `max_permission_level` are exposed. Level 0 is
        read-only and safe to call without asking. Anything that changes state
        goes through the planner/executor approval path instead of being handed
        to the model as a directly callable tool.
        """
        return [
            self._tools[name].schema()
            for name in self.names()
            if self._tools[name].permission_level <= max_permission_level
        ]
