# Task & Schedule module — preparation

Written 2026-08-07, ahead of the revamp. Nothing here is built yet. This is the
audit of what exists, the constraints that are actually binding, and the
decisions that have to be made before code is worth writing.

---

## 1. What exists today

### Tasks — `AppleRemindersSync.swift`

Works, and is narrower than it looks. It owns **one Reminders list called
"Orion"**, creates it if absent, and every fetch is predicated on that single
list. That scoping is deliberate — macOS grants all-or-nothing Reminders access,
so the restraint lives in the code.

| Capability | State |
|---|---|
| Create / rename / complete / delete | ✅ |
| Due date | ✅ single date |
| Notification | ✅ one absolute alarm, added automatically with a due date |
| Live sync from iPhone | ✅ `EKEventStoreChanged` + a 120s backstop |
| **Recurrence** | ❌ `EKRecurrenceRule` is never touched |
| **Multiple alarms** | ❌ `setDue` removes all alarms and adds exactly one |
| **Relative alarms** ("10 min before") | ❌ absolute only |
| **Priority** | ❌ `EKReminder.priority` unused |
| **Notes / URL** | ❌ unused |
| **Subtasks** | ❌ no model for it |
| **Start date** (distinct from due) | ❌ `startDateComponents` unused |
| **Other Reminders lists** | ❌ invisible by design |
| **Completed-item growth** | ⚠️ all completed reminders are fetched forever and sorted to the bottom; nothing ages out |

So "reminders every day?" is not a small gap — recurrence is genuinely absent.

### Schedule — `AppleCalendarSync.swift`

Read-only, **today only**, all event calendars, plus `committedMinutesRemaining`.
No write path, no week or month range, no Google.

### Finding worth acting on first

`~/Library/Calendars` is **empty on this Mac** — there are no calendar accounts
configured in macOS at all. Whatever we build, the agenda will stay blank until
at least one account exists. Worth confirming before anything else.

---

## 2. The constraint that changes the design

**Google Calendar probably needs no Google API at all.**

Add the Google account in *System Settings ▸ Internet Accounts* with Calendars
enabled, and macOS syncs it over CalDAV. EventKit then returns those events as
ordinary `EKEvent`s from `store.calendars(for: .event)` — the code already
written. Google and Apple events arrive **already combined**, in one store, with
one permission, one refresh path, and offline caching handled by macOS.

Compare that with the Google Calendar API route:

| | Internet Accounts (CalDAV) | Google Calendar API |
|---|---|---|
| New code | none | OAuth scope change, client, token refresh, pagination, sync tokens |
| Permission | the Calendar grant already asked for | a second OAuth grant to maintain |
| Combining sources | already unified in EventKit | manual merge, two ID spaces, two failure modes |
| Offline | macOS caches it | our problem |
| Writes back | via EventKit | separate write path |
| Breaks when | account removed | token expires, scope changes, quota |

The API route only wins if we need something CalDAV does not expose — Meet
links, attendee response states, or Google-specific extended properties.

**→ Decision 1 below.**

### "Orion's own calendar system"

Same argument as the one that put tasks in Reminders. Two options:

**(a) Orion creates its own `EKCalendar`** in the Apple store. Its events sync to
the iPhone for free, show up in Calendar.app beside everything else, and read
back through the same single code path. Orion-specific fields (energy cost,
which task it belongs to, whether Orion scheduled it) live in a small JSON
sidecar keyed by `eventIdentifier`.

**(b) A wholly separate store.** Full control of the schema, and invisible
everywhere except this window — which is the exact failure the Reminders
decision was made to avoid.

(a) is strongly recommended, for the reason already written into
`AppleRemindersSync`'s header: *"a task you can only see on this Mac, in this
window, is a worse to-do list than the one already on your phone."*

---

## 3. What EventKit will and will not give us

Verified against the framework, so the design does not assume something that is
not there:

- **Recurrence on reminders**: `EKReminder.recurrenceRules` accepts
  `EKRecurrenceRule` — daily / weekly / monthly / yearly, with intervals,
  specific weekdays, and an end (never, after N, until a date). Everything in
  "reminders every day? options like that" is expressible.
- **Multiple alarms**: `alarms` is an array. "The day before *and* an hour
  before" is supported.
- **Relative alarms**: `EKAlarm(relativeOffset:)` — offset from the due date, so
  it follows a recurring task automatically.
- **Recurring reminders are one item, not many.** iOS/macOS roll the due date
  forward on completion. A UI that renders "every day" as thirty rows is fighting
  the model.
- **Alarms need a due date.** An alarm on an undated reminder never fires.
- **Priority** is `0` (none) or `1–9`, where 1 is highest — not a 0–3 enum.

---

## 4. Decisions to land

These are the details, stated so they can be answered directly.

**1. Google Calendar route** — Internet Accounts (recommended, zero new code) or
the Google API? If the API, what does it need to do that CalDAV cannot?

**2. Scope of the Reminders connection** — "connect perfectly with Apple
Reminders" reads two ways:
   - **(a)** stay on the single "Orion" list, and make that list excellent, or
   - **(b)** read and write **all** lists, so Orion sees every task on the phone.
   (b) is a much larger promise: it means Orion can modify anything in Reminders,
   which changes what the permission means. Which one?

**3. Recurrence vocabulary** — which patterns get first-class UI?
   Daily · weekdays · weekly on chosen days · every N days · monthly · custom.
   And do recurring tasks need "skip this one" (an EventKit exception date) or is
   completing it enough?

**4. Reminder timing** — one alarm or several? Absolute ("at 9am") or relative
   ("30 minutes before")? Relative survives a rescheduled task; absolute does
   not.

**5. Where the schedule is authored** — does Orion create calendar events
   (time-blocking a task into the day), or only read? Writing is the interesting
   half and the one with consequences.

**6. Task ↔ event link** — should a task be schedulable onto the calendar as a
   block, and should completing the block complete the task?

**7. Range** — today only, or day/week/month views? Drives the fetch strategy and
   most of the layout work.

**8. Conflicts** — when Orion's schedule and a real calendar event overlap, does
   Orion warn, refuse, or reflow?

---

## 5. Suggested build order

Independent of most of the answers above, so it can start once 1 and 2 are
settled:

1. **Recurrence and alarms in the existing sync layer.** Additive, no UI change
   required, and the largest genuine gap. `SyncedTask` grows `recurrence` and
   `alarms`; `add`/`setDue` learn to write them.
2. **Ageing out completed tasks** from the fetch, before the list gets slow.
3. **Confirm a calendar account exists** and that Google events land through
   EventKit — one manual check that de-risks the whole schedule half.
4. **Widen the calendar read** to a date range rather than today.
5. **The Orion calendar** (`EKCalendar` + JSON sidecar), read path first.
6. **UI**, once 3–8 are answered.

---

## Open risk

The task list currently fetches every completed reminder in the Orion list on
every refresh, forever, with no age limit. It is fine now and will not stay fine.
Worth fixing in step 2 whatever else is decided.
