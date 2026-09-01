# Claude Code repository entrypoint

Read `AGENTS.md` before touching this repository. It is the shared source of
working rules for Claude, Codex and other coding assistants.

For ORION v2 work, refresh these files in order:

1. `HANDOFF.md`
2. `NICK-TODO.md`
3. `planning/v2/HANDOFF.md`
4. `planning/v2/PHASE_32_5_CAPABILITY_CHARTER.md`
5. `planning/v2/ROADMAP_AMENDMENTS.json`
6. `planning/v2/PROGRAM_CORRECTION_2026-09-01.md`
7. `docs/GAME_PLAN.md` — the July plan. Its permission half shipped; its
   architecture half did not. Read it so the reversal is not re-derived a third
   time.

The current numbered position is Phases 0–32 complete and Phase 33 not started.
**The manifest's ORDERING is superseded** by `PROGRAM_CORRECTION_2026-09-01.md`:
its Phase 0 inventoried a Python runtime that was already not the implementation
path, so every downstream phase number inherits that error. The requirements
stand; the sequence does not. Phase 33 is not next — it is Batch A, merged with
Phase 38, and the live Mac app currently violates it.
Phase 32.5 is a documentation checkpoint, not a numbered phase and not permission
to start Phase 33. The current phase checker does not read or enforce
the additive recovery IDs; follow the documented gate protocol in `AGENTS.md`.

If this file or any linked handoff changed after the current Claude context
started, a link proves routing only—not that the running context loaded it.
Explicitly reread the files above before continuing. Preserve the dirty worktree.
Follow the roughly ten-phase review, repair, batch-report and local-commit
protocol in `AGENTS.md`; that scope is already authorized for future batches
Nick asks to run. The existing mixed backlog needs the recovery plan first.
Provider selection, installations, restarts, new account connections, expanded
permissions and remote pushes still need their own applicable authorization.
