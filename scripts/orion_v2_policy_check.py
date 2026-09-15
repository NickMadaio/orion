#!/usr/bin/env python3
"""Prove the policy engine is never more permissive than the live gate.

The engine does not replace `validator.ts` and `permissions.ts`; it has to agree
with them first. This runs every live action through the engine under every
permission profile and compares the answer with the one the live plugin gives.

The assertion is deliberately asymmetric. "Identical" would forbid the engine
from being stricter, and it is stricter on purpose in a handful of places --
each of which is printed with its reason so an intentional difference stays a
reviewed line rather than a surprise. "Never more permissive" is the property
that actually matters.

Read-only. Exit 0 when the engine holds the line, 1 otherwise.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from orion.core.tools.registry import decode_registry  # noqa: E402
from orion.security.decisions import SEVERITY, PolicyEngine  # noqa: E402
from orion.security.devices import Device, DeviceDirectory  # noqa: E402
from orion.security.profiles import PROFILE_TIERS, Profile, RISK_CEILING  # noqa: E402
from orion.security.request import PolicyRequest  # noqa: E402
from orion.security.risk import classify, tier_of  # noqa: E402
from orion.shared.result import DecisionOutcome  # noqa: E402

PLUGIN = REPO_ROOT / "openclaw-plugins" / "orion-control"
REGISTRY = REPO_ROOT / "docs" / "planning" / "v2" / "capability-registry.json"

#: A fixed instant. The engine takes the clock as an argument precisely so a
#: check like this is reproducible.
INSTANT = datetime(2026, 8, 23, 20, 0, tzinfo=timezone.utc)

DEVICE = "mac-studio-0001"
USER = "user-nick-0001"


def live_rules() -> tuple[dict[str, dict], dict[str, list[str]]]:
    """Ask the compiled plugin what it grants, rather than reading the source.

    Phase 4 learned this the expensive way: regex-parsing `catalog.ts` leaked
    fields between entries and reported 59 actions where there were 78.
    """

    script = """
