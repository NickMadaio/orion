#!/usr/bin/env node
// Writes the structured `setup.calendar` (and the live tier) into scenarios/*.json, deterministically.
//
//   node scripts/eval/gate/tools/gen-setup.mjs            rewrite the scenario files
//   node scripts/eval/gate/tools/gen-setup.mjs --check    exit 1 if any file is not what this script produces
//
// The prose in setup.notes was turned into this table BY HAND, item by item (2026-10-31). The script only
// applies the table, so the same input always gives the same files. It edits `setup` and nothing else, except
// for the live tier, whose turn text has its premise times replaced by relative tokens (README: "Live tier").
//
// The standard WEEK (scenarios/README.md): MKTG2201 Mon 13:30-15:30, ECON1115 Tue 11:00, CS2100 Wed 09:00,
// gym 17:00-18:30 daily (ORION-owned), side project 19:30-20:30 daily (ORION-owned). The README gives no end
// time for ECON1115 and CS2100: both are 90 minutes here. London is UTC in November, so every time is Z.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../scenarios");
const DEFAULT_NOW = "2026-11-02T10:00:00Z";   // README: "Mon 2026-11-02 10:00Z unless stated"

const at = (date, hhmm) => `${date}T${hhmm}:00Z`;
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const ev = (date, title, start, end, owned = null) => ({ title, start: at(date, start), end: at(date, end), ...(owned ? { owned } : {}) });

/** Monday of the week holding `now` through the next Monday: classes once, gym and side project every day. */
export function baseWeek(now) {
  const day = now.slice(0, 10);
  const monday = addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
  const days = Array.from({ length: 8 }, (_, i) => addDays(monday, i));
  return [
    ev(days[0], "MKTG2201", "13:30", "15:30"),
    ev(days[1], "ECON1115", "11:00", "12:30"),
    ev(days[2], "CS2100", "09:00", "10:30"),
    ev(days[7], "MKTG2201", "13:30", "15:30"),
    ...days.flatMap((d) => [ev(d, "Gym", "17:00", "18:30", "gym"), ev(d, "Side project", "19:30", "20:30", "side_project")]),
  ];
}

// Per pair: what its notes add to, or change in, the WEEK. `today` is the date of `now`.
// add: extra events; move: [title, date, start, end]; reminders: to-dos (Apple Reminders in the sandbox).
const PAIRS = {
  "foc-not-started": { add: (t) => [ev(t, "Econ problem set", "18:00", "19:00", "study")] },        // "18:00-19:00 started 15 min ago"
  "hea-sleep-debt": { add: (t) => [ev(t, "CS2100", "09:00", "10:30")] },                           // "CS2100 09:00" on Tue
  "hea-sleep-adjust": { add: (t) => [ev(t, "CS2100", "09:00", "10:30")] },                         // "Day has CS2100 09:00"
  "loop-reply-bed": { add: (t) => [ev(t, "CS2100", "09:00", "10:30")] },                           // 00:43 Tue, "CS2100 is at 09:00"
  "loop-bedtime-reschedule": { add: (t) => [ev(t, "CS2100", "09:00", "10:30")] },                  // 03:00 Tue, "CS2100 is 09:00"
  "loop-focus-done": { add: (t) => [ev(addDays(t, 1), "CS2100", "09:00", "10:30")] },              // stale "Next: CS2100 at 9:00 AM" (tomorrow)
  "loop-eat-first": { add: (t) => [ev(t, "CS lab", "18:00", "19:00", "study")] },                  // "nudged to start CS lab at 18:00"
  "loop-calendar-question-reply": { add: (t) => [ev(t, "Study for CS Midterm", "14:00", "15:30", "study")] },   // asked at 14:10 about it
  "loop-morning-brief": { reminders: () => [{ title: "finish resume" }, { title: "Student oyster card" }] },
  "rea-work-on-it-tomorrow": { reminders: () => [{ title: "finish resume" }] },
  "per-legit-vs-excuse": { reminders: (t) => [{ title: "Deadline", due: at(t, "18:00") }] },          // "a deadline due at 18:00"
  "per-tone-stressed": { reminders: () => [{ title: "CS2100 midterm", due: at("2026-11-05", "09:00") }, { title: "Marketing brief", due: at("2026-11-06", "23:59") }] },
  "rea-correction-queued": { add: (t) => [ev(t, "ECON1115", "11:00", "12:30")] },                  // "MKTG2201 and ECON1115 are scheduled" today
  "sch-no-class": { add: (t) => [ev(t, "ECON1115", "11:00", "12:30")] },                           // "MKTG2201 today 13:30-15:30 and ECON1115 11:00"
  "rea-task-twice": { add: (t) => [ev(t, "Econ problem set", "18:30", "19:30", "study")] },
  "rea-meal-prep": { move: (t) => [["Gym", t, "19:35", "21:05"]] },                               // "Time to start: Gym." 10 min before 19:45
  "sch-cs-lab-long": { add: (t) => [ev(t, "CS lab", "20:00", "21:00", "study")] },
  "sch-fixed-plan-protect": { add: (t) => [ev(t, "dinner with Annika", "19:00", "21:00")] },       // created by Nick: fixed
  // The notes said "Now 14:00" and setup.now said 10:00; the turn and the rubric put the nap at 14:00-15:30 and "now" at 15:30.
  "rea-spontaneous-nap": { now: "2026-11-02T15:30:00Z" },
  // Not a calendar: the alarm is wake-request.json, a restorable file. "Alarm exists for 08:00 tomorrow (Tue)".
  "sch-alarm-push": { state: { "wake-request.json": { at: "2026-11-03T08:00:00.000Z", setAt: "2026-11-02T21:00:00.000Z" } } },
};

