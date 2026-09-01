"""The seventeen backend modules, declared with something to check.

Phase 1 recorded the rule this file exists to respect: "Empty packages are not a
milestone." Seventeen empty directories would satisfy "create backend modules"
and mean nothing -- no boundary could be checked against them, and the first
implementation would wire whatever it liked.

So each module declares what it owns, what it may depend on, how sensitive its
data is, and what it offers. `boundaries.py` checks the graph, and checks any
implementation file that later appears against these declarations.
"""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping

from orion.shared.result import Sensitivity


@dataclass(frozen=True, slots=True)
class ModuleSpec:
    name: str
    purpose: str
    owns: tuple[str, ...]
    depends_on: tuple[str, ...]
    sensitivity: Sensitivity
    operations: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.name.isidentifier() or not self.name.islower():
            raise ValueError(f"{self.name!r} is not a lowercase module name")
        if not self.purpose.endswith("."):
            raise ValueError(f"{self.name}: purpose must be a sentence")
        if not self.owns:
            # A module that owns nothing is a helper, not a module, and it will
            # become the place everything unrelated is put.
            raise ValueError(f"{self.name}: a module must own at least one resource kind")
        if not self.operations:
            raise ValueError(f"{self.name}: a module must offer at least one operation")
        if len(set(self.depends_on)) != len(self.depends_on):
            raise ValueError(f"{self.name}: repeats a dependency")
        if self.name in self.depends_on:
            raise ValueError(f"{self.name}: depends on itself")
        object.__setattr__(self, "sensitivity", Sensitivity(self.sensitivity))


S = Sensitivity


def _modules(*specs: ModuleSpec) -> Mapping[str, ModuleSpec]:
    registry: dict[str, ModuleSpec] = {}
    for spec in specs:
        if spec.name in registry:
            raise ValueError(f"{spec.name} declared twice")
        registry[spec.name] = spec
    return MappingProxyType(registry)


MODULES = _modules(
    ModuleSpec(
        "auth", "Authenticates a person and issues the session a request is judged under.",
        owns=("credential_verification", "session_token"), depends_on=("users",),
        sensitivity=S.RESTRICTED,
        operations=("sign_in", "sign_out", "verify_session"),
    ),
    ModuleSpec(
        "users", "Owns the user record every other resource is owned by.",
        owns=("user",), depends_on=(), sensitivity=S.SENSITIVE,
        operations=("create_user", "read_user", "delete_user"),
    ),
    ModuleSpec(
        "devices", "Owns device identity, trust and revocation.",
        owns=("device", "device_trust"), depends_on=("users",), sensitivity=S.SENSITIVE,
        operations=("register_device", "revoke_device", "list_devices", "trust_of"),
    ),
    ModuleSpec(
        "sessions", "Owns live connections between a device and the backend.",
        owns=("session",), depends_on=("users", "devices", "auth"), sensitivity=S.SENSITIVE,
        operations=("open_session", "close_session", "list_sessions"),
    ),
    ModuleSpec(
        "conversations", "Owns conversation threads and their turns.",
        owns=("conversation", "message"), depends_on=("users",), sensitivity=S.SENSITIVE,
        operations=("append_turn", "read_thread", "list_threads"),
    ),
    ModuleSpec(
        "memory", "Owns durable memory items and their recall.",
        owns=("memory_item",), depends_on=("users",), sensitivity=S.SENSITIVE,
        operations=("write_item", "recall", "forget"),
    ),
    ModuleSpec(
        "tasks", "Owns tasks, their dependencies and their estimates.",
        owns=("task", "task_dependency"), depends_on=("users",), sensitivity=S.INTERNAL,
        operations=("create_task", "complete_task", "list_tasks"),
    ),
    ModuleSpec(
        "planning", "Turns tasks, calendar and health into a plan for a day.",
        owns=("plan",), depends_on=("tasks", "calendar", "health"), sensitivity=S.SENSITIVE,
        operations=("plan_day", "replan", "read_plan"),
    ),
    ModuleSpec(
        "connectors", "Owns third-party connections and the outbound calls they make.",
        owns=("connection", "sync_cursor"), depends_on=("users", "policies"), sensitivity=S.RESTRICTED,
        operations=("connect", "disconnect", "sync", "fetch"),
    ),
    ModuleSpec(
        "calendar", "Reads and writes calendar events through a connector.",
        owns=("calendar_event",), depends_on=("connectors", "users"), sensitivity=S.SENSITIVE,
        operations=("list_events", "create_event", "remove_event"),
    ),
    ModuleSpec(
        "gmail", "Reads, drafts and sends mail through a connector.",
        owns=("mail_message", "mail_draft"), depends_on=("connectors", "users"), sensitivity=S.SENSITIVE,
        operations=("search", "read_message", "create_draft", "send_message"),
    ),
    ModuleSpec(
        "health", "Owns daily health state and the journal behind it.",
        owns=("health_daily_state", "health_journal_entry"), depends_on=("users",),
        sensitivity=S.RESTRICTED,
        operations=("record_metric", "read_state", "write_journal"),
    ),
    ModuleSpec(
        "jobs", "Owns the queue of work targeted at a device.",
        owns=("job", "job_attempt"), depends_on=("users", "devices", "policies"),
        sensitivity=S.INTERNAL,
        operations=("submit_job", "list_jobs", "dispatch", "acknowledge", "cancel_job", "sweep"),
    ),
    ModuleSpec(
        "policies", "Evaluates the policy engine and owns delegated grants and approvals.",
        owns=("policy_decision", "delegated_policy", "approval"), depends_on=("users", "devices"),
        sensitivity=S.RESTRICTED,
        operations=("decide", "request_approval", "grant_delegation", "revoke_delegation"),
    ),
    ModuleSpec(
        "automations", "Owns automation definitions and their runs.",
        owns=("automation", "automation_run"), depends_on=("users", "tasks", "policies"),
        sensitivity=S.INTERNAL,
        operations=("create_automation", "run_automation", "list_runs"),
    ),
    ModuleSpec(
        "notifications", "Owns what is sent to a person and through which channel.",
        owns=("notification",), depends_on=("users", "devices"), sensitivity=S.SENSITIVE,
        operations=("raise_notification", "list_notifications", "deliver", "acknowledge"),
    ),
    ModuleSpec(
        "audit", "Owns the audit trail every other module writes to.",
        owns=("audit_event",), depends_on=("users",), sensitivity=S.RESTRICTED,
        operations=("record", "read_trail"),
    ),
)

#: The manifest's list, in its order, so a module quietly disappearing fails a
#: test rather than a reading.
MANIFEST_MODULES = (
    "auth", "users", "devices", "sessions", "conversations", "memory", "tasks",
    "planning", "connectors", "calendar", "gmail", "health", "jobs", "policies",
    "automations", "notifications", "audit",
)

#: One deployable. "Do not introduce microservices without a concrete need" is a
#: property of this number, and a test asserts it.
DEPLOYABLES = ("orion-backend",)
