"""The inference ledger: one row per inference, and what may never be in it.

This is the reference validator for orion/core/schemas/inference-record.schema.json.
It answers what an inference cost and whether it worked. It is NOT a transcript.

That distinction is load-bearing, not stylistic. This machine holds health and
financial data, and a cost ledger is exactly the kind of file that grows a
"just the first 200 characters of the prompt, for debugging" field and quietly
becomes a conversation log nobody consented to. `assert_carries_no_transcript`
exists so that change fails a test instead of shipping.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping

from orion.core.models.contract import ROLES, RoleBinding


SCHEMA_VERSION = 1

OUTCOMES = ("succeeded", "failed", "cancelled")

# Which ORION surface ran the inference. A fact about ORION's own shape, so it
# survives a change of router.
SOURCES = ("agent", "native_app", "tts_daemon", "script")

# Who actually routed it and made the provider call. Separate from `source` on
# purpose: ORION owns the roles, OpenClaw currently executes them, and the
# long-term intent is to be able to take routing in-house without a rewrite.
# When that happens these rows are the migration's own evidence -- they stop
# saying `openclaw` and start saying `orion_router`, with nothing else changed.
EXECUTORS = ("openclaw", "orion_router", "direct")

_PROVIDER = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
_MODEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")

_RECORD_FIELDS = frozenset(
    {
        "schema_version", "ts", "role", "provider", "model", "latency_ms",
        "tokens", "estimated_cost_usd", "fallback", "outcome", "failure_reason",
        "context_tokens", "correlation_id", "source", "executor",
    }
)
_RECORD_REQUIRED = frozenset(
    {
        "schema_version", "ts", "role", "provider", "model", "latency_ms",
        "tokens", "fallback", "outcome", "source", "executor",
    }
)
_TOKEN_FIELDS = frozenset({"input", "output", "cache_read", "cache_write"})
_TOKEN_REQUIRED = frozenset({"input", "output"})
_FALLBACK_FIELDS = frozenset({"fired", "from"})

# Field names that mean somebody started logging conversation.
_TRANSCRIPT_NAMES = (
    "prompt", "completion", "message", "content", "text",
    "response", "transcript", "system", "input_text", "output_text",
    "user", "assistant", "query", "answer", "body",
)

# No legitimate field on a ledger row is long. `failure_reason` is the longest
# thing here and the schema caps it at 256. Anything longer is prose, and prose
# in a cost ledger is a transcript wearing a different field name.
_MAX_STRING = 256


@dataclass(frozen=True, slots=True)
class TokenCounts:
    """Absent counts are None, never 0.

    A model that reported no token count did not use zero tokens. Recording the
    unknown as zero makes every average and every cost total quietly wrong, and
    nothing downstream can tell the difference afterwards.
    """

    input: int | None
    output: int | None
    cache_read: int | None = None
    cache_write: int | None = None


@dataclass(frozen=True, slots=True)
class Fallback:
    fired: bool
    from_model: str | None = None


@dataclass(frozen=True, slots=True)
class InferenceRecord:
    schema_version: int
    ts: datetime
    role: str
    provider: str
    model: str
    latency_ms: int
    tokens: TokenCounts
    fallback: Fallback
    outcome: str
    source: str
    executor: str
    estimated_cost_usd: float | None = None
    failure_reason: str | None = None
    context_tokens: int | None = None
    correlation_id: str | None = None


def _strict(data: object, expected: frozenset[str], required: frozenset[str], what: str) -> Mapping:
    if not isinstance(data, dict):
        raise ValueError(f"{what} must be a JSON object")
    unknown = sorted(set(data) - expected)
    missing = sorted(required - set(data))
    if unknown or missing:
        raise ValueError(f"{what} fields mismatch: unknown={unknown} missing={missing}")
    return data


def _count(value: object, field: str) -> int | None:
    if value is None:
        return None
    if type(value) is not int or isinstance(value, bool):
        raise ValueError(f"{field} must be an integer or null")
    if value < 0:
        raise ValueError(f"{field} must not be negative")
    return value


def _member(value: object, allowed: tuple[str, ...], field: str) -> str:
    if not isinstance(value, str) or value not in allowed:
        raise ValueError(f"{field} must be one of {list(allowed)}")
    return value


def _aware(value: object, field: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be an ISO-8601 string")
    normalized = f"{value[:-1]}+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as error:
        raise ValueError(f"{field} must be a valid ISO-8601 timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{field} must include a timezone")
    return parsed.astimezone(timezone.utc)


def assert_carries_no_transcript(data: object, path: str = "record") -> None:
    """Fail if anything conversational reached a ledger row.

    Checks names and lengths, because both are how it goes wrong: a field
    honestly called `prompt`, or a field innocently called `detail` that turns
    out to hold 4 KB of it.
    """

    if isinstance(data, dict):
        for key, value in data.items():
            lowered = str(key).lower()
            if any(re.fullmatch(rf"{name}s?", lowered) for name in _TRANSCRIPT_NAMES):
                raise ValueError(
                    f"{path}.{key} is transcript-shaped; the ledger records cost and "
                    "outcome, never conversation"
                )
            assert_carries_no_transcript(value, f"{path}.{key}")
        return
    if isinstance(data, list):
        for index, item in enumerate(data):
            assert_carries_no_transcript(item, f"{path}[{index}]")
        return
    if isinstance(data, str) and len(data) > _MAX_STRING:
        raise ValueError(
            f"{path} holds {len(data)} characters; no ledger field is longer than "
            f"{_MAX_STRING}, so this is prose"
        )


def estimate_cost(role: RoleBinding, tokens: TokenCounts) -> float | None:
    """USD for one inference, or None when the role declares no rates.

    None and 0.0 are different answers and must stay different. None means "we
    cannot price this". 0.0 means "we priced it and it was free" -- which is the
    true answer for a local Ollama call, and is also what OpenClaw currently
    records for every cloud call, wrongly. Collapsing them would make that bug
    invisible forever.
    """

    if role.rates is None:
        return None
    rates = role.rates
    total = 0.0
    total += (tokens.input or 0) * rates.input_per_mtok
    total += (tokens.output or 0) * rates.output_per_mtok
    if rates.cache_read_per_mtok is not None:
        total += (tokens.cache_read or 0) * rates.cache_read_per_mtok
    if rates.cache_write_per_mtok is not None:
        total += (tokens.cache_write or 0) * rates.cache_write_per_mtok
    return total / 1_000_000


def decode_record(data: object) -> InferenceRecord:
    """Decode and fully validate one ledger row, or raise."""

    fields = _strict(data, _RECORD_FIELDS, _RECORD_REQUIRED, "record")
    if type(fields["schema_version"]) is not int or fields["schema_version"] != SCHEMA_VERSION:
        raise ValueError("unsupported schema version")
    assert_carries_no_transcript(fields)

    provider = fields["provider"]
    if not isinstance(provider, str) or not _PROVIDER.fullmatch(provider):
        raise ValueError("provider has an invalid format")
    model = fields["model"]
    if not isinstance(model, str) or not _MODEL.fullmatch(model):
        raise ValueError("model has an invalid format")

    token_fields = _strict(fields["tokens"], _TOKEN_FIELDS, _TOKEN_REQUIRED, "tokens")
    tokens = TokenCounts(
        input=_count(token_fields["input"], "tokens.input"),
        output=_count(token_fields["output"], "tokens.output"),
        cache_read=_count(token_fields.get("cache_read"), "tokens.cache_read"),
        cache_write=_count(token_fields.get("cache_write"), "tokens.cache_write"),
    )

    fallback_fields = _strict(
        fields["fallback"], _FALLBACK_FIELDS, frozenset({"fired"}), "fallback"
    )
    fired = fallback_fields["fired"]
    if not isinstance(fired, bool):
        raise ValueError("fallback.fired must be a boolean")
    from_model = fallback_fields.get("from")
    if from_model is not None and not isinstance(from_model, str):
        raise ValueError("fallback.from must be a string or null")
    if fired and not from_model:
        # A row saying a fallback fired without saying what it fell back from
        # cannot answer the only question anyone asks it afterwards.
        raise ValueError("fallback.fired is true but fallback.from is missing")
    if not fired and from_model:
        raise ValueError("fallback.from is set but fallback.fired is false")

    outcome = _member(fields["outcome"], OUTCOMES, "outcome")
    failure_reason = fields.get("failure_reason")
    if failure_reason is not None and not isinstance(failure_reason, str):
        raise ValueError("failure_reason must be a string or null")
    if outcome == "failed" and not failure_reason:
        # "It failed" with no reason is a row that costs storage and answers
        # nothing.
        raise ValueError("outcome is failed but failure_reason is missing")

    cost = fields.get("estimated_cost_usd")
    if cost is not None:
        if isinstance(cost, bool) or not isinstance(cost, (int, float)):
            raise ValueError("estimated_cost_usd must be a number or null")
        cost = float(cost)
        if cost != cost or cost in (float("inf"), float("-inf")):
            raise ValueError("estimated_cost_usd must be finite")
        if cost < 0:
            raise ValueError("estimated_cost_usd must not be negative")

    correlation_id = fields.get("correlation_id")
    if correlation_id is not None and (
        not isinstance(correlation_id, str) or len(correlation_id) > 128
    ):
        raise ValueError("correlation_id must be a string under 128 characters or null")

    return InferenceRecord(
        schema_version=SCHEMA_VERSION,
        ts=_aware(fields["ts"], "ts"),
        role=_member(fields["role"], ROLES, "role"),
        provider=provider,
        model=model,
        latency_ms=_count(fields["latency_ms"], "latency_ms"),
        tokens=tokens,
        fallback=Fallback(fired=fired, from_model=from_model),
        outcome=outcome,
        source=_member(fields["source"], SOURCES, "source"),
        executor=_member(fields["executor"], EXECUTORS, "executor"),
        estimated_cost_usd=cost,
        failure_reason=failure_reason,
        context_tokens=_count(fields.get("context_tokens"), "context_tokens"),
        correlation_id=correlation_id,
    )


def encode_record(record: InferenceRecord) -> dict[str, Any]:
    """Render one row for the JSONL ledger, omitting nothing that is required."""

    row: dict[str, Any] = {
        "schema_version": record.schema_version,
        "ts": record.ts.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "role": record.role,
        "provider": record.provider,
        "model": record.model,
        "latency_ms": record.latency_ms,
        "tokens": {
            "input": record.tokens.input,
            "output": record.tokens.output,
            "cache_read": record.tokens.cache_read,
            "cache_write": record.tokens.cache_write,
        },
        "fallback": {"fired": record.fallback.fired, "from": record.fallback.from_model},
        "outcome": record.outcome,
        "source": record.source,
        "executor": record.executor,
        "estimated_cost_usd": record.estimated_cost_usd,
        "failure_reason": record.failure_reason,
        "context_tokens": record.context_tokens,
        "correlation_id": record.correlation_id,
    }
    assert_carries_no_transcript(row)
    return row
