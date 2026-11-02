// W10-B (2026-11-02): his sleep plan — a wake per weekday, a lead before the first class, the bedtime from 8 h of sleep, and
// the nights he is let off the lockdown. config.mjs (store), night.mjs (the rule), orion-sleepplan (CLI + wake-plan.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validSleepPlan, sleepPlanOf, setSleepPlan, loadConfig, DEFAULTS } from "../scripts/lib/life/config.mjs";
import { wakeOn, wakeWhy, bedOn } from "../scripts/lib/life/night.mjs";
import { parseDays, withWake, withException, weekPlan, wakePlanDoc } from "../scripts/lib/life/sleep-plan.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts/orion-sleepplan");
const base = { usualWake: "09:00", bedtime: "00:00", sleepHours: 8, readyMinutes: 105, commuteMinutes: 30 };
const cls = (title, start, end) => ({ title, start, end, fixed: true, source: "calendar", kind: "class" });
// Mon 2026-11-02 .. Sun 11-08: Tue/Fri class 13:30, Wed 9:00 lecture, Thu 10:00 lab.
const week = {
  "2026-11-03": [cls("MKTG2201 Lecture", 810, 905)], "2026-11-04": [cls("CS1800 Lecture", 540, 640)],
  "2026-11-05": [cls("CS2100 Lab", 600, 660)], "2026-11-06": [cls("MKTG2201 Lecture", 810, 905)],
};
const blocksOf = (d) => week[d] ?? [];
const nick = { ...base, sleepPlan: { byDay: { mon: { wake: "06:00" }, wed: { wake: "06:00" }, thu: { wake: "06:00" } }, firstClassLeadMin: 180 } };

test("store: defaults, validation, and a stored plan merged over the defaults without touching them", () => {
  assert.equal(DEFAULTS.sleepPlan.nudgeBeforeMin, 30);
  assert.equal(DEFAULTS.sleepPlan.lockdownBelowHours, 6);
  assert.equal(sleepPlanOf(base).sleepHours, 8, "falls back to the top-level sleepHours");
  assert.equal(sleepPlanOf(base).firstClassLeadMin, null, "no lead until he sets one");
  assert.ok(validSleepPlan(nick.sleepPlan));
  assert.ok(!validSleepPlan({ byDay: { monday: { wake: "06:00" } } }), "day keys are mon..sun");
  assert.ok(!validSleepPlan({ byDay: { mon: { wake: "6am" } } }));
  assert.ok(!validSleepPlan({ firstClassLeadMin: 5 }));
  assert.ok(!validSleepPlan({ exceptions: [{ date: "tonight", reason: "friends" }] }));
  assert.ok(!validSleepPlan({ surprise: 1 }), "unknown fields refused");
  const merged = sleepPlanOf(nick);
  merged.byDay.tue = { wake: "05:00" };
  assert.equal(nick.sleepPlan.byDay.tue, undefined, "sleepPlanOf copies");
  assert.deepEqual(DEFAULTS.sleepPlan.byDay, {});
});

test("store: setSleepPlan keeps his other settings and refuses a bad plan", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sleepplan-cfg-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "life-config.json");
  writeFileSync(file, JSON.stringify({ usualWake: "08:30" }));
  setSleepPlan(nick.sleepPlan, file);
  const cfg = loadConfig(file);
  assert.equal(cfg.usualWake, "08:30");
  assert.equal(cfg.sleepPlan.firstClassLeadMin, 180);
  assert.throws(() => setSleepPlan({ byDay: { mon: { wake: "25:00" } } }, file));
});

test("wake: per-day plan, else the class lead, else usual; never later than class − lead", () => {
  assert.deepEqual(wakeWhy("2026-11-02", { blocksOf, config: nick }), { minute: 360, reason: "plan" }, "Mon gym day");
  assert.deepEqual(wakeWhy("2026-11-03", { blocksOf, config: nick }), { minute: 540, reason: "usual" }, "Tue 1:30 class: normal 9");
  assert.equal(wakeOn("2026-11-04", { blocksOf, config: nick }), 360, "Wed 9:00 lecture: 6:00 either way");
  assert.equal(wakeOn("2026-11-08", { blocksOf, config: nick }), 540, "Sun free");
  // A day with a plan of 07:30 and an 8:00 class: the lead pulls it to 05:00.
  const early = { ...nick, sleepPlan: { ...nick.sleepPlan, byDay: { sat: { wake: "07:30" } } } };
  assert.deepEqual(wakeWhy("2026-11-07", { blocksOf: () => [cls("Makeup lab", 480, 540)], config: early }), { minute: 300, reason: "class" });
  // No lead set: the old get-ready rule for the first commitment.
  assert.equal(wakeOn("2026-11-04", { blocksOf, config: base }), 540 - 105);
  // A one-off morning alarm still wins.
  assert.equal(wakeOn("2026-11-03", { blocksOf, config: nick, wakeRequest: { date: "2026-11-03", minute: 420 } }), 420);
});

