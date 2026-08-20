"""Data-only compatibility mapping for ORION Control's read-only status action.

This module does not call OpenClaw, inspect the Mac, execute a tool, or grant
authority. It only translates already-authenticated request/result records at
the future default-off adapter seam.
"""

from __future__ import annotations

from datetime import datetime
from typing import Mapping

from orion.core.schemas import ExecutionResult, ProposalEnvelope


REQUEST_FIELDS = frozenset({"action", "arguments", "tool_call_id", "correlation_id"})
RESULT_FIELDS = frozenset({"mode", "idempotencyKey", "output"})
STATUS_REQUIRED_FIELDS = frozenset({"uptime", "summary"})
STATUS_OPTIONAL_FIELDS = frozenset(
    {
        "batteryPercent",
        "batteryState",
        "diskFreeGb",
        "diskTotalGb",
        "memoryPressure",
    }
)


def _strict_mapping(value: object, expected: frozenset[str], label: str) -> Mapping[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    unknown = sorted(set(value) - expected)
    missing = sorted(expected - set(value))
    if unknown or missing:
        raise ValueError(f"{label} fields mismatch: unknown={unknown} missing={missing}")
    return value


def proposal_from_compact_request(
    request: object,
    *,
    proposal_id: str,
    created_at: datetime,
) -> ProposalEnvelope:
    """Map the compact OpenClaw request without trusting caller-supplied authority."""

    fields = _strict_mapping(request, REQUEST_FIELDS, "compact request")
    if fields["action"] != "system_status":
        raise ValueError("adapter accepts only system_status")
    if fields["arguments"] != {}:
        raise ValueError("system_status arguments must be empty")
    tool_call_id = fields["tool_call_id"]
    correlation_id = fields["correlation_id"]
    if not isinstance(tool_call_id, str):
        raise ValueError("tool_call_id must be a string")
    return ProposalEnvelope(
        schema_version=1,
        proposal_id=proposal_id,
        correlation_id=correlation_id,
        source="openclaw_taskgraph",
        capability="system_status",
        arguments={},
        created_at=created_at,
        provenance=(f"host-tool-call:{tool_call_id}",),
        sensitivity="INTERNAL",
    )


def execution_from_legacy_result(
    legacy_result: object,
    *,
    proposal: ProposalEnvelope,
    execution_id: str,
    audit_reference: str,
    started_at: datetime,
    finished_at: datetime,
) -> ExecutionResult:
    """Translate the verified ambient-read result without broadening its shape."""

    fields = _strict_mapping(legacy_result, RESULT_FIELDS, "legacy result")
    if fields["mode"] != "observed":
        raise ValueError("system_status result must use observed mode")
    idempotency_key = fields["idempotencyKey"]
    if not isinstance(idempotency_key, str) or not idempotency_key:
        raise ValueError("idempotencyKey must be a non-empty string")
    output = fields["output"]
    if not isinstance(output, dict):
        raise ValueError("system_status output must be an object")
    output_fields = set(output)
    unknown = sorted(output_fields - STATUS_REQUIRED_FIELDS - STATUS_OPTIONAL_FIELDS)
    missing = sorted(STATUS_REQUIRED_FIELDS - output_fields)
    if unknown or missing:
        raise ValueError(f"system_status output mismatch: unknown={unknown} missing={missing}")
    if not isinstance(output["uptime"], str) or not isinstance(output["summary"], str):
        raise ValueError("system_status text fields must be strings")
    for name in ("batteryPercent", "diskFreeGb", "diskTotalGb"):
        if name in output and (isinstance(output[name], bool) or not isinstance(output[name], (int, float))):
            raise ValueError(f"{name} must be numeric")
    for name in ("batteryState", "memoryPressure"):
        if name in output and not isinstance(output[name], str):
            raise ValueError(f"{name} must be a string")
    return ExecutionResult(
        schema_version=1,
        execution_id=execution_id,
        proposal_id=proposal.proposal_id,
        status="SUCCEEDED",
        observed_outcome={
            "mode": "observed",
            "idempotency_key": idempotency_key,
            "system_status": dict(output),
        },
        audit_reference=audit_reference,
        started_at=started_at,
        finished_at=finished_at,
    )
