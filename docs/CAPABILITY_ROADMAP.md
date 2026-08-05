# What else Orion should be able to do

You asked for a whole list. This is it, sorted by whether it exists, what it
costs to build, and what it would cost you in permissions.

Two things shape every row:

- **Blast radius.** Reading the weather and deleting a folder are not the same
  kind of act, and they should not sit behind the same gate. Capability tiers
  exist so that "Orion can tell me the time" is a separate decision from "Orion
  can move my files."
- **No stubs.** An action that reports success and does nothing is worse than an
  action that does not exist, because you stop checking. Two of these —
  `timer_set` and `reminder_create` — were already in the catalog as simulated
  stubs. Orion would say "timer set" and no timer existed. Both are now either
  real or gone.

---

## Built and live

| Tier | Actions |
|---|---|
| `ambient_info` | `weather_now`, `clock_now`, `system_status` |
| `reminders` | `timer_set`, `alarm_set`, `reminder_list`, `reminder_cancel` |
| `app_control` | open / quit a named app |
| `browser_control` | open URL, new / close / switch tab, list tabs, read page |
| `media_control` | play-pause, next, previous, volume, mute, display sleep |
| filesystem tiers | read, list, metadata, create, append, replace |
| `file_mutate` | move, rename, delete-to-Trash — **built, shipped disabled** |

**Weather** goes to Open-Meteo: no API key, no account, and the only thing sent
is a place name. That matters — a provider wanting a key means another
credential on disk, and one wanting precise coordinates means Orion reporting
where you are to a third party on a schedule.

**Timers and alarms** are split across two processes on purpose. The plugin owns
the store, the app owns the clock, and the only thing between them is a JSON
file written by atomic rename. The plugin cannot wake up — it exists only while
a tool call runs — so something that is always alive has to do the firing. The
coupling is deliberately the dumbest possible one: either side can crash or be
mid-rebuild and the worst case is a timer a few seconds late, not a channel
that is quietly dead.

Two behaviours worth knowing: a reminder more than two minutes overdue is
dropped silently rather than announced (your Mac was asleep; the moment has
passed), and one that comes due while Orion is mid-sentence waits its turn
instead of interrupting.

---

## Worth building next

Ordered by value per unit of work.

### 1. Calendar and reminders, read-first
`calendar_today`, `calendar_next`, `reminders_due`. Via EventKit in the app
rather than AppleScript — AppleScript against Calendar is slow and flaky, and
this is a question you would ask every morning.

*Cost:* one macOS permission prompt (Calendars), no network, no new credential.
Start read-only; writing events is a separate, later decision.

### 2. Clipboard
`clipboard_read`, `clipboard_write`. Cheap and immediately useful — "what did I
just copy", "put that on my clipboard".

*Worth flagging:* your clipboard routinely holds passwords and tokens. Reading
it should probably require you to ask in that turn, not be something Orion can
do while summarising something else. I would gate it the way destructive file
actions are gated rather than the way weather is.

### 3. Screenshot and screen reading
`screen_capture`, then optionally OCR. Turns "what does this error say" into
something Orion can answer.

*Cost:* Screen Recording permission, which is a real one — it covers everything
visible, always. I would want this off by default and visibly indicated when in
use.

### 4. Notes and quick capture
`note_append` to Apple Notes or a plain markdown daily file. You already have
the `apple-notes` skill enabled, so some of this exists at the skill layer; the
question is whether it should be a gated action too.

### 5. Focus / Do Not Disturb
Useful, and the one I would push back on. Focus modes are a system setting, and
the standing rule here is that Orion does not change system or security
settings. Reading whether Focus is on is fine; setting it is a line I would
rather not blur, because "which settings are safe" is exactly the judgement that
degrades over time.

### 6. Search
`web_search` for facts Orion does not have. This is the largest change on the
list — it is the first capability that would routinely pull untrusted text into
Orion's context, which is the thing every other guard here is built against.
Worth doing, worth doing carefully, and worth doing after the taint checking has
had some real mileage.

---

## Deliberately not on the list

- **Sending messages, email, or anything outbound.** Reachable, gated behind
  approval, and I would not enable it without you watching the first few.
- **System and security settings**, Wi-Fi, Bluetooth, Privacy toggles.
- **Anything that moves money**, opens accounts, or handles credentials.
- **Permanent deletion.** Delete moves to `~/.Trash` and records its inverse in
  the ledger. There is no unlink path and there should not be one.

---

## Enabling any of it

Each tier is a config flag in `openclaw.json` plus a permission profile that
allows it. Both have to agree, which is why turning on a flag alone does
nothing — the profile is the second lock, and it is the one you control.

Current profile: `approved_root_edit`. `file_mutate` needs `consequential_local`,
which is a raise you have to authorize explicitly and which is recorded in the
permission audit.
