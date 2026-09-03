#!/usr/bin/env python3
"""PHASE 69 — hold the attack-surface map to the tests it claims.

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
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MAP = REPO / "planning/v2/ATTACK_SURFACE.json"
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


def main() -> int:
    failures: list[str] = []
    try:
        data = json.loads(MAP.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"attack surface: FAIL cannot read the map ({error})")
        return 1

    entries = data.get("classes")
    if not isinstance(entries, list):
        print("attack surface: FAIL `classes` must be a list")
        return 1

    named = [entry.get("class") for entry in entries]
    for expected in MANIFEST_CLASSES:
        if named.count(expected) != 1:
            failures.append(
                f"{expected}: named {named.count(expected)} time(s); the manifest names it once"
            )
    for extra in set(named) - set(MANIFEST_CLASSES):
        failures.append(f"{extra}: not a class the manifest names — remove it or add it to MANIFEST_CLASSES")

    # Test titles, read once per file. Matching on the literal title rather
    # than a fuzzy search: a near-match is how a renamed test keeps passing.
    titles: dict[str, set[str]] = {}
    for entry in entries:
        for test in entry.get("tests") or []:
            path = test.get("file", "")
            if path in titles:
                continue
            source = PLUGIN / path
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
            if not tests:
                failures.append(f"{name}: marked covered with no tests listed")
            for test in tests:
                title = test.get("title", "")
                if title not in titles.get(test.get("file", ""), set()):
                    failures.append(
                        f"{name}: no test titled {title!r} in {test.get('file')} — "
                        "it was renamed or deleted, and the map still claims it"
                    )
        else:
            # An uncovered class has to say why, and has to say what would make
            # it live. The second half is the one that stops "not applicable"
            # from becoming permanent.
            if not entry.get("reason"):
                failures.append(f"{name}: not covered and gives no reason")
            if not entry.get("residual"):
                failures.append(
                    f"{name}: gives a reason but no `residual` — say what would make this class live"
                )

    for failure in failures:
        print(f"  FAIL  {failure}")
    print(
        f"attack surface: {len(MANIFEST_CLASSES)} class(es), {covered} covered by tests, "
        f"{len(MANIFEST_CLASSES) - covered} argued not-applicable with a residual — "
        f"{'OK' if not failures else f'FAIL ({len(failures)})'}"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
