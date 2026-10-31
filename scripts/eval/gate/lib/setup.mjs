// What an item's `setup` does to the live system before its turns, and how it is taken back.
//
//   setup.calendar  -> the evaluation sandbox: eval-calendar.json ({ now, events, reminders }) beside the eval-mode
//                      marker. lib/life/bridge-path.mjs then sends calendar reads and writes to the sandbox bridge and
//                      uses the sandbox's `now`; the plugin's pluginNow() and undoJournalTop see the same pair.
//   setup.state     -> named restorable files (as before), plus the abstract keys mapped to the files ORION reads:
//                      sleep_last_night_h / whoop_recovery -> health-log.json days[<date of now>].sleepHours / .recovery
//                      gym_done_days_last7                 -> health-log.json workouts[] (attendance.mjs, knowledge) and
//                                                             logged.jsonl rows (day-questions habitAnswer: "gym days this week")
//                      timezone, home                      -> checked against the host clock and the live home place
//                      llm                                 -> unmet: only stopping the model would make it true
//   setup.live      -> no sandbox: the item runs on the real calendar at the real time; {{now+Nm}} tokens in its turns
//                      are rendered against the real clock.
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

// Every file a sandboxed run makes readers switch to (bridge-path, calendar-write, config, pins, skips, anchor-skips,
// written, orion-remote). All are removed when the item ends; none may exist when an item starts.
export const SANDBOX_FILES = ["eval-calendar.json", "eval-life-config.json", "eval-reschedule-undo.json", "eval-pins.json", "eval-remote-inbound.json",
  "eval-remote-inbound.lock", "eval-outreach-consumed.json", "eval-skipped-events.json", "eval-anchor-skips.json", "eval-orion-written.json"];
export const sandboxPaths = (p) => SANDBOX_FILES.map((f) => join(p.ctrl, f));

const HEALTH_KEYS = ["sleep_last_night_h", "whoop_recovery", "gym_done_days_last7"];
const GYM_DAY_OFFSETS = [1, 2, 4, 6, 3, 5, 7];   // days before `now` that hold a workout, filled in this order (deterministic)

const pad = (n) => String(n).padStart(2, "0");
const localDate = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** The sandbox file for a calendar fixture: seed identifiers, owned blocks carry `orion: <kind>` (bridge-path's format). */
export function sandboxDay(calendar) {
  return {
    now: calendar.now,
    events: calendar.events.map((e, i) => ({ identifier: `seed-${i}`, title: e.title, start: e.start, end: e.end, ...(e.owned ? { orion: e.owned } : {}) })),
    reminders: (calendar.reminders ?? []).map((r, i) => ({ identifier: `todo-${i}`, title: r.title, ...(r.due ? { due: r.due } : {}) })),
  };
}

/** health-log.json with the item's numbers written in, or null when the item has none. Pure. */
export function healthFixture(state, logText, nowMs) {
  const keys = HEALTH_KEYS.filter((k) => state?.[k] !== undefined);
  if (!keys.length) return null;
  let log; try { log = JSON.parse(logText ?? ""); } catch { log = null; }
  const base = log && typeof log === "object" ? log : { schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [] };
  const day = localDate(nowMs);
  const record = { ...(base.days?.[day] ?? { waterBottles: 0, calories: 0, supplementIDs: [] }),
    ...(state.sleep_last_night_h !== undefined ? { sleepHours: state.sleep_last_night_h } : {}),
    ...(state.whoop_recovery !== undefined ? { recovery: state.whoop_recovery } : {}), updatedAt: new Date(nowMs).toISOString() };
  const days = state.sleep_last_night_h !== undefined || state.whoop_recovery !== undefined ? { ...(base.days ?? {}), [day]: record } : base.days;
  const n = state.gym_done_days_last7;
  const weekAgo = localDate(nowMs - 7 * 86_400_000);
  const workouts = n === undefined ? base.workouts : [
    // The fixture says how many of the last 7 days had gym: the real rows in that window are replaced, older ones kept.
    ...(base.workouts ?? []).filter((w) => !(w?.day >= weekAgo && w?.day < day)),
    ...GYM_DAY_OFFSETS.slice(0, Math.max(0, n)).map((off) => {
      const d = localDate(nowMs - off * 86_400_000);
      return { id: `gate-fixture-${d}`, day: d, startedAt: `${d}T17:00:00.000Z`, title: "Gym", exercises: [], notes: "" };
    }),
  ];
  return { file: "health-log.json", content: { ...base, ...(days ? { days } : {}), workouts }, keys };
}

const offsetAt = (timeZone, ms) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) - Math.floor(ms / 60000) * 60000;
};

