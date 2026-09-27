# Phase 61: Prep Cards — Evidence Packet

## Baseline
- **Inspected source paths**:
  - `plugin/orion-control/src/prep.ts` — exports `termsFromEvent`, `PrepSection`, `renderCard`; implements mechanical keyword extraction and card rendering with unavailable-source distinction.
  - `plugin/orion-control/src/gate.test.ts` — contains "phase 61: prep cards that are not remembered" describe block with four tests covering term extraction, unavailable vs empty sources, no-save guarantee, and section bounding.
- **Limits**: No iOS app or computer-use layer code exists in this worktree; those surfaces are unavailable for direct inspection. Document store is unavailable (DOCUMENTS ingredient reported as unavailable per design). The fan-out executor that calls five sources in parallel is not present in these files; the brief records it as historical evidence from 2026-09-03 survey.

## Requirement matrix

| Requirement ID | Status | Evidence / Source Symbol | Notes |
|---|---|---|---|
| `assembles_threads_notes_tasks_documents_people_and_open_questions` | Built (partial) | `termsFromEvent` and `renderCard` in `plugin/orion-control/src/prep.ts`; tests in `gate.test.ts` describe block "phase 61: prep cards that are not remembered" | Mechanical keyword extraction from event title/attendees is implemented and tested. Card rendering with unavailable-source distinction is implemented and tested. The parallel fan-out executor (mail via orion-gmail-search, notes via orion-recall, tasks via orion-agenda, people, open questions via Phase 62 waiting list) is described in brief evidence from 2026-09-03 but the executor code was not located in this worktree. DOCUMENTS is deliberately absent — no document store exists. |
| `uses_temporary_context_and_does_not_make_everything_permanent_memory` | Built | `renderCard` in `plugin/orion-control/src/prep.ts` appends "Nothing here was saved"; `ACTION_CATALOG.prep_card` has `reversible: true`, `risk: "low"`; prep tier contains only `prep_card`; test verifies no write path | The card writes nothing. Permanent memory requires deliberate `orion-note --epistemic` call, which is a separate wrapper. Test in gate.test.ts asserts the catalog shape and the footer text. |

## Architecture and interfaces
- **Producer**: `plugin/orion-control/src/prep.ts` — `termsFromEvent(title, attendees)` extracts search terms mechanically; `renderCard(event, sections)` assembles the card text. The fan-out executor that calls five sources in parallel is not present in this worktree (historical per brief).
- **Consumer**: The model turn that receives the rendered card string. SessionDomain or the Swift client consumes it as temporary context for the upcoming event.
- **Serialized fields**: `PrepSection` interface with `label`, `status` ("ok" | "empty" | "unavailable"), `lines: string[]`, optional `reason`. Event shape: `{ title, when, attendees }`.
- **State ownership**: No state is written. All reads are from gated read-only sources (mail, notes, tasks, people, open questions). The card is ephemeral text returned into one turn.
- **Errors**: An unavailable source renders as "could not read — <reason>" with a blind-spot note, never as empty. This distinguishes "no material" from "source inaccessible".

## Smallest next slice
- **Proposed contracts**: None. The core prep-card logic (term extraction, rendering, no-write guarantee) is already implemented and tested. The missing piece is the parallel fan-out executor that calls five sources — but that executor was surveyed as existing on 2026-09-03 and is not in this worktree. Without it, there is no bounded implementation contract to propose: we cannot write code that calls orion-gmail-search, orion-recall, orion-agenda without knowing their current interfaces.
- **Blocker**: The fan-out executor was not found at any path under `plugin/orion-control/src/`. To proceed with an implementation contract, reconnaissance is needed to locate the executor that assembles the five sources into `PrepSection[]` and calls `renderCard`. If it does not exist in committed source, the next slice would be to implement it — but that requires knowing the current interfaces of orion-gmail-search, orion-recall, orion-agenda, and the Phase 62 waiting list filter.

## Test scenarios
- **Positive cases**:
  - `termsFromEvent("Weekly sync about the thesis extension deadline")` returns `["extension", "deadline", "thesis"]` — tested in gate.test.ts.
  - `renderCard` with mixed ok/empty/unavailable sections renders each correctly — tested in gate.test.ts.
  - Card footer contains "Nothing here was saved" — tested in gate.test.ts.
  - Section bounding: 20 lines truncated to 6 with "(+14 more)" — tested in gate.test.ts.
- **Failure cases**:
  - Unavailable source (e.g., token expired) renders as blind spot, not empty — tested in gate.test.ts.
  - Attendee name extraction from email local part — tested in gate.test.ts.
- **Injectable seams**: The `PrepSection[]` array is the seam. A test can inject sections with `status: "unavailable"` to verify blind-spot rendering. The fan-out executor (if it exists) would be the seam for injecting source failures (mail timeout, notes unavailable, etc.). Existing test suite: `npm test` in `plugin/orion-control`, specifically the "phase 61" describe block in `gate.test.ts`.

## Gates and handoff
- **Entry gate**: Phase 60 (satisfied per brief; entryRequiresPhase: 60, entrySatisfied: true).
- **Remaining hands-on proof**: Locate and verify the fan-out executor that calls five sources. If it exists, confirm it produces `PrepSection[]` with correct status values. If it does not exist in committed source, record as gap requiring implementation.
- **Rollback**: N/A — this task produces only documentation. No source changes.
- **Reviewer handoff**: Reviewer should verify that cited symbols (`termsFromEvent`, `renderCard`, `PrepSection`) exist at the stated paths and that the gate.test.ts describe block covers the four assertions listed above.
