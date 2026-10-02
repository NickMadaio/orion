# ORION

**A personal AI assistant that works as external executive function.** ORION plans
my day around my classes and deadlines, reminds me, notices when the plan slips,
steps in, follows up and adapts. It runs across a native macOS app, an iPhone app
with widgets and Screen Time integration, and a Discord/iMessage chat channel. It
does all of this through a gated, audited set of tools rather than open-ended
access.

> Plan → remind → observe → intervene → follow up → adapt.

## What it does

- **Plans the day around fixed commitments.** It reads calendar events, classes
  and deadlines, then replans when something runs late. It fills empty time
  according to priorities: classes, then sleep, gym, study, side projects, rest.
  It ramps study time before exams, leaves a commute buffer around classes, and
  adds a nap after a short night. Small changes move only what conflicts; if
  the revised plan cannot fit, it rebuilds the remaining movable day around
  fixed commitments, placing explicit must-haves before normal and optional
  work. A complete replacement can clear stale non-class/deadline blocks first.
  Every change is journaled so it can be undone.
- **Talks naturally.** Voice uses a wake word, speaker verification and
  self-echo guards, with local text-to-speech. Chat is available from the phone,
  Discord and iMessage.
- **Keeps itself honest.** A claim classifier catches replies that say
  "done" or "can't" when no tool actually ran, and re-asks a stronger model. A
  reply linter enforces spoken-style output. An eval harness replays scenarios
  against the live brain with real sends blocked, then grades the replies.
- **Watches the phone.** A DeviceActivity monitor nudges and then locks
  distracting apps during work blocks and at night. The Focus lock, Live
  Activity, time-sensitive notifications and home- and lock-screen widgets all
  share one app group.
- **Connects to services through declarative connectors.** Connectors are
  GET-only JSON specs, each pinned to a single HTTPS host, with secrets kept in
  the Keychain. Existing ones cover TfL, Canvas LMS and more. ORION can write a
  new connector itself when it lacks one. Finance summaries come from Plaid, and
  ORION can run Shortcuts that are on an allowlist.
- **Builds itself.** A local agentic dev loop turns a lint-checked work plan
  into self-contained, tested modules. A local model (Qwen) writes them, a
  reviewer checks them, and anything the reviewer isn't confident about is
  escalated to a human.

## Architecture

| Layer | Stack | Path |
|---|---|---|
| Brain | OpenClaw agent on Claude (Haiku, escalating to Sonnet), tool allowlist + approval gate | `plugin/workspace/`, `plugin/orion-control/` |
| Action catalog | TypeScript plugin — typed actions, executors, verifiers, redaction | `plugin/orion-control/src/` |
| Mac app | SwiftUI — voice, dashboard, project runs, life watch, CloudKit link | `native/Orion/` |
| System bridge | Swift CLI over EventKit (calendar, reminders) | `native/OrionMacBridge/` |
| iPhone | SwiftUI + WidgetKit + DeviceActivity + ActivityKit, CloudKit sync | `native/OrionMobile/`, `native/OrionWidgets/`, `native/OrionLink/` |
| Life loop | Pure Node modules + CLIs (`orion-reschedule`, `orion-watch`, …) | `scripts/lib/life/`, `scripts/` |
| Chat path | Truth checks, reply lint, eval mode, connectors | `scripts/lib/remote/`, `scripts/lib/eval/`, `scripts/lib/connect/` |
| Agentic dev loop | Plan lint, briefs, worker/reviewer, recovery | `scripts/lib/agentic/`, `docs/agentic/` |
| Policy & registry | Python policy engine, v2 schemas and capability registry — checked in CI never to be more permissive than the live gate | `orion/core/`, `scripts/orion_v2_*` |
| Phone backend (v1) | Python device-pairing and sync service with P-256 device identity; superseded by CloudKit, still covered by its tests | `backend/` |

`OrionMobile` exposes shared `MobileCore`, `ThinkingOrbsKit` and `OrionViews`
packages. The 2026-10-02 integration connects Home chat and a compact composer
in the Plan tab, shared history
and model selection (with Back to Home retaining the conversation), the floating
composer, persistent movable windows, orb
phases, Flux turns with Apple fallback, finished-early actions, and schedule
focus with named phone lists. Actual OpenClaw thinking is retained after the
answer. Intrusive Mac actions still require the existing focus enforcement
switch; phone restrictions require its Screen Time consent and opaque app
selections. See `HANDOFF.md` for installed proof and checks still outstanding.