/** "Europe/London" is met when the host clock shows the same wall time at `nowMs` (the Mac's zone is what ORION uses). */
export function timezoneMet(zone, nowMs, hostZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  try { return hostZone === zone || offsetAt(zone, nowMs) === offsetAt(hostZone, nowMs); } catch { return false; }
}

/** The live home place: known-places.json's `home`, else the seeded one in lib/awareness/places.mjs. */
export async function liveHome(p) {
  try {
    const known = JSON.parse(readFileSync(join(p.ctrl, "known-places.json"), "utf8"));
    const home = (Array.isArray(known) ? known : known?.places ?? []).find((x) => x?.id === "home");
    if (home?.label) return home.label;
  } catch { /* not written yet: the seeded home applies */ }
  try { return (await import(join(p.scripts, "lib/awareness/places.mjs"))).SEEDED_HOME?.label ?? null; } catch { return null; }
}

/**
 * What applying `setup` would do, without doing it. `writable` maps restorable basenames to paths.
 * @returns {{ sandbox: object|null, writes: Array<{file, path, content}>, applied: string[], unmet: string[], live: boolean, now: string|null }}
 */
export async function planSetup(p, setup, { writable, realNow = Date.now(), hostZone } = {}) {
  const live = setup?.live === true;
  const sandbox = !live && setup?.calendar ? sandboxDay(setup.calendar) : null;
  const nowMs = sandbox ? Date.parse(sandbox.now) : realNow;
  const applied = [], unmet = [], writes = [];
  if (sandbox) applied.push(`calendar (sandbox: ${sandbox.events.length} events, ${sandbox.reminders.length} to-dos)`, `now:${sandbox.now}`);
  else if (setup?.now) unmet.push(`now:${setup.now} (no calendar fixture to carry the clock; the item ran at real time)`);
  for (const [name, value] of Object.entries(setup?.state ?? {})) {
    if (HEALTH_KEYS.includes(name)) continue;
    if (name === "timezone") { (timezoneMet(value, nowMs, hostZone) ? applied : unmet).push(timezoneMet(value, nowMs, hostZone) ? `timezone:${value} (host clock matches)` : `timezone:${value} (the host clock is in another zone)`); continue; }
    if (name === "home") {
      const label = await liveHome(p);
      if (label && label.toLowerCase().includes(String(value).toLowerCase())) applied.push(`home:${value} (already the live home place)`);
      else unmet.push(`home:${value} (the live home place is ${label ?? "unreadable"}; it is not changed for a test)`);
      continue;
    }
    if (name === "llm") { unmet.push(`llm:${value} (no fixture takes the model down; only stopping Ollama would, and the gate never does)`); continue; }
    const path = writable.get(name);
    if (!path) { unmet.push(`state:${name} (not a restorable file)`); continue; }
    writes.push({ file: name, path, content: value });
    applied.push(name);
  }
  const health = healthFixture(setup?.state, readText(writable.get("health-log.json")), nowMs);
  if (health) {
    writes.push({ file: health.file, path: writable.get(health.file), content: health.content });
    applied.push(...health.keys.map((k) => (k === "gym_done_days_last7" ? `${k} -> health-log.json workouts + logged.jsonl` : `${k} -> health-log.json`)));
  }
  const appends = setup?.state?.gym_done_days_last7 === undefined ? [] : [{ file: "logged.jsonl", text: gymLoggedRows(setup.state.gym_done_days_last7, nowMs) }];
  return { sandbox, writes, appends, applied, unmet, live, now: sandbox?.now ?? null };
}

/** logged.jsonl rows ("what he said he did"), which day-questions' habitAnswer counts for "how many gym days this week". */
export function gymLoggedRows(n, nowMs) {
  return GYM_DAY_OFFSETS.slice(0, Math.max(0, n)).map((off) => {
    const date = localDate(nowMs - off * 86_400_000);
    return `${JSON.stringify({ at: `${date}T18:30:00.000Z`, date, txn: "gate-fixture", identifier: null, title: "Gym", kind: "gym", start: 1020, end: 1110 })}\n`;
  }).join("");
}

const readText = (path) => { try { return path ? readFileSync(path, "utf8") : null; } catch { return null; } };

/** Sandbox files present right now (another evaluation, or a crashed item). */
export const sandboxPresent = (p) => sandboxPaths(p).filter((f) => existsSync(f)).map((f) => basename(f));

