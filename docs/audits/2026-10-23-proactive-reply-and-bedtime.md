# Proactive replies with no context, and bedtime nags while in bed (2026-10-23)

Branch `fix/outreach-context-bed` (worktree `ORION-worktrees/outreach-bed`). Live state was only read. No message was sent and the calendar was not touched.

## Problem 1: "if i respond he doesnt have context of him talking to me proactively"

### Which channel "texts" was

Every row `orion-reach` delivers (phone, mac-bubble and mac-voice) is copied into the phone's ORION chat thread (`outreach-outbox.jsonl` → OrionLink → CloudKit; `chats/phone-history.json` holds 142 ORION rows). A push only goes out when `channel == phone`. Discord (`outbox.jsonl`) carries nothing proactive after 2026-09-05. iMessage is not used for outreach.

His real replies to proactive messages (from `chats/*.json` and the gateway transcripts):

| When (UTC) | ORION said first (channel) | His reply (where) | What the turn got | ORION answered |
|---|---|---|---|---|
| 10-16 01:44:23 → 01:45:18 | "Session done… past bedtime; sleep now" (mac-voice) | "Yea yea yea I know, just wrapping up my work now. Then sleep. Push my alarm to 12" (**phone**, session `orion-app-v2`) | A fresh gateway session (new id at 01:45:29), with the outreach only as a label line | "Reminder set for Friday at 12:00 PM: push my alarm." |
| 10-19 20:53:02 → 20:54:13 | "Nothing planned till 10:30 - what are you up to? I could put CS Lab there." (mac-voice, ask) | "yes, put cs lab until 10:30" (Mac) | A new session; a label with the ask | "CS Lab is not being added yet — I need to ask you to confirm" (fixed 10-19, covered by `cslab-incident-2026-10-19.test.ts`) |
| 10-19 23:02:56 → 23:03:03 | "It's 12:02 AM, bedtime. Sleep now…" (mac-bubble) | "im doing work shush up" (Mac) | A new session (`5aa4563a`); a plain "you messaged him first" label | "Since when — what time did you start work?" Then at 23:43 "Still up at 12:43 AM…" was sent anyway |
| 10-20 19:45:10 → 19:45:20 | "It's been 30 min. Gym, now. Phone down." (mac-voice, mismatch ladder rung 3) | "I'm meal prepping. That's why. Sorry." (Mac, spoken) | A new session (`97949e09`); a label with the mismatch ask | "What time or how long do you mean? I haven't changed anything." ×2, then "I didn't actually do that — nothing was started or changed." |

### Where it breaks

1. **The outreach is never part of any conversation.** It exists in `outreach.jsonl` and the CloudKit thread, but in no gateway session transcript. The reply lands in `orion-chat-<macChatId>` (Mac) or `orion-chat-<threadId>` / `orion-app-v2` (phone), and the gateway resets a session after 45 idle minutes (`session.reset.idleMinutes: 45`). In all four incidents the reply opened a **new session id**, so the model saw no history at all. The only trace of ORION's message was a one-line label.
2. **The label is present but the routing ignores it.** The plugin's `userText()` strips `[ORION context: …]`. The front desk is called with `decide({ message, clock })` and no history. `parseAskContext()` only understands blank or mismatch asks. A plain "you messaged him first" (every bedtime and session line) gives the flows nothing. The phone's compact format (`- N min ago you messaged him first: "…"`) is not parsed at all. So "I'm meal prepping" went to the schedule flow as a change request with no time, and "shush up" went to the log flow.
3. **Window and ID matching mostly work.** Every incident was within 0 to 1 minutes of the outreach, and the label was attached each time. The weak spot: the phone path picks only the newest delivered row, so a later mac-bubble line hides an earlier ask the phone reply answers when no `replyTo` comes with it. Also, `inbound-turns.jsonl` contains turns written by test runs (`from: local`, "approve A-7F3K") against the live directory, which can make the "no turn since" rule drop real context.

## Problem 2: "go to bed WHILE IM TRYING TO SLEEP"

Bedtime ladder (`lib/reach/proactive.mjs`): `bed-wind` 30 min before, `bed-now` 0–20 min after, `bed-late` 40–150 min after (only when Mac idle < 300 s). Plus the late "Session done… past bedtime" line. Gate: `sleep.state == asleep` holds; `late-awake` (inside the window and Mac input < 5 min, or the phone off the charger or moving) routes to a mac-bubble. That bubble is mirrored into the phone thread.

Real instances:

- 10-18 23:01 "It's 12:01 AM, bedtime" (mac-bubble, "he's up inside his sleep window"), then at 00:43 he said "going to bed now", and at 00:45, 00:50 and 00:55 the Gym ladder still nagged (fixed 10-19 by `sleep-declared.json`).
- 10-19 22:33 "Bed at 12:00 AM… Start wrapping up" was a **phone push**, because the Mac had been idle 11 min. The `bed-wind` rung is never gated by sleep evidence, since it comes before the window opens.
- 10-19 23:43 "Still up at 12:43 AM" (mac-bubble), 40 minutes after he answered the 23:02 nag with "im doing work shush up". A reply to a bedtime nag never stops the ladder. The phone went on the charger and still at 23:44.
- 10-20 23:28 and 10-22 23:42 "Still up…" (mac-bubble). Mac input under 5 min counts as "up". Nothing checks the phone (charging and still) or how long he has been away from the Mac.