test("bed: next wake − 8 h, capped at bedtime; a night out still wins", () => {
  assert.equal(bedOn("2026-11-03", { blocksOf, config: nick }), 1440 + 360 - 480, "before Wed 6:00: 22:00");
  assert.equal(bedOn("2026-11-04", { blocksOf, config: nick }), 1320, "before Thu 6:00: 22:00");
  assert.equal(bedOn("2026-11-05", { blocksOf, config: nick }), 1440, "before Fri 9:00: midnight cap");
  const out = { "2026-11-03": [{ title: "Bar with Sam", start: 1260, end: 1410, fixed: true, source: "calendar" }] };
  assert.equal(bedOn("2026-11-03", { blocksOf: (d) => out[d] ?? week[d] ?? [], config: nick }), 1440);
});

test("helpers: day words, an only-these-days change, one exception per evening", () => {
  assert.deepEqual(parseDays("mon,wed,thu"), ["mon", "wed", "thu"]);
  assert.deepEqual(parseDays("weekdays"), ["mon", "tue", "wed", "thu", "fri"]);
  assert.deepEqual(parseDays("Monday Wednesday"), ["mon", "wed"]);
  assert.throws(() => parseDays("someday"));
  const plan = sleepPlanOf({ ...base, sleepPlan: { byDay: { sat: { wake: "10:00" } } } });
  assert.deepEqual(Object.keys(withWake(plan, ["mon"], "06:00").byDay), ["sat", "mon"]);
  assert.deepEqual(Object.keys(withWake(plan, ["mon"], "06:00", { only: true }).byDay), ["mon"]);
  const now = new Date(2026, 10, 2, 21, 0);
  const one = withException(sleepPlanOf(base), { date: "2026-11-02", reason: "friends", until: null }, now);
  const two = withException({ ...one, exceptions: [...one.exceptions, { date: "2026-10-20", reason: "bar", until: null }] }, { date: "2026-11-02", reason: "schoolwork", until: "01:00" }, now);
  assert.deepEqual(two.exceptions, [{ date: "2026-11-02", reason: "schoolwork", until: "01:00" }], "old ones dropped, newest wins");
});

test("week plan → wake-plan.json shape: alarms, bedtimes and lockdowns line up", () => {
  const now = new Date(2026, 10, 2, 20, 0);
  const days = weekPlan({ now, config: nick, blocksOf });
  const doc = wakePlanDoc({ now, days, config: nick });
  assert.deepEqual(Object.keys(doc), ["source", "generatedAt", "alarms", "bedtimes", "lockdowns", "sleepHours", "nudgeBeforeMin", "lockdownBelowHours"]);
  assert.equal(doc.source, "nick");
  assert.equal(wakePlanDoc({ now, days, config: base }).source, "default", "no plan of his: alarms must not ring from it");
  assert.equal(wakePlanDoc({ now, days, config: { ...base, sleepPlan: { firstClassLeadMin: 180 } } }).source, "nick", "a lead alone is his");
  assert.equal(doc.alarms.length, 3, "only plan/class mornings ring (Tue 11-03 usual is not one)");
  assert.deepEqual(Object.keys(doc.alarms[0]), ["date", "at", "iso", "reason", "byNick"]);
  assert.deepEqual(Object.keys(doc.bedtimes[0]), ["date", "sleepBy", "nudgeAt", "sleepByIso", "nudgeAtIso"]);
  assert.deepEqual(doc.alarms.map((a) => a.at), ["06:00", "06:00", "06:00"]);
  assert.deepEqual(doc.bedtimes[1], { date: "2026-11-03", sleepBy: "22:00", nudgeAt: "21:30",
    sleepByIso: new Date(2026, 10, 3, 22, 0).toISOString(), nudgeAtIso: new Date(2026, 10, 3, 21, 30).toISOString() });
  assert.deepEqual(doc.lockdowns[1], { date: "2026-11-03", at: "00:00", iso: new Date(2026, 10, 4, 0, 0).toISOString(), exception: null });
  // At 07:00 on Monday the 6:00 alarm is behind him: the first alarm is Tuesday's.
  assert.equal(weekPlan({ now: new Date(2026, 10, 2, 7, 0), config: nick, blocksOf })[0].date, "2026-11-03");
  assert.equal(weekPlan({ now: new Date(2026, 10, 2, 5, 0), config: nick, blocksOf })[0].date, "2026-11-02");
});