/** Write the plan. Throws, writing nothing, when any sandbox file already exists: it is not this item's. */
export function applyPlan(p, plan) {
  const present = sandboxPresent(p);
  if (present.length) throw new Error(`sandbox file(s) already present (${present.join(", ")}): another evaluation, or an unrecovered run (run.mjs --recover)`);
  for (const w of plan.writes) {
    if (w.content === null) rmSync(w.path, { force: true }); else writeFileSync(w.path, `${JSON.stringify(w.content, null, 2)}\n`);
  }
  // Appended, so the undo can truncate back to the snapshot (state.mjs RESTORED_LOGS).
  for (const a of plan.appends ?? []) {
    const file = join(p.ctrl, a.file), cur = readText(file);
    appendFileSync(file, `${cur && !cur.endsWith("\n") ? "\n" : ""}${a.text}`);
  }
  if (plan.sandbox) {
    // The sandbox planner reads eval-life-config.json: his real settings, copied (orion-eval-schedule does the same).
    writeFileSync(join(p.ctrl, "eval-life-config.json"), readText(join(p.ctrl, "life-config.json")) ?? "{}");
    writeFileSync(p.sandboxCalendar, JSON.stringify(plan.sandbox, null, 2));
  }
}

/** Remove every sandbox file. Returns what it removed. */
export function removeSandbox(p) {
  const removed = sandboxPresent(p);
  for (const f of sandboxPaths(p)) rmSync(f, { force: true });
  return removed.map((f) => `removed sandbox ${f}`);
}

/** The sandbox calendar as it is now (null when none). */
export function readSandbox(p) { try { return JSON.parse(readFileSync(p.sandboxCalendar, "utf8")); } catch { return null; } }

/** What the item did to the sandbox calendar: events created, deleted, moved, and to-dos added or completed. */
export function sandboxDelta(before, after) {
  if (!before) return null;
  if (!after) return { missing: true };
  const key = (e) => e.identifier;
  const was = new Map(before.events.map((e) => [key(e), e])), is = new Map((after.events ?? []).map((e) => [key(e), e]));
  const brief = (e) => ({ title: e.title, start: e.start, end: e.end, ...(e.orion ? { orion: e.orion } : {}) });
  const rWas = new Map((before.reminders ?? []).map((r) => [r.identifier, r]));
  return {
    created: [...is.values()].filter((e) => !was.has(key(e))).map(brief),
    deleted: [...was.values()].filter((e) => !is.has(key(e))).map(brief),
    moved: [...is.values()].filter((e) => was.has(key(e)) && (was.get(key(e)).start !== e.start || was.get(key(e)).end !== e.end))
      .map((e) => ({ title: e.title, from: [was.get(key(e)).start, was.get(key(e)).end], to: [e.start, e.end] })),
    todosAdded: (after.reminders ?? []).filter((r) => !rWas.has(r.identifier)).map((r) => ({ title: r.title, ...(r.due ? { due: r.due } : {}) })),
    todosCompleted: (after.reminders ?? []).filter((r) => r.completed && !rWas.get(r.identifier)?.completed).map((r) => r.title),
  };
}

const TOKEN = /\{\{\s*(now|today|tomorrow)\s*(?:([+-])\s*(\d+)\s*([mh]))?\s*(\d{1,2}:\d{2})?\s*\}\}/g;

/** "7:15pm", "8pm": how Nick writes a time. Rounded to 5 minutes. */
export function spokenClock(ms) {
  const d = new Date(Math.round(ms / 300_000) * 300_000);
  const h = d.getHours(), m = d.getMinutes();
  return `${h % 12 || 12}${m ? `:${pad(m)}` : ""}${h < 12 ? "am" : "pm"}`;
}

/** {{now+30m}}, {{now-90m}}, {{now+2h}}, {{today 17:00}}, {{tomorrow 09:00}} rendered against `nowMs`. */
export function renderTokens(text, nowMs) {
  return text.replace(TOKEN, (_, base, sign, n, unit, hhmm) => {
    if (base === "now") return spokenClock(nowMs + (sign === "-" ? -1 : 1) * Number(n ?? 0) * (unit === "h" ? 3_600_000 : 60_000));
    const d = new Date(nowMs); const [h, m] = (hhmm ?? "00:00").split(":").map(Number);
    d.setHours(h, m, 0, 0); if (base === "tomorrow") d.setDate(d.getDate() + 1);
    return spokenClock(d.getTime());
  });
}
export const hasTokens = (text) => /\{\{[^}]*\}\}/.test(text);
export const validToken = (text) => (text.match(/\{\{[^}]*\}\}/g) ?? []).every((t) => new RegExp(TOKEN.source).test(t));
