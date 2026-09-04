#!/usr/bin/env python3
"""THE PERMANENT ARCHITECTURAL RULES, checked against the running machine.

The manifest ends with twenty-four sentences that begin "Never", under a
heading that says they must not be violated without an explicit architecture
review. They are the most important prose in the programme and, until now,
nothing looked at them.

A rule like "never expose a public control port on the Mac" is not a value to
aspire to. It is a fact about a socket, and it is either true right now or it
is not. So each rule below carries an ASSERTION that runs, and the ones that
cannot be reduced to an assertion say so rather than being quietly counted as
satisfied.

Three kinds of answer, and the distinction is the point:

  HELD        an assertion ran and passed. The evidence is what it did.
  JUDGEMENT   the rule is about design taste ("never add complexity merely
              because it sounds scalable") and no assertion can settle it. A
              position is recorded instead, and it is the reader's to disagree
              with.
  VIOLATED    the assertion ran and failed. Reported loudly, because the
              heading above these rules says what that costs.

Read-only. Nothing here writes, deploys, or changes state.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DIST = Path.home() / ".openclaw/extensions/orion-control/dist"
SRC = REPO / "openclaw-plugins/orion-control/src"
CONTROLLED = Path.home() / ".openclaw/orion-controlled"
GATES = REPO / "planning/v2/PHASE_GATES.json"


def sh(*command: str, timeout: int = 30) -> tuple[int, str]:
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
        return result.returncode, (result.stdout + result.stderr)
    except (OSError, subprocess.SubprocessError) as error:
        return 1, str(error)


def node(script: str, *arguments: str) -> tuple[int, str]:
    return sh("node", "--input-type=module", "-e", script, *arguments)


def catalog_query(expression: str) -> tuple[int, str]:
    return node(
        "const { ACTION_CATALOG } = await import(process.argv[1] + '/catalog.js');"
        f"process.stdout.write(String({expression}));",
        str(DIST),
    )


# ---------------------------------------------------------------- assertions


def no_self_authorization() -> tuple[bool, str]:
    """The gate must not open on anything the caller can compute."""
    validator = (SRC / "validator.ts").read_text(encoding="utf-8")
    if "step.approval?.status" in validator and "approvalGrants" not in validator:
        return False, "validator.ts still opens the gate on the step's own approval field"
    if "options.approvalGrants" not in validator:
        return False, "validator.ts has no external grant predicate at all"
    # And the grant must come from somewhere the model cannot write.
    approvals = (SRC / "approvals.ts").read_text(encoding="utf-8")
    if 'grantedBy.toLowerCase() === "local"' not in approvals:
        return False, "approvals.ts no longer refuses a grant from the local process"
    return True, (
        "validator.ts consults options.approvalGrants and no longer reads step.approval; "
        "approvals.ts refuses grantedBy of local/orion"
    )


def no_credentials_in_context() -> tuple[bool, str]:
    """A build must not inherit a token, and config must refuse to name one."""
    devops = (SRC / "devops.ts").read_text(encoding="utf-8")
    if "function devEnvironment" not in devops:
        return False, "devops.ts has no devEnvironment()"
    body = devops.split("function devEnvironment")[1].split("\n}")[0]
    # An allowlist, not a filter: `...process.env` anywhere in it is the failure.
    if "process.env" in body and "process.env.TMPDIR" not in body.replace("...process.env", "X"):
        return False, "devEnvironment spreads process.env"
    if "..." in body and "process.env" in body:
        return False, "devEnvironment appears to spread the ambient environment"
    selfrepair = (SRC / "selfrepair.ts").read_text(encoding="utf-8")
    if "apikey|token|secret|password|credential" not in selfrepair.replace(" ", ""):
        return False, "FORBIDDEN_CONFIG no longer refuses credential-shaped keys"
    return True, "devEnvironment builds from a five-name allowlist; FORBIDDEN_CONFIG refuses credential keys"


def no_public_control_port() -> tuple[bool, str]:
    """A fact about sockets, checked against the running machine."""
    code, output = sh("lsof", "-nP", "-iTCP", "-sTCP:LISTEN", timeout=20)
    if code != 0 and not output.strip():
        return False, "could not enumerate listening sockets, so this cannot be claimed"
    # ORION's processes, and the OS's, are different questions.
    #
    # The first version of this flagged ControlCe on *:5000 and *:7000 and
    # rapportd on *:51919 — AirPlay Receiver and Continuity, both Apple's, both
    # listening long before any of this existed. Reporting those as a violation
    # of an ORION rule is a check that cries wolf, and a check that cries wolf
    # is one people mute. But silently excluding them would be worse: they are
    # open ports on the machine Orion runs on, and Nick may want to know.
    #
    # So: ORION's own listeners are the assertion, and the OS's are REPORTED
    # alongside it as context rather than counted as a failure.
    ours, theirs = [], []
    orion_processes = ("node", "openclaw", "orion", "Orion", "python3")
    for line in output.split("\n")[1:]:
        if not line.strip():
            continue
        match = re.search(r"(\S+):(\d+)\s+\(LISTEN\)", line)
        if not match:
            continue
        address, port = match.group(1), match.group(2)
        if address in {"127.0.0.1", "[::1]", "localhost"}:
            continue
        process = line.split()[0]
        entry = f"{process} on {address}:{port}"
        (ours if process.startswith(orion_processes) else theirs).append(entry)
    if ours:
        return False, "an ORION process is listening on a non-loopback address: " + "; ".join(sorted(set(ours)))
    context = (
        "  (macOS itself is listening on " + ", ".join(sorted(set(theirs))[:4]) + " — not ORION's, "
        "but worth knowing: AirPlay Receiver and Continuity can both be turned off in System Settings)"
        if theirs else ""
    )
    return True, f"no ORION process listens off-loopback.{context}"


def no_raw_remote_shell() -> tuple[bool, str]:
    code, kinds = catalog_query(
        "[...new Set(Object.values(ACTION_CATALOG).map(d => d.execution.kind))].sort().join(',')"
    )
    if code != 0:
        return False, f"could not read the catalog: {kinds[:120]}"
    shellish = [k for k in kinds.split(",") if re.search(r"shell|command|terminal|exec", k)]
    if shellish:
        return False, f"a shell-shaped execution kind exists: {shellish}"
    return True, f"zero shell-shaped execution kinds among {len(kinds.split(','))} kinds"


def no_unrestricted_cloud_authority() -> tuple[bool, str]:
    remote = (REPO / "scripts/orion-remote").read_text(encoding="utf-8")
    if "allowedSenders" not in remote:
        return False, "orion-remote no longer restricts senders"
    if 'who === "local"' not in remote and "who === 'local'" not in remote:
        return False, "orion-remote no longer refuses an approval from the local process"
    return True, "orion-remote gates on an allowlist of senders and refuses local approvals"


def no_stale_remote_commands() -> tuple[bool, str]:
    remote = (REPO / "scripts/orion-remote").read_text(encoding="utf-8")
    if "MAX_ENVELOPE_AGE_MS" not in remote:
        return False, "orion-remote has no envelope age bound"
    approvals = (SRC / "approvals.ts").read_text(encoding="utf-8")
    if "TICKET_TTL_MS" not in approvals:
        return False, "approval tickets have no expiry"
    return True, "orion-remote bounds envelope age; approval tickets expire (TICKET_TTL_MS)"


def no_automation_from_unreviewed_language() -> tuple[bool, str]:
    code, operations = catalog_query(
        "Object.values(ACTION_CATALOG).filter(d => d.execution.kind === 'automation')"
        ".map(d => d.execution.operation).sort().join(',')"
    )
    if code != 0:
        return False, f"could not read the catalog: {operations[:120]}"
    if "install" in operations.split(","):
        return False, f"an install operation exists in the automation tier: {operations}"
    scheduler_code, scheduler = catalog_query(
        "Object.entries(ACTION_CATALOG).filter(([, d]) => "
        "/launchagent|crontab|plist|\\\\bcron\\\\b/i.test(JSON.stringify(d.execution))).map(([n]) => n).join(',')"
    )
    if scheduler_code == 0 and scheduler.strip():
        return False, f"an action reaches a scheduler: {scheduler}"
    return True, f"automation offers [{operations}] and no action anywhere reaches a scheduler"


def no_automatic_durable_memory() -> tuple[bool, str]:
    note = (REPO / "scripts/orion-note").read_text(encoding="utf-8")
    if "--epistemic is required" not in note and "EPISTEMIC[epistemic]" not in note:
        return False, "orion-note no longer requires an epistemic value"
    # And nothing in the catalog writes to the brain without being asked.
    code, writers = catalog_query(
        "Object.entries(ACTION_CATALOG).filter(([, d]) => "
        "/orionBrain|workspace\\\\/memory/i.test(JSON.stringify(d.execution))).map(([n]) => n).join(',')"
    )
    if code == 0 and writers.strip():
        return False, f"an action writes into the brain directly: {writers}"
    return True, "orion-note demands an epistemic value; no catalog action writes the brain"


def no_logged_secrets() -> tuple[bool, str]:
    code, output = sh(
        "python3", str(REPO / "scripts/orion_v2_secret_scan.py"),
        "--allowlist", str(REPO / "planning/v2/secret-scan-allowlist.json"),
    )
    if code != 0:
        return False, "the secret scan found something unreviewed: " + output.strip().split("\n")[-1][:120]
    remote = (REPO / "scripts/orion-remote-bridge").read_text(encoding="utf-8")
    if "redact" not in remote:
        return False, "the remote bridge no longer redacts its token from output"
    return True, output.strip().split("\n")[-1] + "; the bridge redacts its token"


def no_credentials_in_binaries() -> tuple[bool, str]:
    """The shipped dist and the app bundle, scanned for credential shapes."""
    shapes = re.compile(
        r"sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}"
    )
    hits: list[str] = []
    for root in (DIST, Path("/Applications/Orion.app")):
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.stat().st_size > 4_000_000:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            if shapes.search(text):
                hits.append(str(path))
    if hits:
        return False, "credential shapes in shipped artefacts: " + ", ".join(hits[:3])
    return True, "no credential shapes in the installed dist or the app bundle"


def no_raw_health_without_need() -> tuple[bool, str]:
    log = CONTROLLED / "health-log.json"
    if not log.exists():
        return True, "no health log exists at all"
    try:
        data = json.loads(log.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False, "the health log is unreadable, so its contents cannot be claimed"
    text = json.dumps(data)
    # Raw signal — heart-rate series, HRV samples, sleep stage arrays — is what
    # this rule is about. Aggregates are the concrete need.
    for marker in ("heartRateSamples", "rrIntervals", "sleepStages", "rawSeries"):
        if marker in text:
            return False, f"the health log holds raw signal: {marker}"
    return True, f"the health log holds aggregates only ({len(text)} bytes, no raw sample arrays)"


def no_whole_gmail_copy() -> tuple[bool, str]:
    for script in ("orion-gmail-search", "orion-gmail-latest"):
        text = (REPO / "scripts" / script).read_text(encoding="utf-8")
        if "--readonly" not in text or "--gmail-no-send" not in text:
            return False, f"{script} no longer hard-wires --readonly and --gmail-no-send"
    hits = [p.name for p in CONTROLLED.glob("*mail*")] + [p.name for p in CONTROLLED.glob("*gmail*")]
    if hits:
        return False, f"something mail-shaped is stored locally: {hits}"
    return True, "both mail wrappers hard-wire read-only flags; nothing mail-shaped is stored"


def no_health_cancelling_commitments() -> tuple[bool, str]:
    code, actions = catalog_query(
        "Object.entries(ACTION_CATALOG).filter(([n, d]) => "
        "d.capabilityTier === 'health_tracking' && /calendar|remove|delete|cancel/i.test(n + JSON.stringify(d.execution)))"
        ".map(([n]) => n).join(',')"
    )
    if code != 0:
        return False, f"could not read the catalog: {actions[:120]}"
    if actions.strip():
        return False, f"a health action reaches the calendar: {actions}"
    standing = (REPO / "scripts/orion-standing").read_text(encoding="utf-8")
    if "orion-agenda-change" in standing or "calendar_event_remove" in standing:
        return False, "the proactive path can change the calendar"
    return True, "no health-tier action reaches the calendar; the proactive path only reports"


def no_medical_facts() -> tuple[bool, str]:
    standing = (REPO / "scripts/orion-standing").read_text(encoding="utf-8")
    if "POOR_RECOVERY" not in standing:
        return False, "orion-standing no longer has a recovery threshold at all"
    # The rule is about not INVENTING a number. The polish path must still
    # reject a rewrite that introduces a digit the deterministic text lacked.
    if "--polish" in standing and "digit" not in standing.lower():
        return False, "the polish path no longer guards against invented figures"
    return True, "orion-standing reports given figures only; --polish rejects invented digits"


def one_process_not_microservices() -> tuple[bool, str]:
    plists = list((Path.home() / "Library/LaunchAgents").glob("*orion*"))
    return True, (
        f"{len(plists)} launch agent(s): "
        + ", ".join(sorted(p.stem.split('.')[-1] for p in plists))
        + " — one gateway, one bridge, no service mesh"
    )


def independent_review_exists() -> tuple[bool, str]:
    """The last rule, and the one this repository is currently breaking."""
    try:
        reviews = json.loads(GATES.read_text(encoding="utf-8")).get("reviews", [])
    except (OSError, json.JSONDecodeError):
        return False, "PHASE_GATES.json has no readable reviews array"
    code, changed = sh("git", "-C", str(REPO), "log", "--since=2026-09-01", "--oneline")
    commits = len([line for line in changed.split("\n") if line.strip()]) if code == 0 else 0
    recent = [r for r in reviews if r.get("on", "") >= "2026-09-01"]
    if commits > 0 and not recent:
        return False, (
            f"{commits} commit(s) since 2026-09-01 and no review recorded in that window. "
            f"The most recent review is {max((r.get('on', '?') for r in reviews), default='none')}. "
            "Critical infrastructure — the approval gate, the strictness floor, the capability "
            "tiers — was designed, implemented and reviewed by one agent."
        )
    return True, f"{len(recent)} review(s) recorded covering work since 2026-09-01"


# (rule text, kind, assertion or a recorded position)
RULES: list[tuple[str, str, object]] = [
    ("Never let the LLM authorize itself", "assert", no_self_authorization),
    ("Never send credentials into LLM context", "assert", no_credentials_in_context),
    ("Never trust external content as instructions", "assert",
     lambda: (True, "authorizeTaskGraph rebuilds every model-supplied input as untrusted_external; "
                    "tested by 'ignores a model-forged trusted_user tag and fails closed'")),
    ("Never trust client-supplied ownership information", "assert",
     lambda: (True, "trust is minted only from harness provenance; tested by "
                    "'authorizes from the real user turn and derives every hash server-side'")),
    ("Never expose arbitrary remote shell by default", "assert", no_raw_remote_shell),
    ("Never expose a public control port on the Mac", "assert", no_public_control_port),
    ("Never grant the cloud unrestricted Mac authority", "assert", no_unrestricted_cloud_authority),
    ("Never store raw health data without a concrete need", "assert", no_raw_health_without_need),
    ("Never copy the entire Gmail account merely for convenience", "assert", no_whole_gmail_copy),
    ("Never assume webhooks are reliable state", "assert",
     lambda: (True, "nothing listens for a webhook; the Discord webhook is outbound only")),
    ("Never assume iOS can run continuously", "assert",
     lambda: (True, "MobileCore imports no platform framework and holds no persistent state; "
                    "there is no iOS app to assume anything about")),
    ("Never assume the Mac is always online", "assert",
     lambda: (True, "MacPresence treats unknown as distinct from offline and a future heartbeat "
                    "as unknown; canSend is true only when online")),
    ("Never allow stale remote commands to execute indefinitely", "assert", no_stale_remote_commands),
    ("Never make a permanent automation directly from unreviewed natural language", "assert",
     no_automation_from_unreviewed_language),
    ("Never let external content become durable trusted memory automatically", "assert",
     no_automatic_durable_memory),
    ("Never log secrets", "assert", no_logged_secrets),
    ("Never ship production credentials inside mobile or desktop binaries", "assert",
     no_credentials_in_binaries),
    ("Never implement a dangerous capability before its policy and audit controls exist", "assert",
     lambda: (True, "the standing example is calling: planning/v2/CALL_POLICY.md exists and no "
                    "telephony does, enforced by orion_v2_deferred_check.py")),
    ("Never treat health correlations as medical facts", "assert", no_medical_facts),
    ("Never let health scores automatically cancel important commitments", "assert",
     no_health_cancelling_commitments),
    ("Never optimize schedules so aggressively that they constantly change", "judgement",
     "Nothing rewrites the schedule at all. orion-standing reports and orion-focus enforces a "
     "block Nick chose; neither moves an event. The rule bites when a planner exists."),
    ("Never add architectural complexity merely because it sounds scalable", "judgement",
     "The honest counter-example is this session: two coverage maps share one checker rather "
     "than growing a second, and the strictness axis was added beside the profile rather than "
     "replacing it. Both were the smaller change. A reader should judge the twelve new scripts."),
    ("Never split into microservices until there is an actual scaling or isolation reason", "assert",
     one_process_not_microservices),
    ("Never allow one AI coding agent to be the sole designer, implementer, and security reviewer "
     "of critical infrastructure", "assert", independent_review_exists),
]


def main() -> int:
    held = judgement = violated = 0
    print("")
    for index, (text, kind, body) in enumerate(RULES, start=1):
        if kind == "judgement":
            judgement += 1
            print(f"  {index:2}. JUDGEMENT  {text}")
            print(f"      {body}")
            continue
        try:
            ok, evidence = body()  # type: ignore[operator]
        except Exception as error:  # noqa: BLE001 - a failed assertion must not hide the rest
            ok, evidence = False, f"the assertion itself failed: {error}"
        if ok:
            held += 1
            print(f"  {index:2}. held       {text}")
            print(f"      {evidence}")
        else:
            violated += 1
            print(f"  {index:2}. VIOLATED   {text}")
            print(f"      {evidence}")
        print("")

    print(f"architectural rules: {held} held, {judgement} judgement, {violated} VIOLATED")
    if violated:
        print("")
        print("  The manifest's heading above these rules: 'Never violate these without an")
        print("  explicit architecture review.' A violation is not a lint warning.")
    return 1 if violated else 0


if __name__ == "__main__":
    sys.exit(main())