// The CLI against a sandboxed evaluation: eval-mode marker + eval-calendar.json in a tmp ORION_CONTROLLED_DIR.
function sandbox(t, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), "sleepplan-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "eval-mode"), "");
  const ev = (d, h, m, dur, title) => { const s = new Date(2026, 10, d, h, m); return { identifier: `${title}-${d}`, title, allDay: "false", start: s.toISOString(), end: new Date(s.getTime() + dur * 60000).toISOString() }; };
  writeFileSync(join(dir, "eval-calendar.json"), JSON.stringify({ now: new Date(2026, 10, 2, 20, 0).toISOString(),
    events: [ev(3, 13, 30, 95, "MKTG2201 Lecture"), ev(4, 9, 0, 100, "CS1800 Lecture"), ev(5, 10, 0, 60, "CS2100 Lab"), ev(6, 13, 30, 95, "MKTG2201 Lecture"), ...extra.map((e) => ev(...e))] }));
  const env = { ...process.env, HOME: dir, ORION_CONTROLLED_DIR: dir };
  for (const k of ["ORION_LIFE_CONFIG", "ORION_BRIDGE_BIN", "ORION_RESCHEDULE_NOW", "ORION_NOW", "ORION_EVAL_MARKER", "ORION_SANDBOX_CALENDAR"]) delete env[k];
  const run = (...args) => { const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env }); return { code: r.status, out: r.stdout, err: r.stderr }; };
  return { dir, run };
}

test("CLI: a preview saves nothing; set + lead write the eval config and eval-wake-plan.json only", (t) => {
  const { dir, run } = sandbox(t);
  const preview = run("plan", "--json", "--days", "mon,wed,thu", "--wake", "06:00", "--only");
  assert.equal(preview.code, 0, preview.err);
  const p = JSON.parse(preview.out);
  assert.equal(p.saved, false);
  assert.equal(p.calendar, "ok");
  assert.deepEqual(p.days.map((d) => `${d.weekday} ${d.wake}`).slice(0, 4), ["tue 09:00", "wed 06:00", "thu 06:00", "fri 09:00"]);
  assert.equal(p.days[0].firstClass.at, "13:30");
  assert.ok(!existsSync(join(dir, "eval-life-config.json")) && !existsSync(join(dir, "eval-wake-plan.json")));
  assert.equal(run("set", "--days", "mon,wed,thu", "--wake", "06:00", "--only").code, 0);
  const lead = run("lead", "180", "--json");
  assert.equal(lead.code, 0, lead.err);
  assert.equal(JSON.parse(lead.out).plan.firstClassLeadMin, 180);
  assert.ok(!existsSync(join(dir, "life-config.json")) && !existsSync(join(dir, "wake-plan.json")), "never the live names in a sandbox");
  const saved = JSON.parse(readFileSync(join(dir, "eval-life-config.json"), "utf8")).sleepPlan;
  assert.deepEqual(saved.byDay, { mon: { wake: "06:00" }, wed: { wake: "06:00" }, thu: { wake: "06:00" } });
  const plan = JSON.parse(readFileSync(join(dir, "eval-wake-plan.json"), "utf8"));
  assert.equal(plan.generatedAt, new Date(2026, 10, 2, 20, 0).toISOString(), "the sandbox clock");
  assert.equal(plan.source, "nick");
  assert.deepEqual(plan.alarms.slice(0, 1).map((a) => [a.date, a.at, a.reason]), [["2026-11-04", "06:00", "plan"]]);
  assert.equal(plan.bedtimes[1].sleepBy, "22:00");
});