const { ACTION_CATALOG } = require('./dist/catalog.js');
const { PERMISSION_PROFILES, profileAllowedTiers } = require('./dist/permissions.js');
process.stdout.write(JSON.stringify({
  catalog: Object.fromEntries(Object.entries(ACTION_CATALOG).map(([a, d]) => [a, {
    tier: d.capabilityTier, approval: d.approvalRequired, risk: d.risk, reversible: d.reversible,
  }])),
  profiles: Object.fromEntries(PERMISSION_PROFILES.map((p) => [p, [...profileAllowedTiers(p)].sort()])),
}));
"""
    result = subprocess.run(
        ["node", "-e", script], cwd=PLUGIN, capture_output=True, text=True, timeout=60
    )
    if result.returncode != 0:
        raise RuntimeError(f"could not read the live rules: {result.stderr.strip()[:400]}")
    payload = json.loads(result.stdout)
    return payload["catalog"], payload["profiles"]


def live_outcome(tier: str, approval: bool, allowed_tiers: set[str]) -> DecisionOutcome:
    if tier not in allowed_tiers:
        return DecisionOutcome.DENY
    return DecisionOutcome.REQUIRE_APPROVAL if approval else DecisionOutcome.ALLOW


def baseline(capability: str, profile: Profile) -> PolicyRequest:
    """The most ordinary request there is.

    Same device, authenticated user, no external data, nothing expired, nothing
    delegated. Anything the engine denies here, it denies for a policy reason
    rather than a circumstantial one.
    """

    return PolicyRequest(
        request_id="request-parity-0001",
        correlation_id="correlation-parity-01",
        authenticated_user=USER,
        origin_device=DEVICE,
        target_device=DEVICE,
        capability=capability,
        resource="parity-check",
        active_profile=profile,
        request_source="user_direct",
        external_data_involved=False,
        issued_at=INSTANT,
        expires_at=INSTANT + timedelta(minutes=5),
        security_state="normal",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=REGISTRY)
    parser.add_argument("--quiet", action="store_true")
    arguments = parser.parse_args()

    registry = decode_registry(json.loads(arguments.registry.read_text(encoding="utf-8")))
    catalog, live_profiles = live_rules()
    failures: list[str] = []
    stricter: list[str] = []

    # 1. The mirrored profile definitions must match the live ones set-for-set.
    for profile in Profile:
        mirrored = sorted(PROFILE_TIERS[profile])
        live = live_profiles.get(profile.value)
        if live is None:
            failures.append(f"live plugin has no profile named {profile.value}")
        elif mirrored != sorted(live):
            missing = sorted(set(live) - set(mirrored))
            extra = sorted(set(mirrored) - set(live))
            failures.append(
                f"{profile.value} tiers drifted: missing={missing} extra={extra}"
            )
    if sorted(live_profiles) != sorted(p.value for p in Profile):
        failures.append("the set of permission profiles itself drifted")

    # 2. Every live action must classify, and the registry must still describe
    #    the live catalog -- a parity result over a stale registry means nothing.
    for action, entry in registry.capabilities.items():
        live = catalog.get(action)
        if live is None:
            failures.append(f"{action} is in the registry but not in the live catalog")
            continue
        if tier_of(entry) != live["tier"]:
            failures.append(f"{action} tier drifted: registry={tier_of(entry)} live={live['tier']}")
        if entry.approval_required != live["approval"] or entry.risk != live["risk"]:
            failures.append(f"{action} risk/approval drifted from the catalog")
    for action in catalog:
        if action not in registry.capabilities:
            failures.append(f"{action} is live but absent from the registry")

    # 3. The recorded ceilings must still be the observed maxima.
    for profile in Profile:
        reachable = [
            classify(entry)
            for entry in registry.capabilities.values()
            if tier_of(entry) in PROFILE_TIERS[profile]
        ]
        observed = max(reachable, key=lambda level: level.rank)
        if observed.rank > RISK_CEILING[profile].rank:
            failures.append(
                f"{profile.value} can now reach {observed.value}, above its recorded "
                f"ceiling {RISK_CEILING[profile].value}"
            )

    # 4. The 390 combinations.
    engine = PolicyEngine(
        registry,
        DeviceDirectory([Device(DEVICE, USER, "paired", "macos", "key-mac-0001")]),
    )
    compared = 0
    for profile in Profile:
        allowed_tiers = set(live_profiles.get(profile.value, []))
        for action, entry in sorted(registry.capabilities.items()):
            live = catalog.get(action)
            if live is None:
                continue
            expected = live_outcome(live["tier"], live["approval"], allowed_tiers)
            decision = engine.evaluate(baseline(action, profile), now=INSTANT)
            compared += 1
            if SEVERITY[decision.outcome] < SEVERITY[expected]:
                failures.append(
                    f"MORE PERMISSIVE: {action} under {profile.value} -- "
                    f"engine {decision.outcome.value}, live {expected.value}"
                )
            elif SEVERITY[decision.outcome] > SEVERITY[expected]:
                stricter.append(
                    f"{action} under {profile.value}: engine {decision.outcome.value} "
                    f"vs live {expected.value} ({classify(entry).value}; "
                    f"{', '.join(decision.reason_codes)})"
                )

    if not arguments.quiet:
        levels: dict[str, int] = {}
        for entry in registry.capabilities.values():
            levels[classify(entry).value] = levels.get(classify(entry).value, 0) + 1
        print(f"policy check: {compared} combinations, {len(registry.capabilities)} actions")
        print("policy check: risk distribution " + " ".join(
            f"{level}={levels.get(level, 0)}" for level in ("R0", "R1", "R2", "R3", "R4", "R5")
        ))
        print(f"policy check: {len(stricter)} stricter-than-live combinations")
        for line in stricter:
            print(f"  stricter: {line}")

    if failures:
        print(f"policy check: FAIL ({len(failures)})")
        for line in failures[:40]:
            print(f"  {line}")
        return 1
    print("policy check: OK -- the engine is never more permissive than the live gate")
    return 0


if __name__ == "__main__":
    sys.exit(main())
