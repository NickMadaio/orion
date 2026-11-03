// orion-workout-log (2026-11-03): the rules, the schema guard on the model's numbers, missing parts and the one question, the follow-up
// flow (answer, second question, skip, no third), undo, eval mode, and the CLI against a fake Ollama (CI has no GPU). No real model, no live state.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readRules, numbersIn } from "../scripts/lib/workout/rules.mjs";
import { cleanDraft, emptyDraft } from "../scripts/lib/workout/schema.mjs";
import { missingOf, questionFor, summaryOf, mergeDrafts } from "../scripts/lib/workout/draft.mjs";
import { askModel } from "../scripts/lib/workout/ollama.mjs";

const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "orion-workout-log");
const draftOf = (text) => cleanDraft(readRules(text), text);

test("rules: NxM at weight, a w-50s dumbbell, minutes on a machine, and the split name", () => {
  const d = draftOf("did push day, bench 3x8 at 135, incline db 3x10 w 50s, then 20 min on the stairmaster");
  assert.deepEqual(d.exercises.map((e) => [e.name, e.sets, e.reps, e.weight]), [["bench", 3, 8, 135], ["incline db", 3, 10, 50]]);
  assert.equal(d.cardio[0].minutes, 20); assert.equal(d.cardio[0].machine, "stairmaster");
  assert.equal(d.title, "push"); assert.equal(d.type, "mixed"); assert.equal(d.durationMin, 0);
});
test("rules: miles, a 5k, kg, a total of an hour and a half, yesterday, 'sets of'", () => {
  assert.deepEqual(draftOf("went for a 3 mile run").cardio[0], { activity: "run", machine: "", minutes: 0, distance: 3, distanceUnit: "mi" });
  assert.equal(draftOf("ran 5k in 28 min").cardio[0].distanceUnit, "km");
  assert.equal(draftOf("legs yesterday, squats 5x5 at 100 kg, took like an hour and a half").exercises[0].unit, "kg");
  assert.equal(draftOf("legs yesterday, took an hour and a half").durationMin, 90);
  assert.equal(draftOf("legs yesterday").day, "yesterday");
  const s = draftOf("3 sets of 8 bench at 135").exercises[0];
  assert.deepEqual([s.name, s.sets, s.reps, s.weight], ["bench", 3, 8, 135]);
  assert.deepEqual(draftOf("deadlift 225x5").exercises[0], { name: "deadlift", sets: 1, reps: 5, weight: 225, unit: "lb" });
});
test("rules: minutes beside a cardio word are the cardio's, a bare total is the session's", () => {
  const d = draftOf("lifted for 55 min then 10 min on the treadmill");
  assert.equal(d.durationMin, 55); assert.equal(d.cardio[0].minutes, 10);
});
test("the schema guard drops a number the words never contained", () => {
  const said = "did legs, squats and rdl";
  const d = cleanDraft({ type: "strength", title: "legs", exercises: [{ name: "squats", sets: 4, reps: 6, weight: 185, unit: "lb" }], cardio: [], durationMin: 60 }, said);
  assert.deepEqual(d.exercises[0], { name: "squats", sets: 0, reps: 0, weight: 0, unit: "" });
  assert.equal(d.durationMin, 0);
  assert.ok(numbersIn("an hour and a half").has(90) && numbersIn("three sets").has(3));
  assert.equal(cleanDraft("nope", said), null);
});
test("missing: duration first, then sets/reps, then weight; bodyweight needs no weight; cardio minutes cover a cardio session", () => {
  const said = "legs: squats, rdl 3x8, leg press 3x12 at 200";
  const legs = cleanDraft({ type: "strength", title: "legs", exercises: [{ name: "squats", sets: 0, reps: 0, weight: 0, unit: "" }, { name: "rdl", sets: 3, reps: 8, weight: 0, unit: "" }, { name: "leg press", sets: 3, reps: 12, weight: 200, unit: "lb" }] }, said);
  assert.deepEqual(missingOf(legs).map((m) => m.key), ["duration", "sets", "weight"]);
  assert.deepEqual(missingOf(legs)[1].names, ["squats"]);
  assert.deepEqual(missingOf(draftOf("pull ups 3x10, 40 min total")), []);
  assert.deepEqual(missingOf(draftOf("30 min on the bike")), []);
  assert.deepEqual(missingOf(draftOf("worked out today")).map((m) => m.key), ["what", "duration"]);
});
test("the question covers the two most important gaps and is one short sentence", () => {
  const d = draftOf("legs: squats 4x6, rdl 3x8 at 135");   // squats has sets and reps but no weight
  assert.equal(questionFor(missingOf(d)), "Nice. Roughly how long was it, and what weight on the squats?");
  assert.equal(questionFor(missingOf(d).slice(1), { second: true }), "Got it. And what weight on the squats?");
  assert.equal(questionFor([{ key: "what" }, { key: "duration" }]), "Nice. What did you do (lifts, a run, a sport), and roughly how long was it?");
});
test("the summary line is compact", () => {
  const d = { ...draftOf("legs, squats 4x6 at 185, rdl 3x8 at 135, leg press 3x12 at 300"), durationMin: 55 };
  assert.equal(summaryOf(d), "legs, 55 min, squats 4x6 at 185, rdl 3x8 at 135, leg press 3x12 at 300");
});
test("merging an answer fills a lift by name and never doubles it", () => {
  const base = cleanDraft({ type: "strength", title: "legs", exercises: [{ name: "squats", sets: 0, reps: 0, weight: 0, unit: "" }, { name: "rdl", sets: 3, reps: 8, weight: 135, unit: "lb" }] }, "legs, squats, rdl 3x8 at 135");
  const add = draftOf("back squat 4x6 at 185, 55 min");
  const m = mergeDrafts(base, add);
  assert.equal(m.exercises.length, 2); assert.equal(m.exercises[0].weight, 185); assert.equal(m.durationMin, 55);
});
test("askModel: strict JSON format and a timeout come back as sentences", async () => {
  const seen = [];
  const ok = await askModel({ text: "legs", today: "Tue" }, { fetchImpl: async (u, init) => { seen.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ message: { content: "{}" } }) }; } });
  assert.equal(ok.ok, true); assert.equal(seen[0].format.type, "object"); assert.equal(seen[0].stream, false);
  const slow = await askModel({ text: "legs" }, { timeoutMs: 20, fetchImpl: (u, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("x"), { name: "AbortError" })))) });
  assert.match(slow.error, /took longer/);
  assert.match((await askModel({ text: "x" }, { fetchImpl: async () => { throw new Error("down"); } })).error, /isn't reachable/);
});

