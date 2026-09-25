#!/bin/bash
#
# The approval gate and the strictness ladder, checked against the LIVE system.
#
# The plugin's own vitest suite proves the logic. This proves the four claims
# the logic rests on, and those are claims about Nick's actual machine rather
# than about a temp directory:
#
#   1. `orion-approve` and `orion-mode` are ABSENT from the exec allowlist, so
#      Orion's call to either is denied outright rather than prompted.
#   2. Both are in FORBIDDEN_SCRIPTS, so the self-repair engine will not edit
#      them -- the thing that vouches for a change cannot vouch for a change to
#      itself.
#   3. The gate root is not a mutable root for any action, and is not inside
#      `orion-controlled`, where Orion's writes are classified AUTO.
#   4. `approvalRoot` and `strictnessStatePath` are in FORBIDDEN_CONFIG, so the
#      grant directory cannot be redirected at somewhere Orion can write.
#
# A boundary made of four claims is only as good as the one nobody re-checks.
#
# Plus the compatibility claim that lets this ship at all: under the default
# `guarded` mode, every ACTION's derived level is what it was before any of
# this existed. That is asserted against the committed snapshot, not asserted
# in prose.
#
# Read-only. Nothing here changes live state; the mode is exercised through
# `--mode`, which is a what-if flag.

set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$HOME/.openclaw/extensions/orion-control/dist"
GATE="$HOME/.openclaw/orion-gate"
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); printf '  ok    %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3', got '$2')"; fi; }

echo ""
echo "== 1. the two human-only scripts are unreachable from exec =="

for script in orion-approve orion-mode orion-automation; do
    # `python3 -c` rather than grep: a substring match would pass on a comment
    # mentioning the name, and this needs to be an answer about the allowlist.
    found="$(python3 - "$script" <<'PY'
import json, os, sys
want = sys.argv[1]
path = os.path.expanduser("~/.openclaw/exec-approvals.json")
data = json.load(open(path))
hits = []
for agent, body in (data.get("agents") or {}).items():
    for entry in (body.get("allowlist") or []):
        if os.path.basename(str(entry.get("pattern", ""))) == want:
            hits.append(agent)
print(",".join(sorted(set(hits))) or "none")
PY
)"
    check "$script is on no agent's allowlist" "$found" "none"
done

# And the derived map agrees, which is the check that would catch an entry
# added later by any route at all.
for script in orion-approve orion-mode orion-automation; do
    level="$("$REPO/scripts/orion-authority" check "$script" 2>/dev/null | head -1 | awk '{print $2}')"
    check "orion-authority reports $script as NEVER" "$level" "NEVER"
done

# Phase 51: the bare `git` entry was ORION's last raw-shell route into a
# repository; the structured git operations replaced it, and Nick retired it on
# 2026-09-25. Only ORION's agent (main) is asserted -- crestodian is not ORION.
bare_git="$(python3 - <<'PY'
import json, os
data = json.load(open(os.path.expanduser("~/.openclaw/exec-approvals.json")))
allow = ((data.get("agents") or {}).get("main") or {}).get("allowlist") or []
print("present" if any(str(entry.get("pattern", "")) == "git" for entry in allow) else "retired")
PY
)"
check "ORION's allowlist has no bare git entry (Phase 51)" "$bare_git" "retired"

echo ""
echo "== 2. the self-repair engine refuses to edit them =="

for script in orion-approve orion-mode orion-automation orion-repair orion-forge; do
    klass="$(node -e '
const { classifyScript } = await import(process.argv[1] + "/selfrepair.js");
process.stdout.write(classifyScript(process.argv[2]).klass);
' --input-type=module "$DIST" "$script" 2>/dev/null)"
    check "classifyScript($script) is forbidden" "$klass" "forbidden"
done

echo ""
echo "== 3. the gate root is outside everything Orion can write =="

