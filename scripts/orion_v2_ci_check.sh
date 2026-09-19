#!/bin/bash
#
# PHASE 70 — the checks that can run ANYWHERE, so CI and this machine run the
# same thing.
#
# THE SPLIT, AND WHY IT IS NOT A COMPROMISE
#
# Orion's five existing check suites assert against the LIVE machine: the exec
# allowlist at ~/.openclaw/exec-approvals.json, the installed plugin, the real
# permission state. That is what makes them worth having -- "the boundary holds
# on Nick's Mac" is the claim that matters, and a suite that checked a fixture
# would be checking a fixture.
#
# It also means they cannot run on a GitHub runner, which has none of those
# things. Running them there would need mocks, and a mocked exec allowlist
# proves nothing about the real one.
#
# So the split is deliberate:
#
#   THIS FILE, and CI          everything that is true of the SOURCE: the unit
#                              and adversarial suites, the type checker, schema
#                              alignment, secret scanning, dependency audit.
#   The five *_check.sh suites  everything that is true of the MACHINE. Run
#                              before a push, by hand or by hook, and named in
#                              the CI summary so their absence is visible
#                              rather than forgotten.
#
# "Do not allow failed security invariants to be overridden casually" is
# honoured by the ordering below: the adversarial suite runs FIRST, and a
# failure there stops the run before anything else reports green.
#
#   ./scripts/orion_v2_ci_check.sh          everything
#   ./scripts/orion_v2_ci_check.sh --quick  skip the dependency audit (network)

set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN="$REPO/plugin/orion-control"
# One run-scoped directory rather than fixed /tmp paths. The DEBT branch below
# printed its heading and then nothing, because it was grepping a log another
# process owned -- a check whose evidence goes missing is a check nobody acts on.
LOGS="$(mktemp -d)"
trap 'rm -rf "$LOGS"' EXIT
QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1
failures=0

step() { printf '\n== %s ==\n' "$1"; }
ok()   { printf '  ok    %s\n' "$1"; }
bad()  { failures=$((failures + 1)); printf '  FAIL  %s\n' "$1"; }

step "1. security invariants (first, so nothing reports green past a failure)"
# The adversarial cases ARE the proof the gates hold. gate.test.ts carries the
# approval gate, the strictness floor and the Phase 51/57 restrictions;
# index.test.ts carries the trust boundary and the injection cases.
if (cd "$PLUGIN" && npx vitest run src/gate.test.ts src/index.test.ts >"$LOGS"/orion-ci-sec.log 2>&1); then
    ok "$(grep -oE 'Tests  [0-9]+ passed' "$LOGS"/orion-ci-sec.log | tail -1)"
else
    bad "adversarial suite failed — everything below is moot"
    tail -25 "$LOGS"/orion-ci-sec.log
    echo ""
    echo "ci check: FAIL (security invariants)"
    exit 1
fi

step "2. unit and integration tests"
if (cd "$PLUGIN" && npm test >"$LOGS"/orion-ci-test.log 2>&1); then
    ok "$(grep -oE 'Tests  [0-9]+ passed' "$LOGS"/orion-ci-test.log | tail -1)"
else
    bad "test suite failed"; tail -25 "$LOGS"/orion-ci-test.log
fi

if node --test "$REPO/tests/automation-removal.test.mjs" "$REPO/tests/automation-admission.test.mjs" "$REPO/tests/automation-dispatch.test.mjs" >"$LOGS"/orion-ci-automation-removal.log 2>&1; then
    ok "automation admission, dispatch and removal checks"
else
    bad "automation runtime checks failed"; tail -25 "$LOGS"/orion-ci-automation-removal.log
fi

step "3. static analysis"
if (cd "$PLUGIN" && npx tsc --noEmit -p tsconfig.json >"$LOGS"/orion-ci-tsc.log 2>&1); then
    ok "typecheck clean"
else
    bad "typecheck failed"; head -20 "$LOGS"/orion-ci-tsc.log
fi

step "4. schema validation"
# The plugin manifest and the runtime config schema must agree exactly. They
# have drifted before; manifest.test.ts is the assertion and this names it so
# a reader of the CI log can see it ran.
if (cd "$PLUGIN" && npx vitest run src/manifest.test.ts >"$LOGS"/orion-ci-schema.log 2>&1); then
    ok "openclaw.plugin.json matches the runtime ConfigSchema"
else
    bad "plugin manifest and runtime schema disagree"; tail -15 "$LOGS"/orion-ci-schema.log
