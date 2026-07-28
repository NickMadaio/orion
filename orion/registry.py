from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class RegisteredTool:
    name: str
    handler: Callable[..., dict]
    permission_level: int
    timeout_seconds: int


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

    def names(self) -> list[str]:
        return sorted(self._tools)
