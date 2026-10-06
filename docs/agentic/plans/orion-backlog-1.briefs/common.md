# ORION backlog 1 — shared brief

## Goal
ORION is Nick's external executive function: a Mac app, an iPhone app and an agent that runs his day. On 6 October 2026 Nick handed over a backlog. This batch does the parts that are pure, testable logic or self-contained phone code:
1. P0 — the iPhone voice conversation never ends on its own. It re-listens after every reply, after silence and after errors, so background speech kept becoming chat messages and burning API tokens until Nick revoked microphone access. Tasks `voice-guard` and `voice-wire` give it hard limits and a real stop.
2. Focus sessions — arbitrary sequences ("20 work, 5 break, 40 work"), starting from any point, recovering an accidentally ended session, and a true "focused today" total. Tasks `focus-sequence`, `focus-cli`, `focus-today`.
3. A chat-log audit script that finds recurring failures in real ORION conversations. Task `log-audit`.
Claude wires the Mac app side, tests on the real devices and reviews afterwards. Build exactly what each brief says, cleanly, and stop.

## Repository facts (true at HEAD)
- Node: `~/.openclaw/tools/node-v24.15.0`, ESM `.mjs`, tests in `tests/*.test.mjs` with `node:test` + `node:assert/strict`.
- `native/Orion/` (the Mac app) is CLOSED to this loop. Do not edit it; reading it is fine.
- Phone app: `native/OrionMobile/OrionMobile.xcodeproj`, target OrionPhone, files in `native/OrionMobile/App/` (already in the target; do not add new App/ files — new Swift goes in MobileCore). Shared Foundation-only library `MobileCore` in `native/OrionMobile/Sources/MobileCore/` (import ONLY Foundation). XCTest files go in `native/OrionMobile/Tests/AgentTasksTests/` (target exists, depends on MobileCore; use `@testable import MobileCore`).
- Focus sessions are owned by Orion.app. `scripts/orion-session` is a client: it sends `{ op, requestId, ... }` JSON to the app over a socket and prints the reply. The installed app (build 518, 6 Oct) ALREADY supports `{ op: "start-sequence", requestId, task, phases: [{ kind: "focus"|"rest", seconds }] }` (1–12 phases, each 1 s–4 h, at least one focus; a sequence may open on a break). Send exactly that shape.
- Focus history: one JSON object per line in `~/.openclaw/orion-controlled/focus-history.jsonl`, e.g.
  `{"approximate":false,"completedFocusBlocks":0,"dayKey":"2026-10-06","endedAt":"2026-10-06T19:44:13Z","plannedFocusSeconds":1800,"plannedRestSeconds":0,"reason":"early","servedFocusSeconds":96.2,"servedRestSeconds":0,"sessionID":"s-2e75…","startedAt":"2026-10-06T19:42:37Z","task":"focus test","totalFocusBlocks":1,"uncountedSeconds":0}`
  `reason` is one of `completed`, `early`, `abandoned` (treat anything else like `abandoned`).

## Shared conventions
- Never mutate arguments; return new objects/values. No `console.log` in library modules (CLIs print). Small functions. Node libraries throw `TypeError` on invalid arguments.
- Library code never reads the clock: "now" is a parameter. CLIs read the clock only where the brief says.
- No network and no real home directory in tests: `mkdtemp(join(tmpdir(), "orion-backlog-"))`, removed in `t.after`. Env overrides named in each brief point CLIs at temp files.
- Swift: value types, no force unwraps, no new dependencies, `public` on everything the App target uses.

## Working in this loop
- **Write first.** First exchange: `### FILE` your new files with the full public interface. Then improve with `### EDIT`. Never more than two exchanges in a row without writing.
- `### EDIT` (SEARCH/REPLACE) for existing files; `### FILE` only for new ones. Read check output after every write.
- READ at most 3–4 files per exchange. Keep code compact. No triple backticks inside file contents.