// ---- the CLI against a fake Ollama ----
async function fakeOllama(reply) {
  const server = createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
      const out = typeof reply === "function" ? reply(JSON.parse(body)) : reply;
      if (out === null) { res.statusCode = 500; res.end("no"); return; }
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ message: { content: JSON.stringify(out) } }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}
const LEGS = { type: "strength", title: "legs", day: "", startTime: "", durationMin: 0, sport: "", effort: 0, notes: "", cardio: [],
  exercises: [{ name: "squats", sets: 4, reps: 6, weight: 185, unit: "lb" }, { name: "RDL", sets: 3, reps: 8, weight: 135, unit: "lb" }, { name: "leg press", sets: 3, reps: 12, weight: 0, unit: "" }] };
function sandbox(url, extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), "wk-"));
  writeFileSync(join(dir, "health-log.json"), JSON.stringify({ schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [{ id: "mine", day: "2026-10-01", title: "Hand logged", exercises: [], notes: "" }] }));
  const env = { ...process.env, ORION_CONTROLLED_DIR: dir, ORION_OLLAMA_URL: url, ORION_NOW: "2026-11-03T18:00:00Z", ...extraEnv };
  const run = (...args) => new Promise((resolve) => execFile(process.execPath, [bin, ...args, "--json"], { env }, (e, stdout) => resolve(JSON.parse(stdout.trim().split("\n").at(-1)))));
  const log = () => JSON.parse(readFileSync(join(dir, "health-log.json"), "utf8"));
  return { dir, run, log };
}

