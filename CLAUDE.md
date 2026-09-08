# Claude Code repository entrypoint

Read `AGENTS.md` before touching this repository. It is the shared source of
working rules for Claude, Codex and other coding assistants.

## Where the program is

Use `planning/v2/PHASE_GATES.json` for phase state and `HANDOFF.md` for live
product evidence. Older phase counts and Discord setup instructions in this
entrypoint were superseded; do not infer a running channel or an unconfigured
account from them. Verify the installed route before claiming it works.

The current product delivery plan is
`planning/v2/PRODUCT_VISION_DELIVERY_2026-09-07.md`. It maps the supplied vision
to existing phases and recovery gates without replacing the numbered sequence.

The program is 85 numbered phases. The manifest is
`planning/v2/MANIFEST_PHASES.json`, generated from
`~/Desktop/Orion v two implementation plan.md`. Phase numbers are how Nick tracks
this and they are the only vocabulary for what comes next.

On 2026-09-01 a session proposed replacing the numbered phases with lettered
batches, A through H. That is **withdrawn**. The two bundles of work labelled
"Batch A" and "Batch B" in the handoffs really happened — they were Phase 33 plus
Phase 43, and Phase 40 — and the entries keep those names because that is what
the sessions called them. There is no Batch C. If a document tells you the next
work is a letter, it is out of date.

## The one thing that correction got right

Its finding was real, and it survives as a rule about how to READ a phase, not
about what order to do phases in:

> **Where a phase's requirements refer to the Python runtime or to `orion/*.py`,
> interpret them against the LIVE stack — the Swift app in `native/Orion` and the
> TypeScript plugin in `openclaw-plugins/orion-control`. The Python package is not
> the implementation path. This changes how requirements are READ; it does not
> change their ORDER.**

The manifest's Phase 0 inventoried `orion/*.py` as the running system. It was
already not the running system when that was written. But an inventory naming the
wrong stack does not make the requirements it precedes arrive in the wrong order,
and checking showed it did not: Phases 34-39 are Health UI, Health Journal,
Behavior Correlations, Experiment Mode, Health-Aware Planning and Daily Planning,
and not one of them has a Python dependency to inherit. Full reasoning, and the
findings that are still worth reading, are in
`planning/v2/PROGRAM_CORRECTION_2026-09-01.md`.

## Read these, in order

1. `HANDOFF.md`
2. `NICK-TODO.md`
3. `planning/v2/HANDOFF.md`
4. `planning/v2/PHASE_32_5_CAPABILITY_CHARTER.md`
5. `planning/v2/ROADMAP_AMENDMENTS.json`
6. `planning/v2/PROGRAM_CORRECTION_2026-09-01.md` — read the header first; its
   re-sequencing is superseded and its findings are not.
7. `docs/GAME_PLAN.md` — the July plan. Its permission half shipped; its
   architecture half did not. Read it so the reversal is not re-derived a third
   time.

Entries older than 2026-08-27 were moved out of both handoffs on 2026-09-01 into
`planning/_archive/`. Nothing was deleted, but do not plan from the archives.

## Gates and checkpoints

Phase 32.5 is a documentation checkpoint, not a numbered phase, and not
permission to skip ahead. `scripts/orion_v2_phase_gate.py` reads the `phases`
object in `PHASE_GATES.json` and does **not** enforce the additive `REC-*` IDs in
`ROADMAP_AMENDMENTS.json` — check that register by hand, and never claim the
checker enforced what it ignores. Follow the documented gate protocol in
`AGENTS.md`.

If this file or any linked handoff changed after the current Claude context
started, a link proves routing only — not that the running context loaded it.
Explicitly reread the files above before continuing. Preserve the dirty worktree.

Follow the roughly ten-phase review, repair, batch-report and local-commit
protocol in `AGENTS.md`; that scope is already authorized for future groups of
phases Nick asks to run. Provider selection, installations, restarts, new account
connections, expanded permissions and remote pushes still need their own
applicable authorization.