Schedule edits preserve explicit per-date times through cascades, reuse existing
replacement tasks, apply saved minimums today, and support relative moves.
`docs/evals/2026-10-02-schedule/SUMMARY.txt` records Sonnet's latest 15/16 core
(21/22 overall), Haiku's 16/16 core, and Qwen 3.5 9B's 8/16 core. Sonnet is
recommended for complex edits; Qwen has not passed the schedule gate. Provider
defaults were not changed.

Roughly 79k lines of Swift, 27k of TypeScript, 29k of Node and 48k of Python,
across about 400 commits since July 2026.

Model usage is available in Mac **Settings → Model usage**, with Today, 7-day,
30-day and retained-history filters. `node scripts/orion-usage --all --json`
reports input/output/cache tokens, recorded gateway cost, current-rate equivalent,
pricing coverage and configured ceilings without making model calls. Recorded
costs are estimates, not invoices; zero-priced cloud records are not assumed free.

A later conversation comparison is prepared in
[the benchmark guide](docs/evals/conversation/README.md). The 3B/9B/27B local
and Haiku/Sonnet candidates share factual, conversational and tool-intent
fixtures. The default is a dry run; explicit inference runs keep tools disabled
and require blind human review before selecting a route.

## Safety model

- Actions go through a typed catalog with an executor and a verifier for each
  action. The model can't call arbitrary shell commands, only allowlisted
  wrapper scripts.
- Outward actions (sending messages, purchases, deletions) require approval.
  Commands that expand ORION's own permissions, such as `orion-connect-admin`,
  are deliberately never allowlisted.
- Secrets stay in the macOS Keychain and are never written to disk or logs. In
  eval mode, real sends are refused at the wrapper level.

## Tests

```bash
node --test tests/*.test.mjs                 # life loop, chat path, connectors, agentic runtime
(cd plugin/orion-control && npm test)        # action catalog, executors, verifiers
bash scripts/orion_v2_ci_check.sh            # registry + plugin + workspace consistency
```

The Swift test harnesses are in `native/Orion/Tests/` and
`native/OrionMobile/Tests/`.

## Repository map

```
native/      SwiftUI apps: Orion (Mac), OrionMobile (iPhone), OrionWidgets, OrionLink (CloudKit), OrionMacBridge (EventKit CLI)
plugin/      orion-control (TypeScript action catalog) and workspace/ (the agent's operating context and skills)
scripts/     allowlisted wrapper CLIs ORION calls, plus lib/ (life loop, chat path, connectors, agentic runtime) and gate checks
tests/       Node and Python test suites
orion/       Python policy engine, schemas and capability registry
backend/     v1 phone backend (superseded by CloudKit)
docs/        vision, phase plans, agent work plans — see docs/README.md
```

## Key documents

- `HANDOFF.md`: current state, newest first
- `AGENTS.md`: working rules for coding agents in this repo
- `docs/planning/v2/`: phase plans, the capability registry and the gates
- `docs/agentic/`: how the local dev loop works, and its plans

## Not in this repo

This repo leaves out build outputs, `node_modules/`, the vendored Ollama
runtime, local state and databases, and all secrets.

Scheduling preferences live in `plugin/workspace/SCHEDULING.md`, installed into
ORION's workspace and supplied to scheduling chat turns. Whole-day planning
combines `day --todos --plan …`. The shared controlled settings hold Nick's
five-minute transitions, 45-minute commute and protected minimums. “I'm out
early” shortens the current class/task in an undoable transaction, with travel
home preserved after the final class. Evaluation check-ins have a separate
store and cannot produce live notification alerts.

**Thinking Orion** combines Thinking Orbs geometry with the original hologram’s
filament shell, latitude arcs, drifting chips, bright core and lens flare.
Thinking stays gold and brings the larger, brighter twisting orb to the front
of the shell. Motion runs at 45% speed; audio response remains immediate. The combined
projection uses one Canvas with batched geometry, avoiding stacked blurred
animation surfaces. Original Orion and
Black Hole remain selectable. Thinking text is visible when available, including
while a turn is pending. Typed replies, timers and focus feedback stay in text;
only replies to wake-word or push-to-talk voice input are spoken.
