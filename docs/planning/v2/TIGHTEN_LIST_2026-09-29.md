# Tighten list — 29 September 2026 (Claude)

From the 60-scenario run, 16 + 5 re-runs, live voice use, and the device installs. Split: **Qwen** gets the long, self-contained logic (project "Tighten ORION", `docs/agentic/plans/tighten-orion.md`, 8 tasks, imported, lint clean); **Claude** takes wiring, the live system, the apps and the devices.

## Fixed today (verified by re-run or test)
| Issue | Fix |
|---|---|
| Mac voice froze 2–26 s / "NO KEY" | keychain read never prompts; `security` fallback; cached; prefetched at launch |
| Mic went dead mid-turn | restart on device change during a turn; dead-engine watchdog |
| He heard himself (cut off, woke, answered his own echo) | SelfEcho + speakers-route barge-in rule + echo transcript drop; voice ID running again (launchd) |
| Slurred "8:14 PM" | TTS gets times as words |
| Slow time answers | local instant answer (Mac voice, phone, Discord) |
| 24-hour times | 12-hour rule; check-in and watcher messages 12-hour |
| Long spoken replies | spoken turns ask for 1–3 sentences |
| Phone voice stuck / loops / quiet | early replies kept, 90 s timeout, back-off, default audio mode, phone locale |
| Lock-screen card dead buttons, red after snooze | buttons run in the app; card persists; first snooze honoured |
| Widgets only updated with app open | written on launch, every snapshot, and a 30-min background refresh |
| Tool narration in replies | retries anchored to his message and told never to narrate; retry only for leading refusals |
| False "I can't" / missed it | narrowed and restored patterns (interim; Qwen's `claims` replaces) |
| "Tick it off" offered deletion | `apple_reminder_complete` (bridge `complete_reminder`) + rule |
| Umbrella from today's sky; Discord alert fired | `weather_now(location, days)`; `orion-weather-alert` described as SENDS |
| `ls ~/Desktop` hung | `desktop_list` rule |
| "What's playing" looked at the screen | `media_now_playing` with a real verifier |
| Undo removed half a booking | one undo step per command; no empty steps |
| "Booked" when nothing was | planner headline "NOTHING WAS BOOKED on <day>" + rule |
| Bedtime disagreed with the phone | bedtime from `orion-now` |
| "Do I start late?" answered with sleep | `orion-patterns` reports start lateness |
| Social plans questioned, "plan it for me" asked back | rules: people-plans fixed, 2 h default; fill on request |
| Test runs wrote fake memories | episodic capture skips eval sessions |
| Gateway "⚠️ 🛠️ Exec failed" lines in replies | stripped (kept in audit) |
| Overnight events twice in widgets | today only |

## Qwen — project "Tighten ORION" (8 independent tasks)
1. `reply-lint` — detect/fix narration, 24-hour and mixed times, spoken markdown/length, repeats.
2. `claims` — done / cant / none classifier with data-absence exclusion (replaces the regexes).
3. `eval-grade` — automatic grading of scenario runs + CLI.
4. `lateness` — how late he starts, by kind/weekday/time of day, trend, one sentence.
5. `deadline-ramp` — daily study minutes before quizzes/presentations/essays.
6. `plan-parse` — "dinner with friends at 7 tomorrow" → plan items with dates and defaults.
7. `morning-brief` — the morning phone message.
8. `distraction` — when phone use gets a nudge or a lock.

## Claude — next
- Wire each Qwen module after review (remote reply path, truth check, patterns, watcher morning push, fill-day, reschedule, phone DeviceActivity monitor for #8).
- Calendar: EventKit range search omits "Academic Writing Workshop (optional)" (found by id, exists in Calendar) — find why; the planner must see every fixed event.
- Eval harness: run with outbound messaging blocked (one real Discord weather alert was sent by a test).
- "Who are you" still lists email search while Gmail is revoked: capability answers should follow live account status.
- Phone: test voice on device; confirm Time Sensitive label on a level-2 check-in; lock-screen card after the button fix.

## Nick
- Gmail: re-grant (`gog auth manage` → Add more permissions) — token revoked.
- Web search: off in OpenClaw (needs a search provider key) — your call.
- Turn Qwen on for "Tighten ORION".
- Try voice on the Mac (wake word + push-to-talk) and the phone.