test("CLI: a full description is logged in one go with the app's session shape, and undo takes exactly it off", async () => {
  const fake = await fakeOllama({ ...LEGS, exercises: LEGS.exercises.map((e) => ({ ...e, weight: e.name === "leg press" ? 300 : e.weight })), durationMin: 55 });
  try {
    const s = sandbox(fake.url);
    const text = "just did legs, 55 min, squats 4x6 at 185, rdl 3x8 at 135, leg press 3x12 at 300";
    const r = await s.run("--text", text, "--chat");
    assert.equal(r.ok, true); assert.equal(r.asking, undefined);
    assert.equal(r.say, 'Logged: legs, 55 min, squats 4x6 at 185, RDL 3x8 at 135, leg press 3x12 at 300. Say "undo" to take it off.');
    const w = s.log().workouts;
    assert.equal(w.length, 2); const e = w[1];
    assert.match(e.id, /^WKT-/); assert.equal(e.source, "chat"); assert.equal(e.day, "2026-11-03"); assert.equal(e.title, "Legs");
    assert.equal(e.exercises[0].sets.length, 4); assert.deepEqual(Object.keys(e.exercises[0].sets[0]).sort(), ["id", "reps", "unit", "weight"]);
    assert.match(e.startedAt, /^2026-11-03T\d\d:\d\d:\d\dZ$/); assert.match(e.notes, /55 min/);
    const u = await s.run("undo", e.id);
    assert.equal(u.ok, true); assert.equal(s.log().workouts.length, 1);
    assert.equal((await s.run("undo", "mine")).ok, false);   // never a session he logged himself
    assert.equal(s.log().workouts[0].id, "mine");
  } finally { fake.close(); }
});

test("CLI: a forgotten part gets one question; the answer fills it and logs", async () => {
  const fake = await fakeOllama(LEGS);
  try {
    const s = sandbox(fake.url);
    const q = await s.run("--text", "just did legs, squats 4x6 at 185, rdl 3x8 at 135, leg press 3x12", "--chat");
    assert.equal(q.asking, true); assert.equal(q.say, "Nice. Roughly how long was it, and what weight on the leg press?");
    assert.equal(s.log().workouts.length, 1);   // nothing logged yet
    assert.equal(JSON.parse(readFileSync(join(s.dir, "workout-pending.json"), "utf8")).asked, 1);
    const done = await s.run("answer", "about 55 min, leg press was 300");
    assert.match(done.say, /^Logged: legs, 55 min, squats 4x6 at 185, RDL 3x8 at 135, leg press 3x12 at 300\./);
    assert.equal(done.skipped.length, 0);
    assert.equal(existsSync(join(s.dir, "workout-pending.json")), false);
  } finally { fake.close(); }
});

test("CLI: at most two questions, then it logs what is known and says what was skipped", async () => {
  const fake = await fakeOllama(LEGS);
  try {
    const s = sandbox(fake.url);
    await s.run("--text", "just did legs, squats 4x6 at 185, rdl 3x8 at 135, leg press 3x12", "--chat");
    const second = await s.run("answer", "55 min");
    assert.equal(second.asking, true); assert.equal(second.say, "Got it. And what weight on the leg press?");
    const last = await s.run("answer", "lol not sure honestly it was heavy");
    assert.equal(last.asking, undefined); assert.match(last.say, /^Logged: legs, 55 min, squats 4x6 at 185, RDL 3x8 at 135, leg press 3x12\. Skipped: weight for leg press\./);
    assert.equal(s.log().workouts.length, 2);
  } finally { fake.close(); }
});

