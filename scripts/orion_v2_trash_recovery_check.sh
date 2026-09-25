#!/bin/bash
# Phase 47: a file ORION deletes goes to the Trash and can actually be recovered.
#
# Runs a REAL file_delete through the plugin's compiled controller -- the same
# code the gateway runs -- against a sandbox "desktop" root and a sandbox Trash,
# with a person's approval grant bound to that exact action. Then recovers it
# with scripts/orion-undo and asserts the bytes are identical. With --live the
# Trash is the real ~/.Trash, proving the round trip through the Trash macOS
# actually uses; the file is a disposable one this check creates.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
# Inside the home folder: orion-undo only ever moves things there (M6).
SANDBOX="$(mktemp -d "$HOME/.orion-trash-check.XXXXXX")"; trap 'rm -rf "$SANDBOX"' EXIT
LIVE=0; [ "${1:-}" = "--live" ] && LIVE=1
TRASH="$SANDBOX/Trash"; [ "$LIVE" = 1 ] && TRASH="$HOME/.Trash"
mkdir -p "$SANDBOX/desktop" "$SANDBOX/Trash"
NAME="orion-trash-recovery-check-$$.txt"
head -c 4096 /dev/urandom > "$SANDBOX/desktop/$NAME"
BEFORE=$(shasum -a 256 "$SANDBOX/desktop/$NAME" | cut -d' ' -f1)
failures=0
check() { if [ "$1" = "0" ]; then printf 'ok   %s\n' "$2"; else printf 'FAIL %s\n' "$2"; failures=$((failures + 1)); fi; }

# With --live, the INSTALLED plugin the gateway runs, not the repo build.
PLUGIN_DIR="$REPO/plugin/orion-control"; [ "$LIVE" = 1 ] && PLUGIN_DIR="$HOME/.openclaw/extensions/orion-control"
echo "   plugin: $PLUGIN_DIR/dist"
TASK=$(cd "$PLUGIN_DIR" && "$NODE" --input-type=module -e "
import { runTaskGraph } from './dist/controller.js';
import { canonicalActionHash } from './dist/validator.js';
const step = { id: 'delete', action: 'file_delete', arguments: { root: 'desktop', relativePath: '$NAME' },
  dependsOn: [], risk: 'high', expectedEffect: 'File is in the Trash', verify: 'file_in_trash',
  sourceRefs: ['user_request'], reversible: true };
const graph = { version: '1', goal: 'Delete the check file', workingContext: '$SANDBOX',
  inputs: [{ id: 'user_request', kind: 'instruction', trust: 'trusted_user', content: 'delete $NAME' }],
  assumptions: [], retryBudget: 0, steps: [step] };
const grant = canonicalActionHash(step, graph.workingContext);
const result = await runTaskGraph(graph, { ledgerPath: '$SANDBOX/ledger.jsonl', desktopRoot: '$SANDBOX/desktop',
  trashRoot: '$TRASH', enabledTiers: new Set(['simulation', 'file_mutate']), approvalGrants: (h) => h === grant });
if (result.status !== 'succeeded') { console.error(JSON.stringify(result.validation.issues ?? result.steps)); process.exit(1); }
process.stdout.write(result.taskId);
")
check $? "a real file_delete ran through the plugin's controller, with a grant bound to that action"
[ ! -e "$SANDBOX/desktop/$NAME" ]; check $? "the file is gone from where it was"
# The exact path, not a listing: macOS privacy protection can refuse to LIST
# ~/.Trash to a terminal while a named file in it is still reachable -- which is
# also how the plugin's own file_in_trash verifier observes it.
[ -f "$TRASH/$NAME" ]; check $? "and it is in the Trash$( [ "$LIVE" = 1 ] && echo " (the real ~/.Trash)")"

OUT=$(ORION_LEDGER="$SANDBOX/ledger.jsonl" "$NODE" "$REPO/scripts/orion-undo" 2>&1)
echo "$OUT" | grep -q "$TASK"; check $? "orion-undo lists the deletion by task id"
OUT=$(ORION_LEDGER="$SANDBOX/ledger.jsonl" "$NODE" "$REPO/scripts/orion-undo" "$TASK" 2>&1)
echo "$OUT" | grep -q "would" && [ ! -e "$SANDBOX/desktop/$NAME" ]
check $? "without --yes it only says what it would do"
ORION_LEDGER="$SANDBOX/ledger.jsonl" "$NODE" "$REPO/scripts/orion-undo" "$TASK" --yes > "$SANDBOX/undo.out" 2>&1
check $? "orion-undo --yes succeeds"
AFTER=$(shasum -a 256 "$SANDBOX/desktop/$NAME" 2>/dev/null | cut -d' ' -f1)
[ "$BEFORE" = "$AFTER" ]; check $? "the file is back where it was, byte-identical"
[ ! -e "$TRASH/$NAME" ]; check $? "and no longer in the Trash"
grep -q "\"taskId\":\"$TASK\"" "$SANDBOX/undo-audit.jsonl"; check $? "the undo is audited"
ORION_LEDGER="$SANDBOX/ledger.jsonl" "$NODE" "$REPO/scripts/orion-undo" "$TASK" --yes > "$SANDBOX/again.out" 2>&1
[ $? != 0 ] && grep -qE "already at|no longer there" "$SANDBOX/again.out" && [ "$(shasum -a 256 "$SANDBOX/desktop/$NAME" | cut -d" " -f1)" = "$BEFORE" ]
check $? "undoing twice is refused: it never overwrites what is there"
# A forged ledger line cannot move things outside the home folder or into
# what ORION's safety rests on (review 2026-09-26, M6).
FORGED="orion-ffffffffffffffff"
printf '{"taskId":"%s","goal":"forged","steps":[{"stepId":"s","status":"verified","request":{"action":"file_delete"},"undo":{"operation":"move","from":"%s","to":"%s","description":"x"}}]}\n' \
  "$FORGED" "$SANDBOX/desktop/$NAME" "$HOME/.openclaw/orion-gate/forged-by-check" > "$SANDBOX/forged.jsonl"
ORION_LEDGER="$SANDBOX/forged.jsonl" "$NODE" "$REPO/scripts/orion-undo" "$FORGED" --yes > "$SANDBOX/forged.out" 2>&1
[ $? != 0 ] && grep -q "may never change" "$SANDBOX/forged.out" && [ ! -e "$HOME/.openclaw/orion-gate/forged-by-check" ] && [ -f "$SANDBOX/desktop/$NAME" ]
check $? "a forged ledger line cannot move a file into the gate"
[ "$failures" = "0" ] && echo "trash recovery check: OK" || { echo "trash recovery check: $failures FAILED"; exit 1; }
