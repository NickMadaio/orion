from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from .planner import ActionPlan, PlannedAction


@dataclass(frozen=True)
class ExecutionResult:
    answer: str
    automatic_actions: list[dict]
    approval_actions: list[dict]
    clarification: str | None = None


class PlanExecutor:
    """Deterministic policy boundary between a model's plan and real computer tools."""

    def __init__(self, path_exists: Callable[[str, str], bool]) -> None:
        self.path_exists = path_exists

    def classify(self, plan: ActionPlan) -> ExecutionResult:
        automatic: list[dict] = []
        approval: list[dict] = []
        for action in plan.actions:
            result = self._classify(action)
            if result.get("kind") == "clarification":
                return ExecutionResult(result["question"], automatic, approval, result["question"])
            (automatic if result.pop("permission") == "automatic" else approval).append(result)
        answer = "I prepared the requested change."
        return ExecutionResult(answer, automatic, approval)

    def _classify(self, action: PlannedAction) -> dict:
        args = action.arguments
        workspace = str(args.get("workspace") or "desktop")
        if workspace not in {"desktop", "sandbox"}:
            return {"kind": "clarification", "question": "Which permitted workspace should I use?"}
        if action.kind == "ask_clarification":
            return {"kind": "clarification", "question": str(args["question"])}
        if action.kind == "create_folder":
            return {"kind": "mkdir", "path": str(args["path"]), "workspace": workspace, "permission": "automatic"}
        if action.kind == "move_path":
            return {"kind": "move", "source": str(args["source"]), "destination": str(args["destination"]), "workspace": workspace, "permission": "automatic"}
        if action.kind == "start_timer":
            return {"kind": "native_timer", "seconds": int(args["seconds"]), "label": str(args.get("label") or "Orion timer"), "permission": "automatic"}
        if action.kind == "write_file":
            path = str(args["path"])
            permission = "approval" if self.path_exists(workspace, path) else "automatic"
            return {"kind": "write", "path": path, "content": str(args.get("content") or ""), "workspace": workspace, "permission": permission}
        if action.kind == "delete_path":
            return {"kind": "delete", "path": str(args["path"]), "workspace": workspace, "permission": "approval"}
        return {"kind": "clarification", "question": "I need a clearer local action before I can continue."}