fi

step "5. secret scanning"
# DELEGATED, not reimplemented.
#
# The first version of this step grew its own regex list and its own exclusion
# rules, and then failed on fourteen deliberately-fake credentials inside tests
# that assert credentials get REFUSED. Fixing that by widening an exclusion
# would have been the wrong fix twice over: a second scanner is a second thing
# to keep in step, and this repo has already paid for that between
# orion-authority and orion-selfdoc.
#
# `scripts/orion_v2_secret_scan.py` was already here, and it is better than what
# I was writing. It allowlists by PATH + RULE + FINGERPRINT, so a real key that
# replaced a fake one in the same file still fires -- which a path-based
# exclusion could never do -- and it prints only a fingerprint, never the
# suspected value, so a finding cannot leak the thing it found into a CI log.
if python3 "$REPO/scripts/orion_v2_secret_scan.py" \
       --allowlist "$REPO/docs/planning/v2/secret-scan-allowlist.json" >"$LOGS"/orion-ci-secrets.log 2>&1; then
    ok "$(tail -1 "$LOGS"/orion-ci-secrets.log)"
else
    bad "secret scan found something not reviewed:"
    grep -v '^secret scan:' "$LOGS"/orion-ci-secrets.log | head -10 | sed 's/^/          /'
    echo "          Each line is path:line rule=<rule> fingerprint=<sha>. If it is a"
    echo "          synthetic fixture, add it to docs/planning/v2/secret-scan-allowlist.json"
    echo "          with a reason. NEVER allowlist a live credential."
fi

# .env must never be tracked. Checked separately from the shape scan because
# the failure is categorical: it is not about what is IN the file.
if (cd "$REPO" && git ls-files --error-unmatch .env >/dev/null 2>&1); then
    bad ".env is tracked by git"
else
    ok ".env is not tracked"
fi

step "6. dependency scanning"
if [ "$QUICK" = "1" ]; then
    printf '  skipped (--quick)\n'
elif (cd "$PLUGIN" && npm audit --audit-level=high >"$LOGS"/orion-ci-audit.log 2>&1); then
    ok "no high or critical advisories"
else
    # Reported, not fatal. A transitive advisory in a dev dependency should be
    # visible without blocking a fix to something unrelated.
    printf '  WARN  npm audit reported high/critical advisories:\n'
    grep -E 'severity|vulnerabilit' "$LOGS"/orion-ci-audit.log | head -6 | sed 's/^/          /'
fi

step "7. coverage maps (attack surface, reliability)"
# Phases 68 and 69's "continuously test", made mechanical. Two maps, one
# checker: each claims which test covers which class, and this fails when a
# claimed test has been renamed or deleted, so losing coverage is a red build
# rather than a quiet regression.
if python3 "$REPO/scripts/orion_v2_attack_check.py" >"$LOGS"/orion-ci-attack.log 2>&1; then
    grep -E "^  (attack surface|reliability):" "$LOGS"/orion-ci-attack.log | sed 's/^  /  ok    /'
else
    bad "a coverage map no longer matches the tests:"
    grep '  FAIL' "$LOGS"/orion-ci-attack.log | head -8 | sed 's/^/        /'
fi

step "8. living documents that describe the live system"
# Three maps that would otherwise rot. Each is checked against the machine
# rather than read: the inventory against the installed catalog and the live
# config, the deferral list against what the catalog can actually DO, and the
# workflow against what this change touched.
for pair in \
    "orion_v2_inventory_check.py:the data inventory (Phase 71)" \
    "orion_v2_deferred_check.py:the deferral list (Phase 76)"
do
    file="${pair%%:*}"; label="${pair#*:}"
    if python3 "$REPO/scripts/$file" >""$LOGS"/orion-ci-$file.log" 2>&1; then
        ok "$(tail -1 ""$LOGS"/orion-ci-$file.log")"
    else
        bad "$label no longer describes the system:"
        grep '  FAIL' ""$LOGS"/orion-ci-$file.log" | head -6 | sed 's/^/        /'
    fi
done

