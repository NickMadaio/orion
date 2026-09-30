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
  adds a nap after a short night. A complete replacement request clears stale
  non-class/deadline blocks before writing the new day as one transaction.
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
| Legacy runtime | Original Python planner/executor (superseded, kept for reference) | `orion/` |

Roughly 79k lines of Swift, 27k of TypeScript, 29k of Node and 48k of Python
(the Python is legacy), across about 400 commits since July 2026.

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

## Key documents

- `HANDOFF.md`: current state, newest first
- `AGENTS.md`: working rules for coding agents in this repo
- `docs/planning/v2/`: phase plans, the capability registry and the gates
- `docs/agentic/`: how the local dev loop works, and its plans

## Not in this repo

This repo leaves out build outputs, `node_modules/`, the vendored Ollama
runtime, local state and databases, and all secrets.