case "$GATE" in
    "$HOME/.openclaw/orion-controlled"*) bad "gate root is inside Orion's own state directory: $GATE" ;;
    "$HOME/Desktop"*)                    bad "gate root is on the Desktop, a mutable root: $GATE" ;;
    *)                                   ok  "gate root is outside orion-controlled and the Desktop" ;;
esac

# No action in the catalog can produce a path under the gate root. Asked of the
# catalog rather than of a list of action names, so a NEW write action is
# covered the day it is added.
reach="$(node -e '
const { ACTION_CATALOG } = await import(process.argv[1] + "/catalog.js");
const bad = [];
for (const [name, def] of Object.entries(ACTION_CATALOG)) {
  const ex = def.execution ?? {};
  for (const value of [ex.root, ex.subdirectory, ex.path, ex.rootArgument]) {
    if (typeof value === "string" && value.includes("orion-gate")) bad.push(name);
  }
}
process.stdout.write(bad.join(",") || "none");
' --input-type=module "$DIST" 2>/dev/null)"
check "no catalog action names the gate root" "$reach" "none"

# The mutable roots, read from the catalog rather than restated here.
roots="$(node -e '
const { MUTABLE_ROOTS } = await import(process.argv[1] + "/catalog.js");
process.stdout.write([...MUTABLE_ROOTS].sort().join(","));
' --input-type=module "$DIST" 2>/dev/null)"
check "mutable roots are still the three workspaces" "$roots" "desktop,scratch_workspace,test_workspace"

echo ""
echo "== 4. the gate paths cannot be redirected by a config change =="

for key in approvalRoot strictnessStatePath permissionStatePath; do
    klass="$(node -e '
const { classifyConfigPath } = await import(process.argv[1] + "/selfrepair.js");
process.stdout.write(classifyConfigPath("plugins.entries.orion-control.config." + process.argv[2]).klass);
' --input-type=module "$DIST" "$key" 2>/dev/null)"
    check "classifyConfigPath($key) is forbidden" "$klass" "forbidden"
done

echo ""
echo "== 5. an approval cannot be granted by the local process =="

# The live refusal, exercised end to end through the real script rather than
# through the module. This is the hole that existed until 2026-09-02:
# `orion-remote` is allowlisted, and a direct `handle` call presents "local".
out="$("$REPO/scripts/orion-remote" handle -- approve A-7F3K 2>&1)"
case "$out" in
    *"has to come from a person"*) ok "orion-remote refuses an approve from the local process" ;;
    *) bad "orion-remote did not refuse a local approve; it said: ${out:0:80}" ;;
esac

# ...and it is refused BEFORE the ticket is looked up, so a valid id would not
# have helped. Checked by the sentence, which names the sender and not the id.
case "$out" in
    *"A-7F3K"*) bad "the refusal quotes the id, which suggests it got as far as looking it up" ;;
    *) ok "the refusal is about the sender, not about the id" ;;
esac

echo ""
echo "== 5b. Nick's own turn is a valid approval; a page saying the same is not =="

# The voice path. Not voice-specific -- speech, a typed line and a Discord DM
# all arrive as the same authenticated turn, and none is trusted for being
# speech. What is trusted is that the harness minted the input, not the model.
grammar="$(node -e '
const { decisionsInUserTurn } = await import(process.argv[1] + "/approvals.js");
const t = {
  id: "A-7F3K", canonicalHash: "a".repeat(64), nonce: "n", action: "messages_send",
  summary: "s", context: "c", mintedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60000).toISOString(),
};
const say = (text) => (decisionsInUserTurn(text, [t])[0] ?? {}).decision ?? "nothing";
const cases = [
  ["approve A-7F3K", "approved"],
  ["yes, approve a 7 f 3 k", "approved"],
  ["what does A-7F3K do?", "nothing"],
  // Spelled without an apostrophe because this whole block lives inside a
  // single-quoted shell string. The contraction is covered in gate.test.ts.
  ["do not approve A-7F3K", "nothing"],
  ["deny A-7F3K", "denied"],
];
const wrong = cases.filter(([text, want]) => say(text) !== want).map(([text]) => text);
process.stdout.write(wrong.join(" | ") || "none");
' --input-type=module "$DIST" 2>&1)"
check "an approval is heard only when Nick decided one" "$grammar" "none"

