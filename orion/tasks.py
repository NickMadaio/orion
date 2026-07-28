from __future__ import annotations

from dataclasses import dataclass

from .store import Store


TERMINAL_STATES = {"completed", "failed", "cancelled"}
VALID_TRANSITIONS = {
    "created": {"planning", "cancelled"},
    "planning": {"running", "waiting_for_approval", "failed", "cancelled"},
    "waiting_for_approval": {"running", "cancelled"},
    "running": {"waiting_for_external_input", "completed", "failed", "cancelled"},
    "waiting_for_external_input": {"running", "cancelled", "failed"},
}


@dataclass(frozen=True)
class Task:
    id: int
    title: str
    state: str = "created"


class TaskManager:
    """Persistent task state and approval boundaries for every multi-step action."""

    def __init__(self, store: Store) -> None:
        self.store = store

    def create(self, title: str) -> Task:
        return Task(self.store.create_task(title), title)

    def transition(self, task: Task, current: str, next_state: str, **detail: object) -> str:
        if current in TERMINAL_STATES or next_state not in VALID_TRANSITIONS.get(current, set()):
            raise ValueError(f"Invalid task transition: {current} → {next_state}")
        self.store.update_task(task.id, next_state)
        self.store.add_task_event(task.id, "state_changed", {"from": current, "to": next_state, **detail})
        return next_state

    def request_approval(self, task: Task, summary: str, payload: dict) -> int:
        self.store.add_task_event(task.id, "approval_requested", {"summary": summary})
        return self.store.request_approval(task.id, summary, payload)

    def cancel(self, task: Task, current: str) -> str:
        return self.transition(task, current, "cancelled")
