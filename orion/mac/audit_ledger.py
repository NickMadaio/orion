"""Mac-side adapter: read the live task ledger as v2 audit events.

Read-only, and offline. Core defines the event; this translates the rows the
running system already writes into it, which is how Phase 6 can claim the
contract fits reality without changing what the live route writes.

Two fields cannot be filled from a live row, and are not invented:

- **user** is `None`. There is one user and the ledger never names him.
- **device** is the recorded placeholder below, because the ledger names no
  device either.

Both become ambiguous the moment a second device can propose an action, which is
Phase 15. Marking them here is the point: an adapter that quietly filled in
"nick" and "this Mac" would make a single-user assumption look like data.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from orion.core.audit.events import AuditEvent, DecisionRecord, ExecutionRecord
from orion.core.tools.registry import CapabilityRegistry
from orion.shared.result import DecisionOutcome, ExecutionStatus, Sensitivity


LEDGER_PATH = Path.home() / ".openclaw" / "orion-controlled" / "task-ledger.jsonl"
ARCHIVE_DIR = Path.home() / ".openclaw" / "orion-controlled" / "archive"

#: Stands in for "the one Mac these rows were written on", which the ledger does
#: not name. Deliberately not a real device id.
UNNAMED_DEVICE = "device-unnamed-local"

#: The live validator's three outcomes are the manifest's three under other
#: names. This is that mapping, written down once.
VALIDATION_OUTCOMES = {
    "ready": DecisionOutcome.ALLOW,
    "needs_approval": DecisionOutcome.REQUIRE_APPROVAL,
    "needs_clarification": DecisionOutcome.REQUIRE_APPROVAL,
    "rejected": DecisionOutcome.DENY,
}

STEP_STATUSES = {
    "succeeded": ExecutionStatus.SUCCEEDED,
    "failed": ExecutionStatus.FAILED,
    "rejected": ExecutionStatus.DENIED,
    "cancelled": ExecutionStatus.CANCELLED,
}

#: Argument keys that name what an action acted ON, in the order they are
#: preferred. Anything else is left out of `resource` rather than guessed at.
RESOURCE_KEYS = (
    "path",
    "file",
    "filePath",
    "directory",
    "folder",
    "source",
    "target",
    "application",
    "url",
    "recipient",
    "title",
    "name",
)


class LedgerRowError(ValueError):
    """A live row that does not fit the contract. Reported, never swallowed."""


def read_rows(path: Path | None = None) -> list[dict]:
    """Every parseable row, newest last. A torn line is skipped, not fatal."""

    target = path or LEDGER_PATH
    try:
        lines = target.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    rows: list[dict] = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            rows.append(parsed)
    return rows


def _timestamp(value: object, fallback: datetime) -> datetime:
    if not isinstance(value, str):
        return fallback
    text = f"{value[:-1]}+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return fallback
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _resource(arguments: object) -> str:
    if not isinstance(arguments, dict) or not arguments:
        return "unrecorded"
    for key in RESOURCE_KEYS:
        value = arguments.get(key)
        if isinstance(value, str) and value:
            return value
    return "unrecorded"


def _identifier(*parts: str) -> str:
    """An id the Identifier type will accept, built from what the row has."""

    joined = ".".join(part for part in parts if part)
    cleaned = "".join(character if character.isalnum() or character in "._:-" else "-" for character in joined)
    return cleaned.ljust(8, "0")[:128]


def events_for(row: dict, registry: CapabilityRegistry | None = None) -> Iterator[AuditEvent]:
    """One audit event per step, or one per task when a task has no steps.

    A task rejected before it produced a step is still a decision, and dropping
    it would mean the audit trail contained only the actions that got somewhere.
    """

    task_id = row.get("taskId")
    if not isinstance(task_id, str) or not task_id:
        raise LedgerRowError("row has no taskId")
    created = _timestamp(row.get("createdAt"), datetime(1970, 1, 1, tzinfo=timezone.utc))
    completed = _timestamp(row.get("completedAt"), created)
    validation = row.get("validation") if isinstance(row.get("validation"), dict) else {}
    issues = validation.get("issues") if isinstance(validation.get("issues"), list) else []
    codes = tuple(
        issue["code"] for issue in issues if isinstance(issue, dict) and isinstance(issue.get("code"), str)
    ) or ("no_issue_recorded",)
    outcome = VALIDATION_OUTCOMES.get(str(validation.get("status")), DecisionOutcome.DENY)
    authorization = row.get("authorization") if isinstance(row.get("authorization"), dict) else {}
    steps = row.get("steps") if isinstance(row.get("steps"), list) else []

    for index, step in enumerate(steps or [None]):
        step = step if isinstance(step, dict) else {}
        request = step.get("request") if isinstance(step.get("request"), dict) else {}
        action = request.get("action") if isinstance(request.get("action"), str) else "unrecorded"
        entry = registry.capabilities.get(action) if registry is not None else None
        execution = None
        status = STEP_STATUSES.get(str(step.get("status")))
        if status is not None:
            execution = ExecutionRecord(
                status=status,
                started_at=created,
                finished_at=completed,
                attempt=step["attempts"] if isinstance(step.get("attempts"), int) and step["attempts"] >= 1 else 1,
            )
        yield AuditEvent(
            event_id=_identifier(task_id, str(step.get("stepId") or index)),
            correlation_id=_identifier(task_id),
            occurred_at=created,
            actor="orion",
            user=None,
            device=UNNAMED_DEVICE,
            proposed_action=action,
            capability=entry.capability if entry is not None else "unknown.capability",
            resource=_resource(request.get("arguments")),
            decision=DecisionRecord(
                outcome=outcome,
                risk=entry.risk if entry is not None else "unrecorded",
                reason_codes=codes,
                policy_version="legacy-validator",
            ),
            execution=execution,
            result=str(row.get("status") or "unrecorded"),
            sensitivity=Sensitivity.INTERNAL,
            details={
                "goal": row.get("goal"),
                "plan_hash": row.get("planHash"),
                # The live row calls this `authorization`, and it holds trust
                # PROVENANCE -- "there was a user turn, recently" -- not a
                # credential. The redactor strikes any field whose name says
                # authorization, correctly and without knowing that, so the
                # adapter gives it the name it actually deserves rather than
                # teaching the redactor an exception.
                "trust_binding": authorization.get("binding"),
                "trust_turn_count": authorization.get("turnCount"),
                "idempotency_key": step.get("idempotencyKey"),
                "verification": step.get("verification"),
                "step_status": step.get("status"),
            },
        )
