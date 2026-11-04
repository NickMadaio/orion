// A food photo from the phone is logged at once ("the AI logs it for me"): written to the health log when the estimate
// comes back, told to Nick with "Fix anything?", edited in place by a correction or taken off by undo, and never logged when
// the photo is not food or the model is only guessing. Real JPEG, a fake Ollama over HTTP, the real CLI, a temp controlled dir.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { logEstimate } from "../scripts/lib/food/log.mjs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, "..", "scripts", "orion-food-estimate");
const PHOTO = join(here, "fixtures", "food-inbox", "pizza-photo.jpg");

const PIZZA = { items: [
  { name: "pizza slice", grams: 150, kcal: 399, p: 16.5, c: 49.5, f: 15, confidence: "medium" },
  { name: "pineapple topping", grams: 30, kcal: 35, p: 0, c: 9, f: 0, confidence: "high" },
], assumptions: ["guessed the slice weight"] };
const TWO_SLICES = { items: [{ name: "pizza slice", grams: 300, kcal: 798, p: 33, c: 99, f: 30, confidence: "medium" }], assumptions: ["two slices"] };
const GUESS = { items: [{ name: "mystery plate", grams: 200, kcal: 300, p: 10, c: 40, f: 10, confidence: "low" }], assumptions: ["could be anything"] };
const NOTHING = { items: [], assumptions: ["no food found"] };

async function fakeOllama(answers) {
  let n = 0;
  const bodies = [];
  const server = createServer((req, res) => {
    let raw = ""; req.on("data", (d) => { raw += d; });
    req.on("end", () => { bodies.push(JSON.parse(raw || "{}")); res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ message: { content: JSON.stringify(answers[Math.min(n++, answers.length - 1)]) } })); });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, bodies, close: () => new Promise((r) => server.close(r)) };
}

function setup(id = "ph-1", note = "") {
  const dir = mkdtempSync(join(tmpdir(), "food-auto-"));
  writeFileSync(join(dir, "health-log.json"), JSON.stringify({ schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [], nutritionLog: {}, days: {} }));
  mkdirSync(join(dir, "food-inbox"));
  cpSync(PHOTO, join(dir, "food-inbox", `${id}.jpg`));
  writeFileSync(join(dir, "food-inbox", `${id}.json`), JSON.stringify({ id, at: "2026-11-03T18:20:00Z", note }));
  const sent = join(dir, "reach.log");
  const reach = join(dir, "fake-reach.mjs");
  writeFileSync(reach, `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(sent)}, JSON.stringify(process.argv.slice(2)) + "\\n");`);
  return { dir, sent, reach };
}
const run = (args, env) => new Promise((resolve) => execFile(process.execPath, [SCRIPT, ...args],
  { env: { ...process.env, ORION_EVAL_MARKER: join(env.ORION_CONTROLLED_DIR, "eval-mode"), ...env }, timeout: 20000 },
  (error, stdout) => resolve({ code: error?.code ?? 0, stdout: stdout.trim() })));
const rows = (dir) => Object.values(JSON.parse(readFileSync(join(dir, "health-log.json"), "utf8")).nutritionLog).flat();
const told = (s) => readFileSync(s.sent, "utf8").trim().split("\n").map((l) => JSON.parse(l)[0]);
const envOf = (s, o, at = "2026-11-03T18:30:00Z") => ({ ORION_OLLAMA_URL: o.url, ORION_CONTROLLED_DIR: s.dir, ORION_NOW: at, ORION_REACH_BIN: s.reach });

test("an estimated photo is written to the health log at once, once, and Nick is told with 'Fix anything?'", async () => {
  const o = await fakeOllama([PIZZA]); const s = setup();
  try {
    const env = envOf(s, o);
    await run(["inbox", "--json"], env);
    const [entry] = rows(s.dir);
    assert.equal(rows(s.dir).length, 1);
    assert.match(entry.id, /^FOOD-/); assert.equal(entry.loggedAt, "2026-11-03T18:20:00Z"); assert.ok(entry.calories > 400);
    assert.match(told(s)[0], /^Logged ~\d+ kcal — pizza slice, pineapple topping: \d+ g protein, \d+ g carbs, \d+ g fat\. Fix anything\?$/);
    await run(["inbox", "--json"], env);   // a second tick must not log it again
    assert.equal(rows(s.dir).length, 1);
    const day = JSON.parse(readFileSync(join(s.dir, "health-log.json"), "utf8")).days["2026-11-03"];
    assert.equal(day.calories, entry.calories);
  } finally { await o.close(); }
});