echo ""
echo "== 5c. nothing in the catalog can schedule anything =="

# Phase 57: "the model may not silently install permanent automation." Enforced
# by the SHAPE of the catalog -- there is a propose operation and no install
# one -- rather than by a rule somebody has to keep remembering.
ops="$(node -e '
const { ACTION_CATALOG } = await import(process.argv[1] + "/catalog.js");
const auto = Object.values(ACTION_CATALOG)
  .filter((d) => d.execution.kind === "automation")
  .map((d) => d.execution.operation).sort();
process.stdout.write(auto.join(",") || "none");
' --input-type=module "$DIST" 2>/dev/null)"
check "automation offers propose and simulate, and no install" "$ops" "list,propose,simulate,withdraw"

scheduler="$(node -e '
const { ACTION_CATALOG } = await import(process.argv[1] + "/catalog.js");
const bad = Object.entries(ACTION_CATALOG)
  .filter(([, d]) => /launchagent|crontab|plist|\bcron\b/i.test(JSON.stringify(d.execution)))
  .map(([n]) => n);
process.stdout.write(bad.join(",") || "none");
' --input-type=module "$DIST" 2>/dev/null)"
check "no action anywhere reaches a scheduler" "$scheduler" "none"

echo ""
echo "== 6. guarded is still exactly what shipped =="

# Compared against GUARDED_BASELINE.json, which is a FIXTURE, not the derived
# snapshot. CURRENT_AUTHORITY.json is regenerated from the same command this
# check runs, so comparing the live map against it would pass no matter what
# changed. A baseline you regenerate is not a baseline.
drift="$(python3 - "$REPO" <<'PY'
import json, subprocess, sys
repo = sys.argv[1]
live = json.loads(subprocess.run([f"{repo}/scripts/orion-authority", "show", "--json"],
                                 capture_output=True, text=True).stdout)
before = json.load(open(f"{repo}/docs/planning/v2/GUARDED_BASELINE.json"))["actions"]
now = {c["name"]: c["level"] for c in live["capabilities"] if c["kind"] == "action"}
# Compatibility is about actions that EXISTED changing, and about actions
# disappearing. A new action is new work, not a regression -- Phase 51 added
# seven and this check failed on all of them, which was the check being wrong
# rather than the phase. Removals still fail: a capability that vanishes
# silently is exactly what a baseline is for.
changed = {k: (before[k], now.get(k)) for k in before if before[k] != now.get(k)}
added = sorted(set(now) - set(before))
print(json.dumps(changed) if changed else "none")
print(f"        ({len(added)} action(s) added since the baseline: {', '.join(added) or 'none'})",
      file=sys.stderr)
PY
)"
check "every action under guarded is exactly what it was at 2cf0445" "$drift" "none"

echo ""
echo "== 7. the modes actually differ, and the floor holds in all of them =="

levels_at() {  # levels_at <mode> -> "AUTO=n NOTIFY=n APPROVAL=n"
    "$REPO/scripts/orion-authority" show --mode "$1" --json 2>/dev/null | python3 -c '
import json, sys
rows = json.load(sys.stdin)["capabilities"]
counts = {}
for row in rows: counts[row["level"]] = counts.get(row["level"], 0) + 1
print(" ".join(f"{k}={counts.get(k,0)}" for k in ("AUTO","NOTIFY","APPROVAL")))'
}
contained="$(levels_at contained)"; guarded="$(levels_at guarded)"
open_mode="$(levels_at open)";      sovereign="$(levels_at sovereign)"
printf '        contained  %s\n        guarded    %s\n        open       %s\n        sovereign  %s\n' \
       "$contained" "$guarded" "$open_mode" "$sovereign"

