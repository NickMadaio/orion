# ORION surfaces — shared brief

## Goal
ORION is Nick's external executive function: a Mac app, an iPhone app and a brain that knows his schedule. On 1 October 2026 Nick asked for: a "finished early" button that pulls the rest of his day forward; focus mode that runs on its own from his schedule and escalates (nudge, say it aloud, close an app, lock the Mac; on the phone warn at 10 minutes, block at 15); blocking phone apps by list instead of all at once; Deepgram's Flux turn-taking model; thinking orbs blended with ORION's hologram; a cleaner phone chat box; a chat mode on the Mac with saved conversations, a model picker and visible thinking; a movable, resizable main window; and a small composer on the floating pop-up so he can type back ("I'm on task").
This batch lays the FOUNDATIONS: pure tested logic, small CLIs, and self-contained SwiftUI views. Claude wires the views into the running app, tests on real devices, and makes the final design calls afterwards. Build what the task brief says, cleanly, and stop.

## Repository facts (true at HEAD)
- Node: `~/.openclaw/tools/node-v24.15.0`, ESM `.mjs`, tests in `tests/*.test.mjs` with `node:test` + `node:assert/strict`.
- Day blocks (from `scripts/lib/life/live-day.mjs` `toBlocks`): `{ id, title, kind, date, start, end, fixed, source, calendarId }`. `start`/`end` are minutes after local midnight (0..1440). `kind` comes from `classify(title)` in live-day.mjs: class, deadline, gym, study, side_project, meal, rest or other. `fixed: true` means it never moves. A real class is `kind === "class" && fixed && source !== "orion"`. ORION's own blocks have `source: "orion"`.
- `scripts/lib/life/day-check.mjs` exports `checkDay(blocks, { from })` → `{ ok, problems: string[], notes }`: no ORION block may overlap anything after `from`.
- `scripts/lib/life/commute.mjs` exports `commuteWalls(blocks, { commuteMinutes })` → `[{ start, end, title }]` (travel before the first real class, after the last, and around social plans).
- `scripts/lib/life/priority.mjs` exports `priorityOf(block)`; titles matching /\b(nap|wind down|sleep|bed)\b/i rank as sleep.
- Swift: Mac app in `native/Orion` — CLOSED to this loop (signing, Sparkle, LOCK); Mac screens go in the `OrionViews` library (`native/OrionMobile/Sources/OrionViews/`, SwiftUI, public types, colours in `ViewTokens`). Phone app in `native/OrionMobile/OrionMobile.xcodeproj` (target OrionPhone, iOS 17), files in `native/OrionMobile/App/`. Shared Foundation-only library `MobileCore` in `native/OrionMobile/Sources/MobileCore/` (it may import ONLY Foundation; a check fails on anything else). XCTest files for agent tasks go in `native/OrionMobile/Tests/AgentTasksTests/` (target already exists, depends on MobileCore, use `@testable import MobileCore`).
- The thinking orbs are vendored as module `ThinkingOrbsKit` (MIT): `ThinkingOrb(state: OrbState, size: OrbSize = .px64, theme: OrbTheme = .auto, speed: Double = 1, paused: Bool = false, displaySize: Double? = nil)` is a SwiftUI View. `OrbState` cases: working, searching, solving, listening, connecting, weaving, composing, breathing, shaping. `OrbTheme`: .dark, .light, .auto. Both the Mac target and the phone target already link it (`import ThinkingOrbsKit`).
- Phone style: `Phone.accent`, `Phone.text`, `Phone.dim`, `Phone.soft`, `Phone.violet`, `Phone.hairline`, `Phone.mono(size, weight)` (see App/ files). Mac style: `OrionTheme.*`. Text on the backdrop, not bubbles in boxes; dark, quiet, smooth springs (`.spring(response: 0.35, dampingFraction: 0.85)`).

## Shared conventions
- Never mutate arguments; return new objects/values. No `console.log` in library modules (CLIs print their output). Small functions. Throw `TypeError` on invalid arguments in Node libraries.
- Library code never reads the clock: "now" is a parameter. CLIs read the clock only where the task says.
- No network, no real home directory in tests: use `mkdtemp(join(tmpdir(), "orion-surfaces-"))` and remove it in `t.after`.
- Swift UI tasks: no new dependencies, no edits to files outside your scope, honour `accessibilityReduceMotion`, give every icon-only button an `accessibilityLabel`.

## Working in this loop
- **Write first.** First exchange: `### FILE` your new files with the full public interface. Then improve with `### EDIT`. Never more than two exchanges in a row without writing.
- `### EDIT` (SEARCH/REPLACE) for existing files; `### FILE` only for new ones. Read check output after every write.
- READ at most 3–4 files per exchange. Keep code compact. No triple backticks inside file contents.