test("a correction edits that same entry in place; a bare yes keeps it; undo then removes it", async () => {
  const o = await fakeOllama([PIZZA, TWO_SLICES]); const s = setup();
  try {
    const env = envOf(s, o);
    await run(["inbox", "--json"], env);
    const first = rows(s.dir)[0];
    const fixed = JSON.parse((await run(["--revise", "nah that was 2 slices", "--json"], env)).stdout);
    assert.equal(fixed.ok, true);
    assert.match(fixed.offer.text, /^Updated ~800 kcal — pizza slice: \d+ g protein, \d+ g carbs, \d+ g fat\. Fix anything\?$/);
    assert.equal(rows(s.dir).length, 1, "edited in place, not added");
    assert.equal(rows(s.dir)[0].id, first.id); assert.equal(rows(s.dir)[0].calories, 798);
    assert.match(o.bodies[1].messages[1].content, /nah that was 2 slices/);
    assert.equal(o.bodies[1].messages[1].images.length, 1, "the correction re-reads the photo");
    const yes = await run(["log-pending", "--json"], env);
    assert.equal(JSON.parse(yes.stdout).ok, true); assert.equal(rows(s.dir).length, 1, "yes to 'Fix anything?' adds nothing");
    const back = JSON.parse((await run(["undo", first.id, "--json"], env)).stdout);   // an edit is recoverable: the first undo puts the first estimate back
    assert.equal(back.ok, true); assert.equal(back.restored, true);
    assert.equal(rows(s.dir).length, 1); assert.equal(rows(s.dir)[0].calories, first.calories);
    const gone = JSON.parse((await run(["undo", first.id, "--json"], env)).stdout);   // the second takes it off
    assert.equal(gone.ok, true); assert.equal(rows(s.dir).length, 0);
    assert.equal(JSON.parse(readFileSync(join(s.dir, "health-log.json"), "utf8")).days["2026-11-03"].calories, 0);
  } finally { await o.close(); }
});

test("undo straight after the first log removes the entry and the pending correction offer", async () => {
  const o = await fakeOllama([PIZZA]); const s = setup();
  try {
    const env = envOf(s, o);
    await run(["inbox", "--json"], env);
    const id = rows(s.dir)[0].id;
    await run(["undo", id, "--json"], env);
    assert.equal(rows(s.dir).length, 0);
    const pending = JSON.parse((await run(["pending", "--json"], env)).stdout);
    assert.equal(pending.pending, null);
    const late = JSON.parse((await run(["--revise", "make it bigger", "--json"], env)).stdout);
    assert.equal(late.ok, false); assert.equal(rows(s.dir).length, 0);
  } finally { await o.close(); }
});

test("a reply after 30 minutes is no longer an edit of the logged photo", async () => {
  const o = await fakeOllama([PIZZA, TWO_SLICES]); const s = setup();
  try {
    await run(["inbox", "--json"], envOf(s, o));
    const late = JSON.parse((await run(["--revise", "it was 2 slices", "--json"], envOf(s, o, "2026-11-03T19:10:00Z"))).stdout);
    assert.equal(late.ok, false);
    assert.equal(rows(s.dir)[0].calories < 600, true);
  } finally { await o.close(); }
});

