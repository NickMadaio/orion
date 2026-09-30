# Phone focus: remote access and day planning (2026-09-25)

**Owner:** Nick · **For:** Astra, when turning the full plan into loop batches.

Nick's direction for the phone: ORION does a lot, and the other surfaces stay,
but the phone is for two things:

1. **Remote access to the Mac.** Full remote access:
   - see the Mac;
   - control agent runs;
   - approve ORION's requests;
   - run Mac actions.
2. **Day planning.** A live schedule that looks like a calendar app's day view,
   to-do lists, and anything else ORION can do to shape the day.

This does not add phases. The work below belongs to existing phases (the
numbered sequence stands); it says which of their pieces the phone must
surface, and in what order.

## Data rule: one unified system, Apple's stores as the source of truth

- **Calendar and Reminders are read and edited directly on the phone**
  (EventKit). They already sync through iCloud, so an edit made in ORION appears
  in Apple Calendar and Reminders on every device, and the reverse.
- **To-dos live in the Reminders list named "Orion".** It is the same list the
  Mac's Tasks tab reads. If it does not exist, the default list is used.
- **ORION's own plan** (focus blocks, open time) comes from the Mac's published
  plan (`GET /plan`, Phases 23/39). It is drawn as ORION's, and never written
  into the calendar.
- The Mac's commitments are calendar events already, so they are not drawn
  twice.

## What the phone has now (UI complete; see HANDOFF.md)

| Surface | State |
|---|---|
| **Today**: Now/Next from calendar and plan, top to-dos with one-tap complete, sample day | Live on EventKit |
| **Plan › Schedule**: calendar-style day grid, overlap columns (`DayLayout` in MobileCore, with checks), red now line, day navigation, add/edit/delete events | Live on EventKit |
| **Plan › To-dos**: add, complete, edit (title, due, notes), delete; "Done today" | Live on EventKit |
| ORION plan blocks on the grid (dashed outline, read-only sheet) | Live when the Mac read session is connected |
| **Control › Your Mac**: presence, battery, disk, uptime, running apps | **Preview data** |
| **Control › Agent runs**: status, task strip, active task, Stop/Pause/Continue | **Preview data**, nothing sent |
| **Control › Approvals**: Approve/Deny | **Preview data**, nothing sent |
| **Control › Actions**: app_open, app_quit, system_status, timer_set, folder_create, with confirmation | **Preview data**, nothing sent |

Every preview control says in place that nothing was sent. `RemoteStore`
(App/RemoteViews.swift) is the single seam. The link fills `RemoteState` and
makes `send` real, and no screen changes.

## Backend work the plan must contain, by phase

**Remote access**
- **44 — Mac remote connection:** the outbound link the phone talks through,
  with presence and heartbeat (`MacLink`/`MacPresence` in MobileCore already
  model them). This is what turns Control from preview into live.
- **45 — Remote Mac read-only** (complete in core): serve `device.status.read`
  and `application.list` over the link into `RemoteState.mac`.
- **46 — Harmless Mac actions:** the phone's Actions list maps 1:1 to catalog
  names. Allowlist, confirmation, result shown in place.
- **49 — Remote approvals:** pending approvals list, and approve/deny with
  signed device identity. The UI exists.
- **Agent runs** (the local loop): expose each project's status, progress,
  active task and deferred list read-only, and pause/stop/continue as
  revision-free halts. That is the same contract as
  `scripts/orion-project-agent --project ID pause|stop|resume` and the Discord
  bridge.
- **56 — Remote session UI:** builds on the above.

**Day planning**
- **21/22/25 — tasks and calendar:** EventKit covers the phone. The Mac
  planner must read the same "Orion" Reminders list, so both see one set of
  to-dos.
- **23/39 — planner and daily planning:** "Plan my day" from the phone. The
  phone asks, the Mac proposes (`DayPlan.propose` exists in core), and the
  phone shows the proposal on the grid to accept.
- **39 — evening review:** completed, incomplete and carry-forward, from the
  same Reminders data (`EveningReview` exists in core).
- **41 — notifications:** next-block and to-do-due reminders.
- **65/66 — App Intents and Live Activities:** "add a to-do" from Siri or
  Shortcuts; the current block on the Lock Screen.

## Rules for phone tasks in loop batches

- Follow `docs/agentic/PLAN_STANDARD.md`. Each phone task owns its files, has
  its own check, and states its interface in the brief.
- UI changes keep every accessibility identifier and pinned string in
  `AppUITests/PhoneShellTests.swift`. `scripts/orion_v2_phone_check.sh` must
  stay green.
- Never present preview or sample data as real. The PREVIEW and SAMPLE labels
  stay until the data behind them is live.
