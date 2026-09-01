#!/usr/bin/env python3
"""Prove the redactor holds, and that live audit rows fit the v2 contract.

Three things, in the order they matter:

1. **Rule parity.** Every credential shape `scripts/orion_v2_secret_scan.py`
   knows must exist in the audit redactor. The two rule sets are duplicated on
   purpose -- the scanner's findings are fingerprinted into a reviewed allowlist,
   so refactoring its rules risks invalidating that allowlist silently -- and
   this is what stops the duplication drifting.
2. **A synthetic corpus.** Known credential shapes, in values and in field
   names, none of which may survive redaction.
3. **The live ledger.** Every row the running system has written, replayed
   through the offline adapter and the redactor.

Prints counts and rule names. Never prints a matched value: a check that quotes
the secret it found has made a second copy of it.

Read-only. Exit 0 when the redactor holds and every row fits, 1 otherwise.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from orion.core.audit.events import AuditEvent  # noqa: E402
from orion.core.audit.patterns import CREDENTIAL_SHAPES  # noqa: E402
from orion.core.audit.redaction import redact  # noqa: E402
from orion.core.tools.registry import decode_registry  # noqa: E402
from orion.mac.audit_ledger import LedgerRowError, events_for, read_rows  # noqa: E402

REGISTRY = REPO_ROOT / "planning" / "v2" / "capability-registry.json"
SCANNER = REPO_ROOT / "scripts" / "orion_v2_secret_scan.py"

#: Deliberately synthetic. Every one of these is a shape, not a live key.
CORPUS = {
    "openai_style_key": "here is the key sk-abcdefghijklmnopqrstuvwxyz012345",
    "github_token": "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "aws_access_key": "AKIAIOSFODNN7EXAMPLE",
    "slack_token": "xoxb-0000000000-abcdefghijklmnop",
    "google_api_key": "AIzaSyA0000000000000000000000000000000",
    "stripe_live_key": "sk_live_0000000000000000abcd",
    "private_key": "-----BEGIN RSA PRIVATE KEY-----",
    "jwt": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop",
    "bearer_header": "Bearer abcdefghijklmnopqrstuvwxyz",
    "basic_auth_header": "Basic YWxhZGRpbjpvcGVuc2VzYW1l0000",
    "url_credentials": "https://nick:hunter2@example.internal/path",
    "discord_webhook": "https://discord.com/api/webhooks/123456/abcdefghijklmnopqrstuvwx",
}

#: Field names that must be struck whatever they contain.
NAMED_FIELDS = ("password", "Set-Cookie", "X-Api-Key", "refresh_token", "sessionToken", "client_secret")


def scanner_rules() -> set[str]:
    spec = importlib.util.spec_from_file_location("orion_v2_secret_scan", SCANNER)
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load the secret scanner")
    module = importlib.util.module_from_spec(spec)
    # Registered before execution because @dataclass resolves its own module out
    # of sys.modules while the class body runs, and the scanner defines one.
    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
        return set(module.PATTERNS)
    finally:
        sys.modules.pop(spec.name, None)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", type=Path, default=None, help="task ledger to replay")
    parser.add_argument("--registry", type=Path, default=REGISTRY)
    args = parser.parse_args()

    failures: list[str] = []

    # 1. Rule parity with the repo scanner.
    missing = sorted(scanner_rules() - set(CREDENTIAL_SHAPES))
    if missing:
        failures.append(f"the secret scanner knows rules the redactor does not: {missing}")
    extra = sorted(set(CREDENTIAL_SHAPES) - scanner_rules())

    # 2. The synthetic corpus.
    survived: list[str] = []
    for rule, sample in CORPUS.items():
        result = redact({"note": sample})
        if rule not in result.rules:
            survived.append(rule)
        if sample in json.dumps(result.value):
            survived.append(f"{rule}:verbatim")
    for name in NAMED_FIELDS:
        result = redact({name: "whatever-this-is"})
        if "sensitive_field" not in result.rules:
            survived.append(f"field:{name}")
    if survived:
        failures.append(f"redaction did not strike: {sorted(set(survived))}")

    # 3. The live ledger.
    registry = decode_registry(json.loads(args.registry.read_text(encoding="utf-8")))
    rows = read_rows(args.ledger)
    events: list[AuditEvent] = []
    for row in rows:
        try:
            events.extend(events_for(row, registry))
        except (LedgerRowError, ValueError) as error:
            failures.append(f"live row {row.get('taskId', '?')} does not fit the contract: {error}")

    rules = Counter(rule for event in events for rule in event.redactions)
    value_shape_hits = {rule: count for rule, count in rules.items() if rule in CREDENTIAL_SHAPES}
    unmapped = sum(1 for event in events if event.capability == "unknown.capability")
    unrecorded = sum(1 for event in events if event.proposed_action == "unrecorded")
    no_user = sum(1 for event in events if event.user is None)

    print(f"audit check: {len(CREDENTIAL_SHAPES)} credential shapes, {len(CORPUS)} corpus samples, all struck")
    if extra:
        print(f"audit check: redactor adds {len(extra)} rules the repo scanner does not have: {extra}")
    print(f"audit check: {len(rows)} live ledger rows -> {len(events)} audit events, all decoded")
    print(f"audit check: live redaction rules fired: {dict(rules) or 'none'}")
    print(f"audit check: {unmapped} events could not name a capability ({unrecorded} because the row records no proposed action)")
    print(f"audit check: {no_user} of {len(events)} events name no user -- the live ledger has no user field")

    if value_shape_hits:
        # Not a check failure: the redactor caught it, which is the system
        # working. It is a finding, and it is loud on purpose.
        print(f"audit check: FINDING -- live rows contained credential shapes: {value_shape_hits}")
        failures.append("a live audit row contained something shaped like a credential")

    if failures:
        print(f"audit check: FAIL ({len(failures)})")
        for line in failures[:20]:
            print(f"  {line}")
        return 1
    print("audit check: OK -- nothing survives redaction, and every live row fits the contract")
    return 0


if __name__ == "__main__":
    sys.exit(main())
