#!/usr/bin/env python3
"""PHASE 76 — the deferral list, enforced instead of remembered.

The manifest names fifteen things not to prioritise yet and ends "build the core
system first". A list like that is normally prose, and prose does not stop
anything: features do not arrive because somebody decided to defy the list, they
arrive one small reasonable step at a time until one day the system has
autonomous purchasing in it and nobody can name the commit.

So each of the fifteen gets a MECHANICAL definition of what its arrival would
look like -- an execution kind, a catalog action, a wrapper script, an allowlist
entry -- and this fails when one appears. It is a smoke alarm, not a lock: it
does not prevent anybody building these, it makes building one impossible to do
quietly.

Two of the fifteen are deliberately narrow, and the narrowness is the honest
part. `nutrition tracking` is deferred while `health_tracking` exists and logs
supplements, so the signal has to be nutrition SPECIFICALLY -- calories, macros,
a food log -- not any health feature at all. `full email client` is deferred
while Gmail READS exist, so the signal is a send or a draft path, not the
presence of mail.

A signal that fires on the thing already shipped is a signal that gets muted.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DIST = Path(os.environ.get("ORION_CATALOG_DIST", str(Path.home() / ".openclaw/extensions/orion-control/dist"))).resolve()
SCRIPTS = REPO / "scripts"
APPROVALS = Path.home() / ".openclaw/exec-approvals.json"

#: (name, regex that would match its arrival, what already exists and is fine)
DEFERRED = [
    ("full email client",
     r"email_(draft|reply|archive|label)|gmail[-_]send|mail_compose",
     "Gmail READS exist and are hard-wired --readonly --gmail-no-send. `email_send` is "
     "excluded from the pattern and checked separately: it has been a `simulate` stub for "
     "months, and a check that fires on the thing already shipped is one that gets muted."),
    ("full Apple Health replacement",
     r"healthkit|HKQuery|health_(import|sync|write_all)",
     "health_tracking logs supplements and workouts into Orion's own file. Reading HealthKit wholesale is the line."),
    ("nutrition tracking",
     r"calorie|macros?_log|nutrition_(add|log|track)|food_(log|diary)",
     "supplements are logged. Calories, macros and a food diary are the line."),
    ("medical diagnosis",
     r"\bdiagnosis\b|diagnose_|symptom_check|triage_medical",
     "nothing here interprets a symptom, and that is the line."),
    ("biological age",
     r"biological_age|bio_age|healthspan_score",
     "recovery and sleep are reported as given. A derived age is the line."),
    ("AI phone answering",
     r"twilio|voip|answer_call|phone_(answer|call)|sip_",
     "Phase 80 says define the policy before building. There is no telephony at all."),
    ("autonomous purchasing",
     r"purchase|checkout|add_to_cart|place_order|buy_",
     "nothing in this system spends money, and no action names a price."),
    ("banking automation",
     r"plaid_(transfer|move|pay)|ach_|wire_transfer|bank_(transfer|pay)",
     "Plaid READS balances for the dashboard. A transfer is the line."),
    ("autonomous payments",
     r"stripe|payment_(send|make)|pay_invoice|venmo|paypal",
     "no payment rail is reachable."),
    ("remote desktop streaming",
     r"screen_(stream|share|record)|vnc|rfb_|CGDisplayStream",
     "there is no screen capture of any kind — Phase 54 depends on that too."),
    ("general cloud file synchronization",
     r"s3_(sync|put)|dropbox|gdrive_(sync|upload)|cloud_sync",
     "files are local. orion-backup writes an encrypted archive to disk and uploads nothing."),
    ("password-manager automation",
     r"1password_(read|fill)|keychain_(read|dump)|op_item_get|autofill_credential",
     "1Password is in the focus allowlist so it stays usable, which is not automation of it."),
    ("plugin marketplace",
     r"plugin_(install|marketplace|registry_fetch)|install_extension",
     "one plugin, installed by hand through orion-deploy."),
    ("large multi-agent swarm",
     r"spawn_agents?[(]|agent_pool|swarm_|fan_out_agents",
     "orion-mission runs one runner. A pool is the line."),
    ("social features",
     r"share_to|social_(post|feed)|publish_public|follower",
     "nothing here publishes anywhere. The Discord bridge is a private DM to one person."),
]


def capability_names() -> dict[str, str]:
    """
    What the system can DO, as names — not as source prose.

    The first version regexed the compiled sources and produced two false
    positives immediately: `send` matched the word inside `email_send`, and
    `diagnos` matched `diagnostic` in a comment. Both are the same mistake, and
    it is the one `orion-authority` already documents about regex declarations:
    a line that MENTIONS an effect is not a line that performs one.

    So the surfaces here are structural. Action names, execution kinds, tier
    names, script filenames, allowlist entries. A capability arrives by being
    named, and prose about a capability is not one.
    """
    out: dict[str, str] = {}
    script = (
        "const { ACTION_CATALOG } = await import(process.argv[1] + '/catalog.js');"
        "const rows = Object.entries(ACTION_CATALOG).map(([name, d]) => "
        "[name, d.capabilityTier, d.execution.kind, d.execution.operation ?? ''].join(' '));"
        "process.stdout.write(rows.join('\\n'));"
    )
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script, str(DIST)],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode == 0:
        out["the action catalog"] = result.stdout
    out["wrapper script names"] = "\n".join(sorted(s.name for s in SCRIPTS.glob("orion-*")))
    try:
        approvals = json.loads(APPROVALS.read_text(encoding="utf-8"))
        out["the exec allowlist"] = "\n".join(
            str(entry.get("pattern", ""))
            for agent in (approvals.get("agents") or {}).values()
            for entry in (agent.get("allowlist") or [])
        )
    except (OSError, json.JSONDecodeError):
        pass
    return out


def simulated_only(action: str) -> bool:
    """
    Is this action a stub that performs nothing?

    `email_send` has been in the catalog for months with `execution: {kind:
    "simulate"}` -- it reports success and sends nothing. That is not "a full
    email client arriving", and a check that says it is would be muted within a
    week. So the line for email is a send path that ACTUALLY SENDS, and this is
    how that distinction is made rather than by widening a pattern.
    """
    script = (
        "const { ACTION_CATALOG } = await import(process.argv[1] + '/catalog.js');"
        "const d = ACTION_CATALOG[process.argv[2]];"
        "process.stdout.write(d ? d.execution.kind : 'absent');"
    )
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script, str(DIST), action],
        capture_output=True, text=True, timeout=30,
    )
    return result.returncode == 0 and result.stdout.strip() in {"simulate", "absent"}


def main() -> int:
    sources = capability_names()
    if "the action catalog" not in sources:
        print("deferred check: FAIL candidate catalog unavailable or malformed")
        return 1

    failures: list[str] = []
    for name, pattern, note in DEFERRED:
        expression = re.compile(pattern, re.IGNORECASE)
        for where, text in sources.items():
            hits = expression.findall(text)
            if hits:
                sample = ", ".join(sorted({str(h) for h in hits})[:4])
                failures.append(
                    f"'{name}' looks like it has arrived, in {where}: {sample}\n"
                    f"          {note}\n"
                    f"          If this is deliberate, say so in the manifest — do not widen the pattern."
                )

    # The one exclusion, checked rather than assumed. If email_send ever stops
    # being a simulation, this fires -- which is the whole point of pulling it
    # out of the pattern instead of just deleting it from the list.
    if not simulated_only("email_send"):
        failures.append(
            "'full email client': email_send is no longer a simulation — it now performs a "
            "real execution kind.\n"
            "          That is the line this deferral draws. Say so in the manifest."
        )

    for failure in failures:
        print(f"  FAIL  {failure}")
    print(
        f"deferred check: {len(DEFERRED)} deferred feature(s), scanned across "
        f"{len(sources)} surface(s) — {'none has arrived' if not failures else f'FAIL ({len(failures)})'}"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
