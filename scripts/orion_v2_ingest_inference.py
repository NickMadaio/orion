#!/usr/bin/env python3
"""Build the inference ledger from records OpenClaw already wrote.

ORION does not intercept OpenClaw's model calls -- that is the whole point of
the Phase 2 placement decision. It reads the session records OpenClaw writes
anyway and normalizes them against the role contract, deriving the four fields
OpenClaw does not record: latency, real cost, failure reason, fallback usage.

Dry run by default. Pass --apply to append to the ledger.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from orion.core.models.contract import decode_contract  # noqa: E402
from orion.core.models.ingest import UnknownModel, dedupe, normalize_session  # noqa: E402
from orion.core.models.telemetry import encode_record  # noqa: E402

DEFAULT_CONTRACT = REPO_ROOT / "planning" / "v2" / "model-roles.seed.json"
SESSIONS = Path.home() / ".openclaw" / "agents"
LEDGER = Path.home() / ".openclaw" / "orion-controlled" / "inference-ledger.jsonl"


def existing_ids(ledger: Path) -> set[str]:
    """Correlation ids already recorded, so a rerun adds nothing twice."""

    seen: set[str] = set()
    if not ledger.exists():
        return seen
    for line in ledger.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row.get("correlation_id"), str):
            seen.add(row["correlation_id"])
    return seen


def session_files(root: Path) -> list[Path]:
    # `.trajectory.jsonl` is a parallel, much larger record of the same turns.
    # Reading both would double-count every inference.
    return sorted(
        path
        for path in root.glob("*/sessions/*.jsonl")
        if not path.name.endswith(".trajectory.jsonl")
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument("--sessions", type=Path, default=SESSIONS)
    parser.add_argument("--ledger", type=Path, default=LEDGER)
    parser.add_argument("--apply", action="store_true", help="append to the ledger")
    parser.add_argument("--limit", type=int, default=0, help="only the N most recent sessions")
    args = parser.parse_args()

    contract = decode_contract(json.loads(args.contract.read_text(encoding="utf-8")))
    files = session_files(args.sessions)
    if args.limit:
        files = sorted(files, key=lambda p: p.stat().st_mtime)[-args.limit:]
    if not files:
        print(f"no session files under {args.sessions}")
        return 0

    seen = existing_ids(args.ledger)
    already = len(seen)
    fresh = []
    unknown: Counter[str] = Counter()
    unreadable = 0

    for path in files:
        records = []
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line.strip():
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                unreadable += 1
        try:
            fresh.extend(dedupe(normalize_session(records, contract), seen))
        except UnknownModel as error:
            # Not fatal, but not silent either: a model in real traffic that the
            # contract does not declare means the contract is not yet the single
            # source of truth it claims to be.
            unknown[error.reference] += 1

    by_role = Counter(row.role for row in fresh)
    failures = [row for row in fresh if row.outcome == "failed"]
    fallbacks = [row for row in fresh if row.fallback.fired]
    priced = [row for row in fresh if row.estimated_cost_usd is not None]
    total_cost = sum(row.estimated_cost_usd or 0.0 for row in priced)
    latencies = sorted(row.latency_ms for row in fresh if row.latency_ms > 0)

    print(f"sessions scanned : {len(files)}")
    print(f"already in ledger: {already}")
    print(f"new rows         : {len(fresh)}")
    if by_role:
        print("  by role        : " + ", ".join(f"{r}={n}" for r, n in sorted(by_role.items())))
    print(f"  failures       : {len(failures)}")
    print(f"  fallbacks fired: {len(fallbacks)}")
    print(f"  priced rows    : {len(priced)} (estimated ${total_cost:.4f})")
    if latencies:
        mid = latencies[len(latencies) // 2]
        print(f"  latency        : median {mid} ms, max {latencies[-1]} ms")
    if unreadable:
        print(f"  unreadable lines: {unreadable}")
    for reference, count in unknown.most_common():
        print(f"  UNDECLARED     : {reference} appeared in {count} session(s)")

    if not args.apply:
        print("\ndry run; pass --apply to append")
        return 0

    args.ledger.parent.mkdir(parents=True, exist_ok=True)
    with args.ledger.open("a", encoding="utf-8") as handle:
        for row in fresh:
            handle.write(json.dumps(encode_record(row), separators=(",", ":")) + "\n")
    args.ledger.chmod(0o600)
    print(f"\nappended {len(fresh)} row(s) to {args.ledger}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