test("CLI: one set carries days, the rest and the lead; gym days come from his gym anchor", (t) => {
  const { dir, run } = sandbox(t);
  writeFileSync(join(dir, "eval-life-config.json"), JSON.stringify({ anchors: [{ title: "Gym", kind: "gym", minutes: 60, days: [1, 3, 4], rank: "must" }] }));
  const r = run("set", "--days", "gym", "--wake", "6:30", "--only", "--rest", "09:30", "--lead", "180", "--json");
  assert.equal(r.code, 0, r.err);
  const out = JSON.parse(r.out);
  assert.deepEqual(out.plan.byDay, { sun: { wake: "09:30" }, mon: { wake: "06:30" }, tue: { wake: "09:30" }, wed: { wake: "06:30" }, thu: { wake: "06:30" }, fri: { wake: "09:30" }, sat: { wake: "09:30" } });
  assert.equal(out.plan.firstClassLeadMin, 180);
  assert.equal(out.days.find((d) => d.weekday === "wed").wake, "06:00", "Wed 9:00 class − 3 h beats 6:30");
  assert.equal(JSON.parse(readFileSync(join(dir, "eval-life-config.json"), "utf8")).anchors.length, 1, "his other settings kept");
  assert.equal(run("set", "--wake", "06:00").code, 2, "a set with nothing to set");
});

test("CLI: exceptions — a legit reason is kept for tonight, gaming is refused, clear-except takes it back", (t) => {
  const { dir, run } = sandbox(t);
  const no = run("except", "--date", "tonight", "--reason", "gaming");
  assert.equal(no.code, 3);
  assert.match(no.err, /NOTHING WAS SAVED/);
  assert.ok(!existsSync(join(dir, "eval-life-config.json")));
  assert.equal(run("except", "--date", "tonight", "--reason", "schoolwork", "--until", "1:00").code, 0);
  const cfg = JSON.parse(readFileSync(join(dir, "eval-life-config.json"), "utf8"));
  assert.deepEqual(cfg.sleepPlan.exceptions, [{ date: "2026-11-02", reason: "schoolwork", until: "01:00" }]);
  const plan = JSON.parse(readFileSync(join(dir, "eval-wake-plan.json"), "utf8"));
  assert.deepEqual(plan.lockdowns[0].exception, { reason: "schoolwork", until: "01:00" });
  assert.equal(plan.source, "default", "an exception alone never makes the default alarms his");
  assert.equal(run("clear-except", "--date", "tonight").code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "eval-life-config.json"), "utf8")).sleepPlan.exceptions, []);
  assert.equal(run("set", "--days", "funday", "--wake", "06:00").code, 2);
  assert.equal(run("bogus").code, 2);
});

test("wake-plan.json alarms: only what he asked for (plan, class), each marked byNick; never usual/commitment/asked", () => {
  const now = new Date(2026, 10, 2, 20, 0);
  const sat = [{ title: "Dentist", start: 600, end: 660, fixed: true, source: "calendar", kind: "commitment" }];
  const blocks = (d) => (d === "2026-11-07" ? sat : blocksOf(d));
  const days = weekPlan({ now, config: nick, blocksOf: blocks, wakeRequest: { date: "2026-11-05", minute: 420 } });
  assert.ok(days.some((d) => d.reason === "usual") && days.some((d) => d.reason === "commitment" || d.reason === "asked"), "fixture covers the other reasons");
  const doc = wakePlanDoc({ now, days, config: nick });
  assert.ok(doc.alarms.length > 0);
  for (const a of doc.alarms) { assert.ok(["plan", "class"].includes(a.reason), a.reason); assert.equal(a.byNick, true); }
  assert.equal(doc.bedtimes.length, days.length, "bedtimes still cover every night");
});

test("orion-sleepplan never copies a wake request into the plan", () => {
  const src = readFileSync(SCRIPT, "utf8");
  assert.ok(!/wakeRequest:\s*await readWakeRequest/.test(src));
});

// W10-B review (live gate): several day groups in one write, gym days from the calendar, and a per-day wake the lead never pushes later.
test("a per-day wake he chose is never moved later by the lead; only earlier", () => {
  const plan = { ...base, sleepPlan: { byDay: { tue: { wake: "06:00" } }, firstClassLeadMin: 180 } };
  assert.deepEqual(wakeWhy("2026-11-03", { blocksOf, config: plan }), { minute: 360, reason: "plan" }, "Tue 1:30 class: still 6:00");
  assert.deepEqual(wakeWhy("2026-11-03", { blocksOf: () => [cls("Early lab", 510, 600)], config: plan }), { minute: 330, reason: "class" }, "8:30 class pulls it to 5:30");
});

