"""Turn what OpenClaw already recorded into ledger rows ORION can answer with.

This is the "no second inference path" promise made literal. ORION does not
intercept OpenClaw's model calls; it reads the records OpenClaw writes anyway
and normalizes them against the role contract. Nothing here performs inference,
opens a socket, or reads a file -- the caller supplies already-parsed records,
which is what keeps this testable and keeps Core free of I/O.

OpenClaw records model, provider and full token counts. It does not record
latency, real cost, failure reason, or whether a fallback fired. Four of the six
fields the manifest says to track are therefore derived here rather than read.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Mapping, Sequence

from orion.core.models.contract import ModelRef, ModelRoleContract
from orion.core.models.telemetry import (
    Fallback,
    InferenceRecord,
    TokenCounts,
    estimate_cost,
)


@dataclass(frozen=True, slots=True)
class RoleMatch:
    role: str
    fell_back_from: str | None


def role_index(contract: ModelRoleContract) -> Mapping[str, RoleMatch]:
    """Map every `provider/model` the contract can reach back to its role.

    A model may legitimately appear in more than one role -- `ollama/llama3.2:3b`
    is both the `fast` primary and a `reasoning` fallback today. Primaries win,
    because a row whose model is some role's primary is overwhelmingly that role
    doing its normal job, not another role degrading into it.
    """

    index: dict[str, RoleMatch] = {}
    # Retired first, so anything still routed overrides it.
    for reference, role_name in contract.retired.items():
        index[reference] = RoleMatch(role_name, None)
    for binding in contract.roles.values():
        for fallback in binding.fallbacks:
            index.setdefault(
                str(fallback),
                RoleMatch(binding.name, str(binding.primary) if binding.primary else None),
            )
    for binding in contract.roles.values():
        if binding.primary is not None:
            index[str(binding.primary)] = RoleMatch(binding.name, None)
    return index


def _epoch_or_iso(value: object) -> datetime | None:
    if isinstance(value, str):
        normalized = f"{value[:-1]}+00:00" if value.endswith("Z") else value
        try:
            parsed = datetime.fromisoformat(normalized)
        except ValueError:
            return None
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        # OpenClaw writes epoch milliseconds inside the message body.
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc)
    return None


def _tokens(usage: Mapping[str, object]) -> TokenCounts:
    def count(key: str) -> int | None:
        value = usage.get(key)
        # Absent stays absent. OpenClaw omits a field it has nothing for, and
        # turning that into 0 would quietly bias every total built on this.
        if value is None or isinstance(value, bool) or not isinstance(value, int):
            return None
        return max(value, 0)

    return TokenCounts(
        input=count("input"),
        output=count("output"),
        cache_read=count("cacheRead"),
        cache_write=count("cacheWrite"),
    )


def normalize_session(
    records: Sequence[Mapping[str, object]],
    contract: ModelRoleContract,
) -> list[InferenceRecord]:
    """Normalize one OpenClaw session file's records into ledger rows.

    `records` is the parsed JSONL in file order. Order matters: latency is the
    gap between an assistant reply and whatever preceded it, which is the only
    duration OpenClaw's records let anyone recover.
    """

    index = role_index(contract)
    rows: list[InferenceRecord] = []
    previous_at: datetime | None = None

    for entry in records:
        at = _epoch_or_iso(entry.get("timestamp"))
        message = entry.get("message")
        if not isinstance(message, Mapping):
            if at is not None:
                previous_at = at
            continue

        if message.get("role") != "assistant" or not isinstance(message.get("usage"), Mapping):
            if at is not None:
                previous_at = at
            continue

        model = message.get("model")
        provider = message.get("provider")
        if not isinstance(model, str) or not isinstance(provider, str):
            previous_at = at or previous_at
            continue

        reference = f"{provider}/{model}"
        match = index.get(reference)
        if match is None:
            # A model nobody declared. Skipping it silently would let the
            # contract look complete while traffic flows past it, so the caller
            # is told rather than the row invented.
            raise UnknownModel(reference)

        usage = message["usage"]
        assert isinstance(usage, Mapping)
        tokens = _tokens(usage)

        latency_ms = 0
        if at is not None and previous_at is not None and at >= previous_at:
            latency_ms = int((at - previous_at).total_seconds() * 1000)

        stop_reason = message.get("stopReason")
        failed = stop_reason == "error" or bool(message.get("errorCode"))
        reason = None
        if failed:
            # Prefer the code over the message: a code is a bounded token, and
            # a provider's error text is free-form and can carry echoes of the
            # request. The ledger is not a place for free-form text.
            code = message.get("errorCode")
            reason = str(code) if code else "provider_error"

        context_tokens = None
        usage_context = usage.get("contextUsage")
        if isinstance(usage_context, Mapping):
            prompt_tokens = usage_context.get("promptTokens")
            if isinstance(prompt_tokens, int) and not isinstance(prompt_tokens, bool):
                context_tokens = max(prompt_tokens, 0)

        binding = contract.role(match.role)
        rows.append(
            InferenceRecord(
                schema_version=1,
                ts=at or datetime.now(tz=timezone.utc),
                role=match.role,
                provider=provider,
                model=model,
                latency_ms=latency_ms,
                tokens=tokens,
                fallback=Fallback(
                    fired=match.fell_back_from is not None,
                    from_model=match.fell_back_from,
                ),
                outcome="failed" if failed else "succeeded",
                source="agent",
                executor="openclaw",
                # Priced from the contract, not copied from OpenClaw's `cost`
                # block -- that block reports zero for every call, including
                # paid ones, which is the bug this replaces.
                estimated_cost_usd=estimate_cost(binding, tokens),
                failure_reason=reason,
                context_tokens=context_tokens,
                correlation_id=(
                    str(entry["id"]) if isinstance(entry.get("id"), str) else None
                ),
            )
        )
        previous_at = at or previous_at

    return rows


class UnknownModel(LookupError):
    """A model appeared in traffic that the role contract does not declare."""

    def __init__(self, reference: str) -> None:
        super().__init__(
            f"{reference} is not declared in the role contract; either add it or "
            "find out what is calling it"
        )
        self.reference = reference


def dedupe(rows: Iterable[InferenceRecord], seen: set[str]) -> list[InferenceRecord]:
    """Drop rows already in the ledger, keyed by correlation id.

    Ingestion runs repeatedly over the same session files, so this is what keeps
    it from inflating every total on the second run.
    """

    fresh: list[InferenceRecord] = []
    for row in rows:
        key = row.correlation_id
        if key is None or key in seen:
            continue
        seen.add(key)
        fresh.append(row)
    return fresh