// Pairs whose premise has no calendar or clock (memory, screen, files, keychain): they run at real time.
const NO_CALENDAR = /^(com|kno|saf|per-who-am-i|per-preference-remember)-/;

// The live tier: clear WRITE items that still exercise Nick's real calendar at real time. Turn text is final here;
// only the times that are premises became tokens ({{now+Nm}} renders as a clock time like "7:15pm").
const LIVE = {
  "sch-cs-lab-until-c": ["add cs lab {{now+5m}} to {{now+195m}} tonight"],
  "sch-gym-moved-later-c": ["move gym to {{now+150m}} today"],
  "foc-side-project-hour-c": ["book an hour of youtube editing tonight at {{now+30m}}"],
  "rea-friends-invite-c": ["going to get food with annika from {{now+30m}} to {{now+150m}}, move gym to after"],
  "rea-took-longer-gym-c": ["gym done, was {{now-90m}} to {{now}}, plan my evening"],
  "per-legit-vs-excuse-c": ["gym is bumped to {{now+150m}} tonight because i have a deadline at {{now+90m}}"],
  "rea-exhausted-c": ["add a 30 min nap at {{now+180m}} today and cut side project tonight im wrecked"],
  "loop-calendar-question-reply-c": ["moved to {{now+330m}} tonight"],
  "rea-spontaneous-nap-c": ["i slept from {{now-90m}} to {{now}}, redo the rest of the day from now"],
  // Times already relative to the real day ("tomorrow at 10am", "thursday", "25 min"): text unchanged.
  "cha-phone-call-c": null,
  "rea-work-on-it-tomorrow-c": null,
  "sch-add-deadline-c": null,
  "loop-skipped-class-followup-c": null,
  "loop-eat-first-c": null,
  "rea-didnt-go-class-c": null,
  "rea-skip-gym-c": null,
  "sch-tomorrow-light-c": null,
  "rea-meal-prep-c": null,
  "loop-gym-ladder-ignored-c": null,
  "rea-sick-c": null,
};
const LIVE_NOTE = " [Live tier: runs on the real calendar at the real time; times in the turn are relative to the real clock.]";

const pairOf = (id) => id.replace(/-[vc]$/, "");
const byStart = (a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title);

/** The calendar fixture for one item, or null when its premise has none. */
export function calendarFor(item) {
  const spec = PAIRS[pairOf(item.id)] ?? {};
  const now = spec.now ?? item.setup?.now ?? (NO_CALENDAR.test(item.id) ? null : spec.reminders ? DEFAULT_NOW : null);
  if (!now) return null;
  const today = now.slice(0, 10);
  const moves = spec.move?.(today) ?? [];
  const events = baseWeek(now).map((e) => {
    const m = moves.find(([title, date]) => e.title === title && e.start.startsWith(date));
    return m ? { ...e, start: at(m[1], m[2]), end: at(m[1], m[3]) } : e;
  });
  return { now, events: [...events, ...(spec.add?.(today) ?? [])].sort(byStart), reminders: spec.reminders?.(today) ?? [] };
}

/** The item with its generated setup (and, for the live tier, its tokenised turns). Pure. */
export function withSetup(item) {
  const base = { ...item.setup };
  delete base.calendar; delete base.live;
  if (Object.hasOwn(LIVE, item.id)) {
    const { now: _drop, ...rest } = base;
    const notes = (rest.notes ?? "").replace(LIVE_NOTE, "") + LIVE_NOTE;
    const texts = LIVE[item.id];
    const turns = texts ? item.turns.map((t, i) => ({ ...t, text: texts[i] ?? t.text })) : item.turns;
    return { ...item, setup: { ...rest, notes, live: true }, turns };
  }
  const spec = PAIRS[pairOf(item.id)] ?? {};
  const calendar = calendarFor(item);
  const setup = { ...base, ...(calendar ? { now: calendar.now } : {}), ...(spec.state ? { state: { ...base.state, ...spec.state } } : {}), ...(calendar ? { calendar } : {}) };
  return { ...item, setup };
}

function main() {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const f of readdirSync(DIR).filter((n) => n.endsWith(".json")).sort()) {
    const path = join(DIR, f);
    const before = readFileSync(path, "utf8");
    const after = JSON.stringify(JSON.parse(before).map(withSetup), null, 2);
    if (after === before) continue;
    stale++;
    if (check) process.stderr.write(`${f} is not what gen-setup.mjs produces\n`); else writeFileSync(path, after);
  }
  if (check && stale) process.exit(1);
  process.stdout.write(check ? "scenario setup is up to date\n" : `rewrote ${stale} file(s)\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
