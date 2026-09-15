#!/usr/bin/env python3
"""PHASES 68 AND 69 — hold the coverage maps to the tests they claim.

A mapping document is worth having only if it cannot go stale, and a document
that says "prompt injection: covered" while the test that covered it was
renamed six weeks ago is worse than no document: it answers the question wrong
with confidence.

So this checks three things, all mechanical:

  1. Every attack class the manifest names appears exactly once. A class that
     was quietly dropped from the map is a failure, not an omission.
  2. Every test the map CLAIMS exists, by its literal `it("...")` title, in the
     file the map names. Renaming a security test without updating the map
     fails the build — which is the point.
  3. Every class is either covered by at least one test, or carries a `reason`
     AND a `residual`. "Not applicable" is an acceptable answer; "not
     applicable" with nothing said about what would make it applicable is not.

What this does NOT do is run the tests. `orion_v2_ci_check.sh` does that, and
a checker that both ran the suite and graded the map would be one thing to
mistrust instead of two things to compare.

TWO MAPS, ONE CHECKER. Phase 68's reliability scenarios need exactly the same
three checks as Phase 69's attack classes, and writing a second checker would
have been a second thing to keep in step -- the failure this repo has paid for
twice already. The difference between them is one field: a reliability entry
may cite a `mechanism` (a launchd key, an idempotency scheme) instead of only
tests, because several of those failures are handled by something that is not
a test and pretending otherwise would be the same dishonesty from the other
side. A mechanism without a reason is still refused.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ATTACK_MAP = REPO / "docs/planning/v2/ATTACK_SURFACE.json"
RELIABILITY_MAP = REPO / "docs/planning/v2/RELIABILITY_SURFACE.json"
PLUGIN = REPO / "openclaw-plugins/orion-control"

#: The manifest's own list, Phase 69, in its order. Kept here rather than read
#: from the map so that the map cannot satisfy the check by shortening itself.
MANIFEST_CLASSES = [
    "bola_idor",
    "broken_authorization",
    "session_theft",
    "refresh_token_theft",
    "ssrf",
    "prompt_injection",
    "indirect_prompt_injection",
    "replay",
    "privilege_escalation",
    "job_tampering",
    "webhook_spoofing",
    "malicious_attachment",
    "dependency_compromise",
    "path_traversal",
    "command_injection",
    "sql_injection",
    "log_injection",
    "secrets_leakage",
    "cross_user_data_leakage",
]

#: Phase 68's list, in the manifest's order. Here for the same reason the
#: attack list is: a map cannot satisfy the check by shortening itself.
MANIFEST_SCENARIOS = [
    "api_rate_limits",
    "google_429",
    "google_500",
    "revoked_tokens",
    "expired_subscriptions",
    "duplicate_webhooks",
    "missing_webhooks",
    "database_outage",
    "queue_duplicate_delivery",
    "worker_crash",
    "mac_disconnect",
    "phone_disconnect",
    "model_timeout",
    "provider_outage",
    "clock_skew",
    "dst",
    "timezone_travel",
    "stale_health_data",
    "ios_process_termination",
    "mac_sleep",
    "mac_reboot",
    "lost_acknowledgement",
    "retry_after_completed_side_effect",
]


def grade(map_path: Path, expected_classes: list[str], label: str) -> tuple[int, str]:
    """One map. Returns (failure count, one-line summary)."""
    failures: list[str] = []
    try:
        data = json.loads(map_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return 1, f"{label}: FAIL cannot read the map ({error})"

    entries = data.get("classes")
    if not isinstance(entries, list):
        return 1, f"{label}: FAIL `classes` must be a list"

    named = [entry.get("class") for entry in entries]
    for expected in expected_classes:
        if named.count(expected) != 1:
            failures.append(
                f"{expected}: named {named.count(expected)} time(s); the manifest names it once"
            )
    for extra in set(named) - set(expected_classes):
        failures.append(f"{extra}: not a class the manifest names — remove it, or add it to the checker")

    # Test titles, read once per file. Matching on the literal title rather
    # than a fuzzy search: a near-match is how a renamed test keeps passing.
    titles: dict[str, set[str]] = {}
    for entry in entries:
        for test in entry.get("tests") or []:
            path = test.get("file", "")
            if path in titles:
                continue
            source = (PLUGIN / path).resolve()
            if not source.exists():
                failures.append(f"{entry['class']}: names a file that does not exist ({path})")
                titles[path] = set()
                continue
            titles[path] = set(re.findall(r'it\(\s*"((?:[^"\\]|\\.)*)"', source.read_text(encoding="utf-8")))

    covered = 0
    for entry in entries:
        name = entry.get("class", "?")
        tests = entry.get("tests") or []
        if entry.get("covered"):
            covered += 1
            # A reliability entry may lean on a MECHANISM rather than a test --
            # launchd KeepAlive is not something a unit test can assert -- but
            # it has to say so and say why, so the weaker claim reads as one.
            if not tests and not entry.get("mechanism"):
                failures.append(f"{name}: marked covered with neither a test nor a mechanism")
            if not tests and entry.get("mechanism") and not entry.get("reason"):
                failures.append(f"{name}: leans on a mechanism with no reason given")
            for test in tests:
                title = test.get("title")
                if title is None:
                    # An explicit null means "this file carries it, and it is
                    # not a vitest title" -- the Swift suites. Allowed, and it
                    # still has to name a real file, which is checked above.
                    continue
                if title not in titles.get(test.get("file", ""), set()):
                    failures.append(
                        f"{name}: no test titled {title!r} in {test.get('file')} — "
                        "it was renamed or deleted, and the map still claims it"
                    )
        else:
            if not entry.get("reason"):
                failures.append(f"{name}: not covered and gives no reason")
            if not entry.get("residual"):
                failures.append(
                    f"{name}: gives a reason but no `residual` — say what would make this live"
                )

    for failure in failures:
        print(f"  FAIL  {label}: {failure}")
    summary = (
        f"{label}: {len(expected_classes)} named, {covered} covered, "
        f"{len(expected_classes) - covered} argued not-applicable with a residual"
    )
    return len(failures), summary


def main() -> int:
    results = [
        grade(ATTACK_MAP, MANIFEST_CLASSES, "attack surface"),
        grade(RELIABILITY_MAP, MANIFEST_SCENARIOS, "reliability"),
    ]
    total = sum(count for count, _ in results)
    for _, summary in results:
        print(f"  {summary}")
    print(f"coverage maps: {'OK' if total == 0 else f'FAIL ({total})'}")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
