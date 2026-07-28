from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any


PLAN_TOOL = {
    "type": "function",
    "function": {
        "name": "submit_action_plan",
        "description": "Return the smallest safe, ordered plan for the user’s request. Never invent paths, permissions, or external side effects.",
        "parameters": {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "actions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "kind": {"type": "string", "enum": ["create_folder", "move_path", "write_file", "delete_path", "start_timer", "ask_clarification"], "description": "Required exact action name. Do not use type instead."},
                            "workspace": {"type": "string", "enum": ["desktop", "sandbox"], "description": "Required for file actions. Use desktop for the user's Desktop."},
                            "path": {"type": "string", "description": "Relative path only, such as vaedyn/aaron. Never use /Users, ~, or a username."},
                            "source": {"type": "string"},
                            "destination": {"type": "string"},
                            "content": {"type": "string"},
                            "seconds": {"type": "integer"},
                            "label": {"type": "string"},
                            "question": {"type": "string"},
                        },
                        "required": ["kind"],
                    },
                },
            },
            "required": ["summary", "actions"],
        },
    },
}

PLANNER_PROMPT = """You are Orion’s local action planner. Convert the user’s request into a minimal ordered action plan.

Standing permissions:
- Desktop and Orion sandbox: create folders and move or rename paths are automatic when exact paths are clear.
- Timers are automatic, but must use the native Mac Clock bridge.
- Writing or changing existing files, deletion, system settings, installs, account access, network actions, and bulk changes require conversational approval.
- Every file action must include `kind`, `workspace`, and a relative path. For example, create a Desktop folder vaedyn/aaron with `{kind: create_folder, workspace: desktop, path: vaedyn/aaron}`.
- Never output `/Users/...`, `~`, a username, or any absolute path. If a needed path, duration, or target is unclear, return one ask_clarification action instead of guessing.

Return submit_action_plan only. Do not describe a plan in prose and do not claim execution occurred."""


@dataclass(frozen=True)
class PlannedAction:
    kind: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ActionPlan:
    summary: str
    actions: list[PlannedAction]


class PlanError(ValueError):
    pass


class LocalPlanner:
    """Provider-independent structured planner; execution remains outside the model."""

    def __init__(self, provider: Any) -> None:
        self.provider = provider

    def plan(self, user_request: str) -> ActionPlan | None:
        response = self.provider.chat(
            [{"role": "system", "content": PLANNER_PROMPT}, {"role": "user", "content": user_request}], [PLAN_TOOL]
        )
        calls = response.get("message", {}).get("tool_calls") or []
        if not calls:
            return None
        function = calls[0].get("function", {})
        if function.get("name") != "submit_action_plan":
            return None
        arguments = function.get("arguments") or {}
        if isinstance(arguments, str):
            arguments = json.loads(arguments)
        return self._validate(arguments)

    @staticmethod
    def _validate(payload: dict[str, Any]) -> ActionPlan:
        summary = str(payload.get("summary") or "").strip()
        raw_actions = payload.get("actions")
        if not summary or not isinstance(raw_actions, list) or not raw_actions:
            raise PlanError("The planner returned an incomplete action plan.")
        actions: list[PlannedAction] = []
        valid = {"create_folder", "move_path", "write_file", "delete_path", "start_timer", "ask_clarification"}
        for raw in raw_actions:
            if not isinstance(raw, dict):
                raise PlanError("The planner returned an unsupported action.")
            raw = dict(raw)
            # GPT-OSS occasionally returns `type` despite the tool schema. Accept
            # that harmless alias, but retain the strict action allowlist below.
            if "kind" not in raw and "type" in raw:
                raw["kind"] = raw.pop("type")
            if raw.get("kind") not in valid:
                raise PlanError("The planner returned an unsupported action.")
            kind = str(raw["kind"])
            arguments = {key: value for key, value in raw.items() if key != "kind" and value is not None}
            workspace = str(arguments.get("workspace") or "desktop")
            if kind in {"create_folder", "write_file", "delete_path", "move_path"}:
                arguments["workspace"] = workspace
                for field in ("path", "source", "destination"):
                    if not isinstance(arguments.get(field), str):
                        continue
                    value = arguments[field].replace("\\", "/")
                    desktop_marker = "/Desktop/"
                    if value.startswith("/") and desktop_marker in value:
                        value = value.split(desktop_marker, 1)[1]
                        arguments["workspace"] = "desktop"
                    if value.startswith("/") or value.startswith("~") or ".." in value.split("/"):
                        raise PlanError("The planner returned a path outside Orion's permitted workspace.")
                    arguments[field] = value.strip("/")
            if kind == "create_folder" and not isinstance(arguments.get("path"), str):
                raise PlanError("A folder action needs a path.")
            if kind == "move_path" and not all(isinstance(arguments.get(key), str) for key in ("source", "destination")):
                raise PlanError("A move action needs source and destination paths.")
            if kind == "start_timer" and not isinstance(arguments.get("seconds"), int):
                raise PlanError("A timer action needs a duration in seconds.")
            if kind == "ask_clarification" and not isinstance(arguments.get("question"), str):
                raise PlanError("A clarification action needs a question.")
            actions.append(PlannedAction(kind, arguments))
        return ActionPlan(summary, actions)