test("CLI: skip / idk logs as it stands, with the gaps named", async () => {
  const fake = await fakeOllama(null);   // the model is down: the rules alone carry it
  try {
    const s = sandbox(fake.url);
    const q = await s.run("--text", "went for a 3 mile run", "--chat");
    assert.equal(q.say, "Nice. Roughly how long was it?"); assert.equal(q.via, "rules");
    const done = await s.run("answer", "idk");
    assert.equal(done.say, 'Logged: 3 mi run. Skipped: how long. Say "undo" to take it off.');
    assert.deepEqual(s.log().workouts[1].skipped, ["how long"]);
    assert.equal((await s.run("answer", "55")).ok, false);   // nothing waiting any more
  } finally { fake.close(); }
});

test("CLI: a bare number answers a duration question, 'never mind' drops the workout", async () => {
  const fake = await fakeOllama(null);
  try {
    const s = sandbox(fake.url);
    await s.run("--text", "ran 3 miles", "--chat");
    assert.match((await s.run("answer", "28")).say, /^Logged: 3 mi run, 28 min|^Logged: 28 min/);
    await s.run("--text", "went for a swim", "--chat");
    assert.equal((await s.run("discard")).say, "Okay, not logged.");
    assert.equal(existsSync(join(s.dir, "workout-pending.json")), false);
    assert.equal(s.log().workouts.length, 2);
  } finally { fake.close(); }
});

test("CLI: the model inventing a number is not logged as his", async () => {
  const fake = await fakeOllama({ ...LEGS, exercises: [{ name: "squats", sets: 4, reps: 6, weight: 225, unit: "lb" }], durationMin: 60 });
  try {
    const s = sandbox(fake.url);
    const q = await s.run("--text", "did legs today, squats mostly", "--chat");
    assert.equal(q.asking, true); assert.equal(q.draft.exercises[0].weight, 0); assert.equal(q.draft.durationMin, 0);
  } finally { fake.close(); }
});

test("CLI: a model that files a machine's minutes as the whole session's length does not hide the missing duration", async () => {
  const fake = await fakeOllama({ type: "mixed", title: "push", day: "", startTime: "", durationMin: 20, sport: "", effort: 0, notes: "",
    exercises: [{ name: "bench", sets: 3, reps: 8, weight: 135, unit: "lb" }], cardio: [{ activity: "stairmaster", machine: "stairmaster", minutes: 20, distance: 0, distanceUnit: "" }] });
  try {
    const q = await sandbox(fake.url).run("--text", "did push day, bench 3x8 at 135, then 20 min on the stairmaster", "--chat");
    assert.equal(q.asking, true); assert.equal(q.say, "Nice. Roughly how long was it?"); assert.equal(q.draft.durationMin, 0);
  } finally { fake.close(); }
});

test("CLI: eval mode writes nothing (log or pending) and says so", async () => {
  const fake = await fakeOllama(LEGS);
  try {
    const s = sandbox(fake.url);
    writeFileSync(join(s.dir, "eval-mode"), "");
    const q = await s.run("--text", "just did legs, squats 4x6 at 185, rdl 3x8 at 135, leg press 3x12", "--chat");
    assert.equal(q.asking, true); assert.match(q.pending.note, /evaluation/);
    assert.equal(existsSync(join(s.dir, "workout-pending.json")), false);
    const l = await s.run("--text", "just did legs, 55 min, squats 4x6 at 185, rdl 3x8 at 135, leg press 3x12 at 300", "--log");
    assert.equal(l.ok, false); assert.match(l.say, /evaluation run/);
    assert.equal(s.log().workouts.length, 1);
  } finally { fake.close(); }
});

test("CLI: without --chat or --log it only reads, and an unreadable ramble is a plain failure", async () => {
  const fake = await fakeOllama(null);
  try {
    const s = sandbox(fake.url);
    const r = await s.run("--text", "bench 3x8 at 135");
    assert.equal(r.ok, true); assert.equal(s.log().workouts.length, 1);
    const bad = await s.run("--text", "so this morning was honestly a total blur of everything and nothing at all");
    assert.equal(bad.ok, false); assert.match(bad.say, /nothing was logged/);
  } finally { fake.close(); }
});