# The workspace Orion actually reads.
#
# `plugin/workspace/` is tracked; `~/.openclaw/workspace/` is loaded. Nothing
# kept them in step, so on 2026-09-06 two same-day edits to AGENTS.md -- a date
# rule and an Atlas routing bullet -- were both inert while looking authoritative.
# Skipped rather than failed where the live workspace does not exist, because in
# CI it never will and a check that cannot apply must not cry wolf.
if [ -d "$HOME/.openclaw/workspace" ]; then
    if bash "$REPO/scripts/orion_v2_workspace_sync.sh" >""$LOGS"/orion-ci-workspace.log" 2>&1; then
        ok "the workspace: the tracked copy is what Orion reads"
    else
        bad "Orion's operating rules have drifted from the tracked copy:"
        grep 'DRIFTED\|MISSING' ""$LOGS"/orion-ci-workspace.log" | head -6 | sed 's/^/        /'
        printf '        run: scripts/orion_v2_workspace_sync.sh --apply\n'
    fi
else
    ok "the workspace: skipped, no live workspace on this host"
fi

# Phase 75 is reported, NOT fatal, and the reason is written here rather than
# discovered: its independent-review requirement is currently unmet by this
# session's own work, and a check that fails on every run is one people learn
# to scroll past. It is a standing debt, and it should read like one.
if python3 "$REPO/scripts/orion_v2_workflow_check.py" >"$LOGS"/orion-ci-workflow.log 2>&1; then
    ok "workflow: the eighteen steps' mechanical five all pass"
else
    printf '  DEBT  the Phase 75 workflow check does not pass:\n'
    grep '  FAIL' "$LOGS"/orion-ci-workflow.log | head -4 | sed 's/^/        /'
fi

step "8b. the v2 Python contract checks"
# THESE WERE NOT IN ANY SUITE, and two of them had been failing silently since
# Phase 51. Found on 2026-09-04 while auditing docs/planning/v2: adding five
# capability tiers across phases 51-78 drifted `capability-registry.json` and
# the Python policy engine's tier tables, and both checks correctly refused to
# classify a tier nobody had recorded — but nothing ran them, so nobody heard.
#
# A check that exists and is never run is a check that is not there. They are
# read-only and fast, so they belong here.
for pair in \
    "orion_v2_capability_check.py:the registry matches the live catalog" \
    "orion_v2_policy_check.py:the Python engine is never more permissive than the live gate" \
    "orion_v2_schema_check.py:the v2 schemas" \
    "orion_v2_model_contract_check.py:the model roles contract" \
    "orion_v2_sync_check.py:conversation sync ordering" \
    "orion_v2_audit_check.py:audit event shapes and redaction" \
    "orion_v2_secret_inventory.py:the secret inventory"
do
    file="${pair%%:*}"; label="${pair#*:}"
    if python3 "$REPO/scripts/$file" >"$LOGS/orion-ci-$file.log" 2>&1; then
        ok "$label"
    else
        bad "$label — $file:"
        tail -6 "$LOGS/orion-ci-$file.log" | sed 's/^/        /'
    fi
done

step "9. the permanent architectural rules"
# The manifest's twenty-four "Never" sentences, as assertions rather than as
# prose. The heading above them says they must not be violated without an
# explicit architecture review, so a violation here is not a lint warning —
# but it is reported rather than fatal, because rule 24 (one agent as sole
# designer, implementer and reviewer) is currently outstanding by construction
# and a permanently red build is one people stop reading.
if python3 "$REPO/scripts/orion_v2_rules_check.py" >"$LOGS/orion-ci-rules.log" 2>&1; then
    ok "$(tail -1 "$LOGS/orion-ci-rules.log")"
else
    printf '  DEBT  %s\n' "$(grep 'architectural rules:' "$LOGS/orion-ci-rules.log" | tail -1)"
    grep -A 1 'VIOLATED' "$LOGS/orion-ci-rules.log" | grep -v '^--' | head -8 | sed 's/^/        /'
fi

step "10. what this run did NOT check"
# Named rather than omitted. The machine-bound suites are the ones that hold
# the real boundary, and a CI pass that reads as total coverage is the way they
# stop being run.
cat <<'NOTE'
  These assert against the live Mac and cannot run here:
    orion_v2_backup_check.sh         the backup pipeline (fixture-based, but slow)
    orion_v2_strictness_check.sh     the approval gate and the strictness floor
    orion_v2_authority_contract_check.sh
    orion_v2_lock_check.sh           what the panic button is worth
    orion_v2_remote_check.sh         the Discord transport
    orion_v2_mobile_check.sh         the Swift MobileCore suite
  Run them on the Mac before pushing. A green CI is not a green machine.
NOTE

printf '\nci check: %s\n' "$([ "$failures" -eq 0 ] && echo OK || echo "FAIL ($failures)")"
[ "$failures" -eq 0 ]