test("CLI: --also and --sleep land in the same write; the rest covers only days nobody named", (t) => {
  const { dir, run } = sandbox(t);
  const r = run("set", "--days", "mon,wed,thu", "--wake", "06:00", "--only", "--also", "tue,fri=09:00", "--rest", "10:00", "--sleep", "8.5", "--json");
  assert.equal(r.code, 0, r.err);
  const out = JSON.parse(r.out);
  assert.deepEqual(out.plan.byDay, { mon: { wake: "06:00" }, wed: { wake: "06:00" }, thu: { wake: "06:00" }, tue: { wake: "09:00" }, fri: { wake: "09:00" }, sun: { wake: "10:00" }, sat: { wake: "10:00" } });
  assert.equal(JSON.parse(readFileSync(join(dir, "eval-life-config.json"), "utf8")).sleepPlan.sleepHours, 8.5);
  assert.equal(out.days.find((d) => d.weekday === "wed").sleepBy, "21:30", "8.5 h before 6:00");
  assert.equal(run("set", "--also", "tue=9am").code, 2);
});

test("CLI: gym days are the days with a Gym block this week; unknown is an error that says so", (t) => {
  const { run } = sandbox(t, [[2, 17, 0, 90, "Gym"], [4, 17, 0, 90, "Gym"], [5, 7, 0, 60, "Gym"]]);
  const r = run("plan", "--json", "--days", "gym", "--wake", "06:30");
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(Object.keys(JSON.parse(r.out).plan.byDay), ["mon", "wed", "thu"]);
  const none = sandbox(t).run("plan", "--json", "--days", "gym", "--wake", "06:30");
  assert.equal(none.code, 2);
  assert.match(JSON.parse(none.out).error, /gym days unknown/);
});

// W10-B review 2 (gate slp-alarm-v): a daily Gym block picked Mon–Sat. The days his plan ties to the gym come first; a Gym block on
// (nearly) every day names no days, so ORION asks.
test("CLI: gym days — his plan's --gym days first; a daily Gym block names no days", (t) => {
  const daily = [2, 3, 4, 5, 6, 7, 8].map((d) => [d, 17, 0, 90, "Gym"]);
  const { dir, run } = sandbox(t, daily);
  const unknown = run("plan", "--json", "--days", "gym", "--wake", "06:00");
  assert.equal(unknown.code, 2);
  assert.match(JSON.parse(unknown.out).error, /gym days unknown/);
  const set = run("set", "--days", "tue,thu,sat", "--wake", "06:15", "--only", "--gym", "--json");
  assert.equal(set.code, 0, set.err);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "eval-life-config.json"), "utf8")).sleepPlan.gymDays, ["tue", "thu", "sat"]);
  const later = run("set", "--days", "gym", "--wake", "05:45", "--json");
  assert.equal(later.code, 0, later.err);
  assert.deepEqual(JSON.parse(later.out).plan.byDay, { tue: { wake: "05:45" }, thu: { wake: "05:45" }, sat: { wake: "05:45" } });
  assert.ok(validSleepPlan({ gymDays: ["mon"] }) && !validSleepPlan({ gymDays: ["monday"] }));
});

// W10-B review 3 (gate hea-bedtime-set-v): "i wanna sleep earlier this week" is a bedtime change, written to the eval config in a sandbox.
test("CLI: bedtime earlier / HH:MM sets the bedtime cap, rewrites the bedtimes, and leaves his sleep plan alone", (t) => {
  const { dir, run } = sandbox(t);
  const r = run("bedtime", "earlier", "--json");
  assert.equal(r.code, 0, r.err);
  const out = JSON.parse(r.out);
  assert.equal(out.bedtime, "23:30");
  assert.equal(out.was, "00:00");
  assert.equal(out.days[0].sleepBy, "23:30", "before Tue 9:00: the new cap");
  assert.equal(out.days[0].nudgeAt, "23:00");
  const cfg = JSON.parse(readFileSync(join(dir, "eval-life-config.json"), "utf8"));
  assert.equal(cfg.bedtime, "23:30");
  assert.equal(cfg.sleepPlan, undefined);
  assert.equal(JSON.parse(readFileSync(join(dir, "eval-wake-plan.json"), "utf8")).bedtimes[0].sleepBy, "23:30");
  assert.equal(JSON.parse(run("bedtime", "earlier", "--json").out).bedtime, "23:00");
  assert.equal(JSON.parse(run("bedtime", "21:00", "--json").out).bedtime, "21:00", "a time he names is kept");
  assert.equal(run("bedtime", "late").code, 2);
});
