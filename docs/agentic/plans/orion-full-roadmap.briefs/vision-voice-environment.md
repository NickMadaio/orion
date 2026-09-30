# Voice, media, home, battery and meeting capture

## Where you start
READ native/Orion/Sources/SessionService/AudioCoordinator.swift, then docs/planning/v2/PRODUCT_VISION_DELIVERY_2026-09-07.md. The latter is an original roadmap, not current completion evidence.

## Capability requirements
Preserve audio ownership; plan measured voice/music coexistence and cancellation. Home control needs supported device-scoped adapter/readback/revoke. Battery needs verified OS support or guided settings. Meeting capture needs explicit recording state, consent, pause/stop and retention. Keep each integration separately gated.

## Interface
Write docs/planning/offline-roadmap-results/vision-voice-environment.md using the common report interface. Reference phase IDs and REC-* IDs without renumbering.

## Decisions
Do not rebuild already delivered Today or phone foundations. Compare current producer, consumer and persisted state. Missing source in committed worktree may be dirty checkout work; record integration prerequisite. Each optional integration gets its own user/provider/device gate.

## Tests
For each proposed seam name one positive and one injected failure scenario, existing test entry point, expected state and product-visible result. Separate installed/hardware proof from fixtures.

## Exchange plan
Exchange 1: ### FILE the report skeleton at your assigned path: the six section headings, and in Requirement matrix one row per requirement id from this brief (status "to verify"). Exchanges 2 onward: SEARCH/READ two or three files, then ### EDIT the section that finding belongs to, in the same exchange. Never spend more than two exchanges in a row without an EDIT. The doc-report check runs after every write and names what is still missing; when it passes and every row is filled, ### DONE.

## Traps and reviewer
No speculative unified rewrite, undeclared provider choice or authority from retrieved content. Reviewer verifies existing module references and exact remaining gap; documentation completion is not product completion.
