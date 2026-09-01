"""Mac-side adapter: resolve a role, and append one inference row.

Core defines the contract and the record; it performs no I/O. This is the
adapter that reads the contract off disk and appends to the ledger, which is
exactly the split Phase 1 established and Phase 2 inherits.

Everything here fails soft. A voice daemon that cannot speak because its
telemetry file was unwritable is a worse outcome than missing telemetry, so no
function raises into a caller's synthesis path.
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from orion.core.models.contract import ModelRef, ModelRoleContract, decode_contract
from orion.core.models.telemetry import (
    Fallback,
    InferenceRecord,
    TokenCounts,
    decode_record,
    encode_record,
)


CONTRACT_PATH = Path.home() / ".openclaw" / "orion-controlled" / "model-roles.json"
LEDGER_PATH = Path.home() / ".openclaw" / "orion-controlled" / "inference-ledger.jsonl"


def load_contract(path: Path | None = None) -> ModelRoleContract | None:
    """Read the role contract, or None if it is missing or malformed.

    None is a usable answer: the caller keeps its compiled-in default. A
    contract that fails to parse must not take the voice down with it.
    """

    target = path or CONTRACT_PATH
    try:
        return decode_contract(json.loads(target.read_text(encoding="utf-8")))
    except (OSError, ValueError, json.JSONDecodeError):
        return None


def resolve(role: str, default: str, path: Path | None = None) -> str:
    """The model for a role, or `default` when the contract cannot answer.

    Returns the bare model name rather than `provider/model`, because that is
    what every caller actually passes to its client.
    """

    contract = load_contract(path)
    if contract is None:
        return default
    try:
        return contract.resolve(role).model
    except ValueError:
        return default


def append(
    role: str,
    reference: ModelRef | str,
    latency_ms: int,
    *,
    source: str,
    outcome: str = "succeeded",
    failure_reason: str | None = None,
    fell_back_from: str | None = None,
    tokens: TokenCounts | None = None,
    correlation_id: str | None = None,
    ledger: Path | None = None,
    contract: ModelRoleContract | None = None,
    now: datetime | None = None,
) -> bool:
    """Append one row. Returns whether it landed; never raises.

    The append is a single `write` on a file opened O_APPEND, which the kernel
    keeps atomic for a line this size. Several processes write here -- the app,
    the TTS daemon, the ingest script -- and a torn line would corrupt the
    ledger for all of them.
    """

    try:
        text = str(reference)
        provider, _, model = text.partition("/")
        if not model:
            provider, model = "unknown", text

        contract = contract or load_contract()
        cost = None
        if contract is not None:
            try:
                from orion.core.models.telemetry import estimate_cost

                cost = estimate_cost(contract.role(role), tokens or TokenCounts(None, None))
            except ValueError:
                cost = None

        record = InferenceRecord(
            schema_version=1,
            ts=now or datetime.now(tz=timezone.utc),
            role=role,
            provider=provider,
            model=model,
            latency_ms=max(int(latency_ms), 0),
            tokens=tokens or TokenCounts(input=None, output=None),
            fallback=Fallback(fired=fell_back_from is not None, from_model=fell_back_from),
            outcome=outcome,
            source=source,
            executor="direct",
            estimated_cost_usd=cost,
            failure_reason=failure_reason,
            correlation_id=correlation_id,
        )
        # Round-trip through Core's own decoder before anything reaches disk.
        # Without this a writer can emit a row the reader will later reject --
        # an unknown role, say -- and the corruption is only discovered by
        # whoever tries to read the ledger months later.
        payload = encode_record(record)
        decode_record(payload)
        line = json.dumps(payload, separators=(",", ":")) + "\n"

        target = ledger or LEDGER_PATH
        target.parent.mkdir(parents=True, exist_ok=True)
        handle = os.open(target, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        try:
            os.write(handle, line.encode("utf-8"))
        finally:
            os.close(handle)
        return True
    except Exception:
        # Deliberately broad. Telemetry must never be the reason a user cannot
        # hear their assistant.
        return False
