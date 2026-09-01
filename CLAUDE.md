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

The current numbered position is **Phases 0–33 complete; Phase 40 in progress; Phases 34–39 not started**.
**The manifest's ORDERING is superseded** by `PROGRAM_CORRECTION_2026-09-01.md`:
its Phase 0 inventoried a Python runtime that was already not the implementation
path, so every downstream phase number inherits that error. The requirements
stand; the sequence does not. Phase 33 was done as Batch A, merged with Phase 38, **against the live Mac app**,
which was violating it. Batches A and B are complete. Batch B delivered Phase 40's vocabulary, `scripts/orion-timezone`,
the tracked move, and a real day-key defect; it deliberately left the cron jobs on
`America/New_York` until Nick actually lands on **2026-09-08**, when
`orion-timezone set Europe/London` re-homes everything in one command.
**Batch C (close the Phase 1/5 gate by re-pointing the record) is next.**
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
