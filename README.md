# ORION

A personal assistant that works as external executive function. ORION plans my
day around classes and deadlines, reminds me, notices when the plan slips, steps
in and follows up. It is a native macOS app, an iPhone app with widgets and
Screen Time integration, and a Discord/iMessage chat channel. It acts only
through a gated, audited set of tools.

It runs fully local by default: Ollama on the Mac serves a small front-desk model
(`qwen3.5:4b`) and a worker (`qwen3.5:9b`) behind an OpenClaw gateway. The cloud
model is used only for scheduling change requests, and only if enabled.

> Plan, remind, observe, intervene, follow up, adapt.

## What it does

- **Plans the day around fixed commitments.** It reads calendar events, classes
  and deadlines, then replans when something runs late. Empty time is filled by
  priority: classes, sleep, gym, study, side projects, rest. It ramps study time
  before exams, leaves a commute buffer, and adds a nap after a short night.
  Small changes move only what conflicts; if the result doesn't fit, it rebuilds
  the movable part of the day around fixed commitments. Every change is
  journaled and can be undone.
- **Plans sleep.** A short interview sets wake times and a sleep target. ORION
  schedules wake alarms on the Mac and the phone, nudges before bedtime, and
  escalates slowly (nudge, firm, warn, dim) while I'm still up. Lockdown comes
  only when the night is down to six hours or less.
- **Talks naturally.** Voice uses a wake word, speaker verification and self-echo
  guards, with local text-to-speech. Chat works from the phone, Discord and
  iMessage. Proactive messages from the Mac and the phone are mirrored into the
  phone chat, and a reply binds to the message it answers.
- **Keeps itself honest.** A claim classifier catches replies that say "done" or
  "can't" when no tool ran. A reply linter enforces spoken-style output. An eval
  harness replays scenarios against the live brain with real sends blocked, then
  grades the replies.
- **Watches the phone.** A DeviceActivity monitor nudges and then blocks
  distracting apps during work blocks and at night. Blocking is per group (for
  example browsers), driven by what I'm doing. The Focus lock, Live Activity,
  time-sensitive notifications and widgets share one app group.
- **Connects to services through declarative connectors.** Connectors are
  GET-only JSON specs, each pinned to one HTTPS host, with secrets in the
  Keychain. Existing ones cover TfL, Canvas LMS and more, and ORION can write a
  new one when it lacks one. Finance summaries come from Plaid, and ORION can run
  Shortcuts on an allowlist.
- **Builds itself.** A local agentic dev loop turns a lint-checked work plan into
  self-contained, tested modules. A local model writes them, a reviewer checks
  them, and anything the reviewer isn't confident about goes to a human.

## Architecture

| Layer | Stack | Path |
|---|---|---|
| Brain | OpenClaw agent on local Ollama models (4B front desk, 9B worker), tool allowlist and approval gate | `plugin/workspace/`, `plugin/orion-control/` |
| Action catalog | TypeScript plugin: typed actions, executors, verifiers, redaction | `plugin/orion-control/src/` |
| Account health | Plugin hooks that spot an unusable cloud account (no credit, usage cap, bad key) and tell me once on my phone | `plugin/orion-control/src/account-health.ts` |
| Mac app | SwiftUI: voice, dashboard, project runs, life watch, CloudKit link | `native/Orion/` |
| System bridge | Swift CLI over EventKit (calendar, reminders) | `native/OrionMacBridge/` |
| iPhone | SwiftUI, WidgetKit, DeviceActivity, ActivityKit, CloudKit sync | `native/OrionMobile/`, `native/OrionWidgets/`, `native/OrionLink/` |
| Life loop | Pure Node modules and CLIs (`orion-reschedule`, `orion-watch`, `orion-sleepplan`, ...) | `scripts/lib/life/`, `scripts/` |
| Chat path | Truth checks, reply lint, eval mode, connectors | `scripts/lib/remote/`, `scripts/lib/eval/`, `scripts/lib/connect/` |
| Agentic dev loop | Plan lint, briefs, worker/reviewer, recovery | `scripts/lib/agentic/`, `docs/agentic/` |
| Policy and registry | Python policy engine, v2 schemas and capability registry, checked in CI never to be more permissive than the live gate | `orion/core/`, `scripts/orion_v2_*` |
| Phone backend (v1) | Python device-pairing and sync service; superseded by CloudKit, still covered by its tests | `backend/` |

The phone never answers on-device; every message goes to the Mac. `OrionMobile`
shares the `MobileCore`, `ThinkingOrbsKit` and `OrionViews` packages.

Scheduling runs locally as a fixed sequence: read the day, the 9B fills one form,
and code compiles it to an exact scheduler command. Local-model results and the
routing decision are in `docs/evals/v3/REPORT.md`. Scheduling preferences are in
`plugin/workspace/SCHEDULING.md`.

Roughly 79k lines of Swift, 27k of TypeScript, 29k of Node and 48k of Python,
across about 400 commits since July 2026.

**Model usage.** Mac Settings, Model usage shows Today, 7-day, 30-day and
retained-history views. `node scripts/orion-usage --all --json` reports tokens,
recorded gateway cost, current-rate equivalent and configured ceilings without
making model calls. Recorded costs are estimates, not invoices.

**Conversation benchmark.** [The benchmark guide](docs/evals/conversation/README.md)
compares 3B/9B/27B local and Haiku/Sonnet candidates on shared factual,
conversational and tool-intent fixtures. The default is a dry run; real inference
runs keep tools disabled and need blind human review before a route is chosen.

**Canvas.** `orion-brain canvas-courses` lists current courses, and
`orion-connect canvas-course <id>` reads the syllabus and visible assessment
settings with source URLs and retrieval times. `orion-brain canvas-refresh <id>
<course note> --apply` updates the matching course notes in
`~/Documents/orionBrain`; omit `--apply` to preview. Local notes stay intact,
source blocks are replaced with conflict checks and backups, missing fields stay
unknown, and exam dates are never inferred. There is no polling and no Canvas
writes. See [the Canvas brain guide](docs/CANVAS_BRAIN.md).

**Thinking Orion.** The Mac and phone share one Thinking Orbs view: a gold orb
inside a light hologram shell, drawn in a single Canvas. The phone's Talk button
opens it full screen with live state and audio response. Original Orion and Black
Hole styles remain selectable. Typed replies stay in text; only replies to
wake-word or push-to-talk input are spoken.

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
- `LEARN.md` → `docs/learn/`: a study guide to the whole codebase (architecture, history, prompts, tools, walkthroughs)
- `AGENTS.md`: working rules for coding agents in this repo
- `docs/planning/v2/`: phase plans, the capability registry and the gates
- `docs/agentic/`: how the local dev loop works, and its plans

## Not in this repo

Build outputs, `node_modules/`, the vendored Ollama runtime, local state and
databases, and all secrets are left out.
