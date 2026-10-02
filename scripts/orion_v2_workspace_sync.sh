#!/bin/bash
#
# The repo's `plugin/workspace/` is not what Orion reads.
#
# He reads `~/.openclaw/workspace/`, named by `agents.defaults.workspace` in
# openclaw.json. The repo copy is the tracked source; the live copy is what the
# gateway loads on every turn. Nothing kept them in step, which meant an edit to
# the tracked copy LOOKED like a change to Orion's operating rules and was not
# one -- the most expensive kind of silent failure, because the file's whole
# purpose is to be authoritative and it reads as authoritative either way.
#
# Found on 2026-09-06: AGENTS.md had two same-day additions in the repo (a date
# rule and an Atlas routing bullet) and neither was live. Before that the two
# had matched by hand for weeks, which is exactly why nobody noticed -- a manual
# process that usually works is indistinguishable from an automatic one until
# the day it doesn't.
#
#   orion_v2_workspace_sync.sh            report drift (default; CI runs this)
#   orion_v2_workspace_sync.sh --apply    copy repo -> live, backing up first
#
# TOOLS.md is deliberately excluded: it is GENERATED into the live workspace by
# the runtime, so the live copy is the newer one by design and copying the repo
# version over it would be a regression, not a sync.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO/plugin/workspace"
LIVE="${ORION_WORKSPACE:-$HOME/.openclaw/workspace}"
FILES=(AGENTS.md SOUL.md SELF.md USER.md PLAYBOOK.md MEMORY.md SCHEDULING.md)
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

if [ ! -d "$LIVE" ]; then
  echo "workspace sync: live workspace not found at $LIVE" >&2
  exit 1
fi

drift=0
for f in "${FILES[@]}"; do
  if [ ! -f "$SRC/$f" ]; then
    echo "  MISSING in repo   $f"; drift=$((drift + 1)); continue
  fi
  if [ ! -f "$LIVE/$f" ]; then
    echo "  MISSING live      $f"; drift=$((drift + 1))
  elif ! diff -q "$SRC/$f" "$LIVE/$f" >/dev/null 2>&1; then
    echo "  DRIFTED           $f  ($(diff "$LIVE/$f" "$SRC/$f" | grep -c '^>') lines the live copy does not have)"
    drift=$((drift + 1))
  else
    echo "  in step           $f"
  fi
done

# Skills are instructions Orion FOLLOWS, and they were the worse half of this
# problem. On 2026-09-07 seven live skills existed in no repo at all, and one of
# them -- an `accli` calendar skill -- was actively telling him to npm-install and
# shell out to a binary that is not allowlisted, competing with the repo's own
# calendar skill and producing denials he then retried. Nothing could see it,
# because nothing was looking.
#
# Reported, never auto-copied in either direction: a skill appearing live is
# either something Nick installed on purpose or something that arrived by
# itself, and those need different answers from a person.
for live_skill in "$LIVE"/skills/*/; do
  [ -d "$live_skill" ] || continue
  name="$(basename "$live_skill")"
  case "$name" in .*) continue ;; esac
  if [ ! -d "$SRC/skills/$name" ]; then
    echo "  UNTRACKED live      skills/$name"
    drift=$((drift + 1))
  fi
done
for repo_skill in "$SRC"/skills/*/; do
  [ -d "$repo_skill" ] || continue
  name="$(basename "$repo_skill")"
  if [ ! -d "$LIVE/skills/$name" ]; then
    echo "  tracked, NOT live   skills/$name"
    drift=$((drift + 1))
  fi
done

if [ "$drift" -eq 0 ]; then
  echo "workspace sync: OK — the tracked copy is what Orion reads"
  exit 0
fi

if [ "$APPLY" -eq 0 ]; then
  echo
  echo "workspace sync: DRIFT ($drift) — edits to the tracked copy are NOT live."
  echo "  re-run with --apply to install them"
  exit 1
fi

stamp="$(date +%Y%m%dT%H%M%S)"
backup="$LIVE/.backup-$stamp"
mkdir -p "$backup" || exit 1
for f in "${FILES[@]}"; do
  [ -f "$SRC/$f" ] || continue
  [ -f "$LIVE/$f" ] && cp -p "$LIVE/$f" "$backup/$f"
  cp "$SRC/$f" "$LIVE/$f" || exit 1
done
echo
echo "workspace sync: applied. previous copies in $backup"