test("a non-food photo logs nothing and asks 'Is this food?'", async () => {
  const o = await fakeOllama([NOTHING]); const s = setup();
  try {
    await run(["inbox", "--json"], envOf(s, o));
    assert.equal(rows(s.dir).length, 0);
    assert.match(told(s)[0], /^Is this food\? I couldn't tell\./);
  } finally { await o.close(); }
});

test("a low-confidence guess logs nothing, asks, and keeps the guess for a yes", async () => {
  const o = await fakeOllama([GUESS]); const s = setup();
  try {
    const env = envOf(s, o);
    await run(["inbox", "--json"], env);
    assert.equal(rows(s.dir).length, 0);
    assert.match(told(s)[0], /^Is this food\? I couldn't tell\..*Log it\?$/);
    await run(["log-pending", "--json"], env);
    assert.equal(rows(s.dir).length, 1);
  } finally { await o.close(); }
});

test("during an evaluation the photo is offered, not logged", async () => {
  const o = await fakeOllama([PIZZA]); const s = setup();
  try {
    writeFileSync(join(s.dir, "eval-mode"), "1");
    await run(["inbox", "--json"], envOf(s, o));
    assert.equal(rows(s.dir).length, 0);
  } finally { await o.close(); }
});

test("a correction whose entry is gone writes nothing, not a duplicate", () => {
  const s = setup();
  const est = { items: [{ name: "pizza slice", grams: 150, kcal: 399, p: 16.5, c: 49.5, f: 15, confidence: "medium" }], totals: { kcal: 399, p: 16.5, c: 49.5, f: 15, grams: 150 }, assumptions: [], confidence: "medium" };
  const before = readFileSync(join(s.dir, "health-log.json"), "utf8");
  const out = logEstimate(est, { at: new Date("2026-11-03T18:20:00Z"), now: new Date("2026-11-03T18:30:00Z"), env: { ORION_CONTROLLED_DIR: s.dir, ORION_EVAL_MARKER: join(s.dir, "eval-mode") }, target: { entryId: "FOOD-GONE", replace: true } });
  assert.equal(out.ok, false);
  assert.equal(readFileSync(join(s.dir, "health-log.json"), "utf8"), before);
});

test("with a logged photo and an older 'Log it?' offer, yes and no go to the open question; a correction goes to the logged entry", async () => {
  const o = await fakeOllama([GUESS, PIZZA, TWO_SLICES, GUESS]); const s = setup("b-new");
  try {
    writeFileSync(join(s.dir, "food-inbox", "a-old.json"), JSON.stringify({ id: "a-old", at: "2026-11-03T18:10:00Z", note: "" }));
    cpSync(PHOTO, join(s.dir, "food-inbox", "a-old.jpg"));
    const env = envOf(s, o);
    await run(["inbox", "--json"], env);
    assert.equal(rows(s.dir).length, 1, "the pizza is logged, the guess is only offered");
    const pizza = rows(s.dir)[0];
    const fixed = JSON.parse((await run(["--revise", "it was 2 slices", "--json"], env)).stdout);
    assert.equal(fixed.ok, true); assert.equal(rows(s.dir).length, 1); assert.equal(rows(s.dir)[0].id, pizza.id); assert.equal(rows(s.dir)[0].calories, 798);
    const yes = JSON.parse((await run(["log-pending", "--json"], env)).stdout);
    assert.equal(yes.ok, true);
    assert.equal(rows(s.dir).length, 2, "the yes logged the guess");
    assert.equal(rows(s.dir).find((r) => r.id === pizza.id).calories, 798, "and left the pizza as corrected");
  } finally { await o.close(); }
});

test("a no with a logged photo and an open offer drops the open offer and keeps the logged entry", async () => {
  const o = await fakeOllama([GUESS, PIZZA]); const s = setup("b-new");
  try {
    writeFileSync(join(s.dir, "food-inbox", "a-old.json"), JSON.stringify({ id: "a-old", at: "2026-11-03T18:10:00Z", note: "" }));
    cpSync(PHOTO, join(s.dir, "food-inbox", "a-old.jpg"));
    const env = envOf(s, o);
    await run(["inbox", "--json"], env);
    const no = JSON.parse((await run(["discard", "--json"], env)).stdout);
    assert.equal(no.discarded, 1); assert.equal(no.kept, undefined);
    assert.equal(rows(s.dir).length, 1);
    const left = JSON.parse((await run(["pending", "--json"], env)).stdout);
    assert.ok(left.pending.logged, "the logged photo is still open to a correction");
  } finally { await o.close(); }
});