Why the gate did not hold them:

- `sleepFacet` treats **one** recent Mac input as late-awake and never considers the phone settled (charging and still) as evidence of bed. `phoneUp` counts a phone that is merely off the charger as "up".
- `bed-wind` is outside the window and goes out on any channel, even with the Mac locked and the phone on the charger.
- Nothing records that he answered a bedtime nag. Each rung is a separate key, so the ladder escalates to its end regardless.
- The ladder has no "inactive after bedtime" rule. Mac idle for N min plus the phone not in use after bedtime should end it, not route it to the phone.

## Fixes and tests

Commits on `fix/outreach-context-bed`: `5be0bd1`, `17ffc8b`, `a44da3f` and this doc. Nothing was pushed or deployed.

### Problem 1

- `scripts/lib/reach/reply-context.mjs`: one rule for what a reply answers, shared by every path. The exact `replyTo` comes first (the phone thread's `<id>-orion` form included). Otherwise it is the newest delivered row within 25 min, or 90 min for an ask, that no later message has answered.
- **Into the session as a real turn:** `orion-inbound-turn --session <key>` writes the outreach into the reply's gateway session as ORION's own assistant message (`openclaw gateway call chat.inject`, label `orion-outreach`). This happens once per session and row, before the turn runs. The inject refreshes the session's `updatedAt`, so the 45-min idle reset no longer throws it away. orion-remote passes its brain session. The Mac app passes the chat's session and waits up to 6 s (`InboundTurnLog.settle()`) before calling the gateway. The label stays as a fallback.
- **Plugin** (`src/outreach-reply.ts`, wired in `local-routing.ts`):
  - It parses both the Mac label and the phone line, old and new.
  - The front desk gets ORION's line as its last turn (`history`).
  - Short replies to a bedtime or start line are answered by code. "in 10", "not yet" and "I'm meal prepping" set an `orion-checkin add`. "already did" closes it, and "yeah" marks it started. Any reply to a bedtime line gets "no more bedtime reminders tonight", never "since when?".
  - Longer replies reach the worker with "Conversation so far: YOU (ORION) messaged him first: …".
- Tests:
  - `tests/incident-2026-10-23-reply-context.test.mjs` (7): the real rows, the windows, and the inject through a fake gateway CLI.
  - `plugin/orion-control/src/outreach-reply-incident-2026-10-23.test.ts` (29): the exact 10-16, 10-19 and 10-20 prompts through the routing hooks.
  - Swift `InboundTurnLogTests` (the `--session` argv and `settle`).
  - The `tests/inbound-turn.test.mjs` argv was updated for `--session`.

### Problem 2

- `scripts/lib/reach/bedtime-guard.mjs`, enforced in `orion-reach` for every bedtime line (`proactive: bed-*`, and the late `session-done` reminder). A held line is dropped and logged `status: dropped, reason: in-bed`. It is never queued and never re-routed to a phone push. A line is held when:
  - he said goodnight (`sleep-declared.json`);
  - he already answered a bedtime line tonight (`bedtime-ack.json`, written by `orion-inbound-turn` on any reply to one);
  - the phone is on the charger and still at night, and not in his hand;
  - the Mac is locked or asleep from 30 min before bedtime;
  - there has been no Mac or phone use for 15+ min after bedtime (unknown input counts as inactive);
  - 2 bedtime lines have already reached him that night (the cap).
- Tests: `tests/incident-2026-10-23-bedtime.test.mjs` (13):
  - 10-19 23:43 after "shush up": held.
  - 10-19 23:44, phone charging and still: held.
  - 10-22 23:42, third line: held by the cap.
  - "going to bed now" (10-18): held.
  - Locked or inactive after bedtime: held.
  - End to end through `orion-reach` and `orion-inbound-turn`.

### Not fixed here

- `bed-wind` (before bedtime) still goes when he is idle but not in bed (10-19 22:33: phone off the charger, Mac idle 11 min). The evidence then did not say "in bed".
- `inbound-turns.jsonl` in the live directory holds test-run turns (`from: local`, "approve A-7F3K"). Some test writes to the live directory. Worth a separate look.
- The phone's own reply thread path (OrionLink/OrionMobile `replyTo`) worked and was unchanged; no phone reply since 10-16 went through it.

### Runs

- `node --test tests/*.test.mjs`: 1745 tests. 1742–1745 pass. Three timing tests in `agentic-halts` and `awareness-cli` fail only under full-suite load and pass alone; they are untouched by this change.
- `plugin/orion-control npm test`: 1870/1870, including the 29 new.
- `swift test` (native/Orion, filtered): passes.