field() { printf '%s\n' "$2" | sed "s/.*$1=\([0-9]*\).*/\1/"; }
a_c="$(field AUTO "$contained")"; a_g="$(field AUTO "$guarded")"
a_o="$(field AUTO "$open_mode")"; a_s="$(field AUTO "$sovereign")"
p_c="$(field APPROVAL "$contained")"; p_g="$(field APPROVAL "$guarded")"
p_o="$(field APPROVAL "$open_mode")"; p_s="$(field APPROVAL "$sovereign")"

if [ "$a_c" -lt "$a_g" ] && [ "$a_g" -lt "$a_o" ] && [ "$a_o" -le "$a_s" ]; then
    ok "AUTO grows monotonically across the four modes"
else
    bad "AUTO is not monotonic: contained=$a_c guarded=$a_g open=$a_o sovereign=$a_s"
fi

# The column that decides whether a rung has a job. `open` was briefly one rung
# softer everywhere, which made it a near-copy of `sovereign` -- 123 free
# against 124 -- and the two are only worth having if they differ in what they
# still STOP, not in how loudly they narrate.
if [ "$p_c" -gt "$p_g" ] && [ "$p_g" -eq "$p_o" ] && [ "$p_o" -gt "$p_s" ]; then
    ok "open keeps every gate guarded keeps, and sovereign is the rung that opens them"
else
    bad "the modes are not distinguishable by what they gate: contained=$p_c guarded=$p_g open=$p_o sovereign=$p_s"
fi

# The three that no delegation may free, asserted at the MOST permissive mode.
for action in self_config_authority_set messages_send self_plugin_authority_modify; do
    level="$("$REPO/scripts/orion-authority" show --mode sovereign --json 2>/dev/null \
             | python3 -c "import json,sys;print(next((r['level'] for r in json.load(sys.stdin)['capabilities'] if r['name']=='$action'), 'missing'))")"
    check "$action is still APPROVAL under sovereign" "$level" "APPROVAL"
done

# A command nobody has classified must stay closed even at sovereign. Asked of
# the live map: if no such command exists today the check says so rather than
# passing vacuously.
unclassified="$("$REPO/scripts/orion-authority" show --mode sovereign --json 2>/dev/null \
    | python3 -c '
import json, sys
rows = [r for r in json.load(sys.stdin)["capabilities"]
        if r["kind"] == "command" and "unclassified" in (r.get("rule","") + r.get("because",""))]
print("none" if not rows else ",".join(sorted({r["level"] for r in rows})))')"
case "$unclassified" in
    none)     ok "no unclassified allowlist entries exist right now (nothing to hold)" ;;
    APPROVAL) ok "unclassified allowlist entries stay APPROVAL even under sovereign" ;;
    *)        bad "an unclassified command relaxed below APPROVAL: $unclassified" ;;
esac

echo ""
echo "== 8. a broken delegation falls back to guarded, never to something softer =="

probe="$(mktemp -d)"
for content in '{not json' '{"mode":"unlimited"}' '{"mode":"sovereign","expiresAt":"banana"}' '{"mode":"sovereign","expiresAt":"2020-01-01T00:00:00Z"}'; do
    printf '%s' "$content" > "$probe/strictness.json"
    got="$(node -e '
const { resolveStrictness } = await import(process.argv[1] + "/strictness.js");
process.stdout.write(resolveStrictness(process.argv[2]).mode);
' --input-type=module "$DIST" "$probe/strictness.json" 2>/dev/null)"
    check "a delegation of ${content:0:34} reads as guarded" "$got" "guarded"
done
printf '%s' '' > "$probe/strictness.json"
rm -rf "$probe"

echo ""
echo "strictness/approval gate: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
