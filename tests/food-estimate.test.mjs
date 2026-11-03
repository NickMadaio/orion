// orion-food-estimate (2026-11-02): the table, the schema and macro check, grounding, the summary line, the Ollama call
// (a fake: CI has no GPU), logging with undo, the pending offer and the food inbox. No real model, no live state.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, cpSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTable, matchFood, fromTable } from "../scripts/lib/food/table.mjs";
import { extractJson, validateEstimate, cleanItem, macroKcal } from "../scripts/lib/food/schema.mjs";
import { ground, summaryLine, estimateMeal } from "../scripts/lib/food/estimate.mjs";
import { askModel } from "../scripts/lib/food/ollama.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "food-inbox");

const BOWL = { items: [
  { name: "white rice", grams: 200, kcal: 260, p: 5.4, c: 56, f: 0.6, confidence: "high" },
  { name: "grilled chicken breast", grams: 150, kcal: 248, p: 46.5, c: 0, f: 5.4, confidence: "high" },
  { name: "olive oil", grams: 10, kcal: 88, p: 0, c: 0, f: 10, confidence: "low" },
], totals: { kcal: 999, p: 1, c: 1, f: 1 }, assumptions: ["guessed the oil", "assumed a canteen portion of rice"] };

const fakeFetch = (content, { status = 200, seen = [] } = {}) => async (url, init) => {
  seen.push({ url, body: JSON.parse(init.body) });
  return { ok: status === 200, status, json: async () => ({ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }) };
};

test("the table has about 150 foods and every non-alcohol row's kcal agrees with its macros", () => {
  const { foods } = loadTable();
  assert.ok(foods.length >= 150, `only ${foods.length}`);
  for (const f of foods) {
    if (f.alcohol || f.per100g.kcal < 20) continue;
    const est = macroKcal(f.per100g);
    assert.ok(Math.abs(est - f.per100g.kcal) / f.per100g.kcal <= 0.15, `${f.name}: ${f.per100g.kcal} vs ${est}`);
  }
});

test("matching: exact aliases, the longest phrase inside a name, and no guess from one word of many", () => {
  assert.equal(matchFood("Coke")?.name, "coca cola");
  assert.equal(matchFood("a can of diet coke")?.name, "diet coke");
  assert.equal(matchFood("grilled chicken breast")?.name, "chicken breast, cooked");
  assert.equal(matchFood("large chicken burrito")?.name, "chicken burrito");
  assert.equal(matchFood("Bananas")?.name, "banana");
  assert.equal(matchFood("quinoa salad with feta and pomegranate"), null);
  assert.equal(matchFood(""), null);
});

test("fromTable scales per-100 g values to the portion", () => {
  assert.deepEqual(fromTable(matchFood("white rice"), 200), { kcal: 260, p: 5.4, c: 56, f: 0.6 });
});

test("extractJson reads a fenced block or an object inside prose, and returns null for neither", () => {
  assert.deepEqual(extractJson('```json\n{"items":[]}\n```'), { items: [] });
  assert.deepEqual(extractJson('Here you go: {"a":1} hope that helps'), { a: 1 });
  assert.equal(extractJson("no json here"), null);
});

test("cleanItem clamps absurd numbers and rebuilds kcal that disagrees with the macros by more than 15%", () => {
  const off = cleanItem({ name: "pasta", grams: 300, kcal: 900, p: 17, c: 93, f: 3, confidence: "medium" });
  assert.equal(off.item.kcal, Math.round(4 * 17 + 4 * 93 + 9 * 3));
  assert.match(off.notes[0], /rebuilt/);
  const close = cleanItem({ name: "pasta", grams: 300, kcal: 470, p: 17, c: 93, f: 3, confidence: "medium" });
  assert.equal(close.item.kcal, 470);
  const absurd = cleanItem({ name: "cake", grams: 99999, kcal: 1e6, p: 9999, c: 1, f: 1, confidence: "weird" });
  assert.equal(absurd.item.grams, 3000);
  assert.ok(absurd.item.kcal <= 5000 && absurd.item.p <= 500);
  assert.equal(absurd.item.confidence, "low");
  assert.equal(cleanItem({ name: "", grams: 10 }), null);
  assert.equal(cleanItem({ name: "air", grams: 0 }), null);
});

test("validateEstimate recomputes totals from the items and refuses an answer with no food", () => {
  const v = validateEstimate(BOWL);
  assert.equal(v.ok, true);
  assert.equal(v.estimate.totals.kcal, 260 + 248 + 88);
  assert.equal(v.estimate.totals.grams, 360);
  assert.deepEqual(validateEstimate({ items: [], assumptions: ["no food found"] }).ok, false);
  assert.equal(validateEstimate("nope").ok, false);
});

test("grounding replaces the model's per-gram numbers where an item matches, and keeps its grams", () => {
  const wrong = validateEstimate({ items: [{ name: "chicken breast", grams: 150, kcal: 600, p: 90, c: 0, f: 26, confidence: "high" }], assumptions: [] }).estimate;
  const g = ground(wrong);
  assert.equal(g.items[0].grams, 150);
  assert.equal(g.items[0].kcal, 248);
  assert.equal(g.items[0].grounded, "chicken breast, cooked");
  assert.equal(g.totals.kcal, 248);
});

test("the summary line reads like the brief's example", () => {
  const e = ground(validateEstimate(BOWL).estimate);
  assert.equal(summaryLine(e), "~600 kcal · 52P 56C 16F (white rice, grilled chicken breast and olive oil, ~360 g; guessed the oil)");
});

test("askModel sends the photos as base64 to /api/chat on the resident 9b with a JSON schema", async () => {
  const seen = [];
  const r = await askModel({ text: "lunch", images: ["QUJD"] }, { fetchImpl: fakeFetch(BOWL, { seen }), url: "http://fake" });
  assert.equal(r.ok, true);
  assert.equal(seen[0].url, "http://fake/api/chat");
  assert.equal(seen[0].body.model, "qwen3.5:9b");
  assert.equal(seen[0].body.options.num_ctx, 32768);
  assert.deepEqual(seen[0].body.messages[1].images, ["QUJD"]);
  assert.equal(seen[0].body.format.type, "object");
  assert.equal(seen[0].body.stream, false);
});

test("askModel fails cleanly: a timeout, Ollama down and a bad status are each one sentence", async () => {
  const hang = (_u, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const slow = await askModel({ text: "x" }, { fetchImpl: hang, timeoutMs: 30, url: "http://fake" });
  assert.equal(slow.ok, false); assert.match(slow.error, /longer than/);
  const down = await askModel({ text: "x" }, { fetchImpl: async () => { throw new TypeError("fetch failed"); }, url: "http://fake" });
  assert.match(down.error, /isn't reachable/);
  const bad = await askModel({ text: "x" }, { fetchImpl: fakeFetch("", { status: 500 }), url: "http://fake" });
  assert.match(bad.error, /500/);
});

test("estimateMeal: nothing to estimate, a non-JSON answer and a good answer", async () => {
  assert.equal((await estimateMeal({})).ok, false);
  const prose = await estimateMeal({ text: "lunch" }, { fetchImpl: fakeFetch("I think about 600 calories"), url: "http://fake" });
  assert.match(prose.error, /wasn't JSON/);
  const good = await estimateMeal({ text: "chicken rice bowl", imagePaths: ["/x/p.jpg"] }, { fetchImpl: fakeFetch(BOWL), url: "http://fake" });
  assert.equal(good.ok, true);
  assert.match(good.summary, /^~600 kcal · 52P 56C 16F/);
  assert.deepEqual(good.estimate.input.photos, ["/x/p.jpg"]);
});

// ---- the CLI, against a fake Ollama over HTTP ----
import { createServer } from "node:http";
import { execFile } from "node:child_process";
const SCRIPT = join(here, "..", "scripts", "orion-food-estimate");

async function fakeOllama(answer) {
  const bodies = [];
  const server = createServer((req, res) => {
    let raw = ""; req.on("data", (d) => { raw += d; });
    req.on("end", () => { bodies.push(JSON.parse(raw || "{}")); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ message: { content: JSON.stringify(typeof answer === "function" ? answer(bodies.at(-1)) : answer) } })); });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, bodies, close: () => new Promise((r) => server.close(r)) };
}

function stateDir() {
  const dir = mkdtempSync(join(tmpdir(), "food-"));
  writeFileSync(join(dir, "health-log.json"), JSON.stringify({ schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [], nutritionLog: {}, days: {} }));
  return dir;
}
const run = (args, env) => new Promise((resolve) => execFile(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ORION_EVAL_MARKER: join(env.ORION_CONTROLLED_DIR, "eval-mode"), ...env }, timeout: 20000 }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout: stdout.trim(), stderr: stderr.trim() })));
const healthLog = (dir) => JSON.parse(readFileSync(join(dir, "health-log.json"), "utf8"));

test("CLI: --text prints the one-line summary; --json carries the estimate", async () => {
  const o = await fakeOllama(BOWL); const dir = stateDir();
  try {
    const env = { ORION_OLLAMA_URL: o.url, ORION_CONTROLLED_DIR: dir, ORION_NOW: "2026-11-02T13:00:00Z" };
    const plain = await run(["--text", "chicken rice bowl"], env);
    assert.equal(plain.code, 0);
    assert.match(plain.stdout, /^~600 kcal · 52P 56C 16F \(.*guessed the oil\)$/);
    const j = JSON.parse((await run(["--text", "chicken rice bowl", "--json"], env)).stdout);
    assert.equal(j.estimate.items.length, 3);
    assert.equal(healthLog(dir).nutritionLog["2026-11-02"], undefined, "no --log, nothing written");
  } finally { await o.close(); }
});

test("CLI: --image sends the photo as base64; a missing photo fails in one sentence", async () => {
  const o = await fakeOllama(BOWL); const dir = stateDir();
  try {
    const env = { ORION_OLLAMA_URL: o.url, ORION_CONTROLLED_DIR: dir };
    const ok = await run(["--image", join(fixtures, "meal-001.jpg"), "--json"], env);
    assert.equal(ok.code, 0);
    assert.equal(o.bodies[0].messages[1].images[0], readFileSync(join(fixtures, "meal-001.jpg")).toString("base64"));
    const missing = await run(["--image", join(dir, "nope.jpg")], env);
    assert.equal(missing.code, 1);
    assert.match(missing.stdout, /^Couldn't estimate that: I can't find the photo/);
  } finally { await o.close(); }
});

test("CLI: Ollama not running is a clean failure, exit 1", async () => {
  const dir = stateDir();
  const r = await run(["--text", "toast"], { ORION_OLLAMA_URL: "http://127.0.0.1:9", ORION_CONTROLLED_DIR: dir });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /isn't reachable/);
});

test("CLI: --log appends an estimate entry (integers, source, confidence, FOOD- id) and undo removes it", async () => {
  const o = await fakeOllama(BOWL); const dir = stateDir();
  try {
    const env = { ORION_OLLAMA_URL: o.url, ORION_CONTROLLED_DIR: dir, ORION_NOW: "2026-11-02T13:00:00Z" };
    const j = JSON.parse((await run(["--text", "chicken rice bowl", "--image", join(fixtures, "meal-001.jpg"), "--meal", "lunch", "--log", "--json"], env)).stdout);
    const rows = healthLog(dir).nutritionLog["2026-11-02"];
    assert.equal(rows.length, 1);
    const e = rows[0];
    assert.match(e.id, /^FOOD-[0-9A-F-]{36}$/);
    assert.equal(j.logged.id, e.id);
    assert.equal(e.meal, "Lunch"); assert.equal(e.source, "estimate"); assert.equal(e.confidence, "high");
    assert.equal(e.calories, 596); assert.equal(e.protein, 52); assert.ok(Number.isInteger(e.fat) && Number.isInteger(e.carbohydrates));
    assert.equal(e.photo, join(fixtures, "meal-001.jpg"));
    assert.equal(healthLog(dir).days["2026-11-02"].calories, 596);
    const undone = await run(["undo", e.id], env);
    assert.equal(undone.code, 0);
    assert.equal(healthLog(dir).nutritionLog["2026-11-02"].length, 0);
    assert.equal(healthLog(dir).days["2026-11-02"].calories, 0);
    assert.equal((await run(["undo", "not-a-food-id"], env)).code, 1);
  } finally { await o.close(); }
});

test("CLI: nothing is logged during an evaluation", async () => {
  const o = await fakeOllama(BOWL); const dir = stateDir();
  try {
    writeFileSync(join(dir, "eval-mode"), "");
    const r = await run(["--text", "chicken rice bowl", "--log"], { ORION_OLLAMA_URL: o.url, ORION_CONTROLLED_DIR: dir });
    assert.match(r.stdout, /Not logged: I am in an evaluation run/);
    assert.equal(healthLog(dir).nutritionLog["2026-11-02"], undefined);
  } finally { await o.close(); }
});

test("CLI: --offer leaves a pending estimate; --revise re-asks with his correction; log-pending logs it once", async () => {
  const small = { ...BOWL, items: BOWL.items.map((i) => ({ ...i, grams: Math.round(i.grams / 2) })), assumptions: ["a small bowl"] };
  const o = await fakeOllama((body) => (/small one/.test(body.messages[1].content) ? small : BOWL)); const dir = stateDir();
  try {
    const env = { ORION_OLLAMA_URL: o.url, ORION_CONTROLLED_DIR: dir, ORION_NOW: "2026-11-02T13:00:00Z" };
    const offered = JSON.parse((await run(["--text", "chicken rice bowl", "--offer", "--json"], env)).stdout);
    assert.match(offered.offer.text, /Log it\?$/);
    const pending = JSON.parse(readFileSync(join(dir, "food-pending.json"), "utf8")).offers.at(-1);   // offers kept by id (food-pending.test.mjs)
    assert.equal(pending.via, "chat"); assert.equal(pending.text, "chicken rice bowl");
    const revised = JSON.parse((await run(["--revise", "it was a small one", "--json"], env)).stdout);
    assert.match(o.bodies.at(-1).messages[1].content, /He corrected it: "it was a small one"/);
    assert.match(revised.summary, /a small bowl/);
    const logged = await run(["log-pending"], env);
    assert.equal(logged.code, 0);
    assert.match(logged.stdout, /^Logged the .*, ~298 kcal \(lunch · /);
    assert.equal(existsSync(join(dir, "food-pending.json")), false);
    assert.equal((await run(["log-pending"], env)).code, 1, "a second yes logs nothing");
    assert.equal(healthLog(dir).nutritionLog["2026-11-02"].length, 1);
  } finally { await o.close(); }
});

test("CLI: a pending offer expires (30 min from chat)", async () => {
  const o = await fakeOllama(BOWL); const dir = stateDir();
  try {
    await run(["--text", "toast", "--offer"], { ORION_OLLAMA_URL: o.url, ORION_CONTROLLED_DIR: dir, ORION_NOW: "2026-11-02T13:00:00Z" });
    const late = await run(["log-pending"], { ORION_OLLAMA_URL: o.url, ORION_CONTROLLED_DIR: dir, ORION_NOW: "2026-11-02T13:31:00Z" });
    assert.equal(late.code, 1);
  } finally { await o.close(); }
});

test("CLI: --entry latest sizes a meal logged from chat with 0 kcal, and log-pending fills that entry instead of adding one", async () => {
  const o = await fakeOllama({ items: [{ name: "chicken burrito", grams: 400, kcal: 740, p: 38, c: 88, f: 26, confidence: "medium" }, { name: "coke", grams: 330, kcal: 139, p: 0, c: 35, f: 0, confidence: "high" }], assumptions: ["assumed a regular can"] });
  const dir = stateDir();
  try {
    const log = healthLog(dir);
    writeFileSync(join(dir, "health-log.json"), JSON.stringify({ ...log, nutritionLog: { "2026-11-02": [{ id: "abc-1", title: "Chicken burrito and a coke", meal: "Lunch", calories: 0, protein: 0, carbohydrates: 0, fat: 0, fiber: 0, notes: "", loggedAt: "2026-11-02T12:30:00.000Z" }] } }));
    const env = { ORION_OLLAMA_URL: o.url, ORION_CONTROLLED_DIR: dir, ORION_NOW: "2026-11-02T13:00:00Z" };
    const j = JSON.parse((await run(["--entry", "latest", "--offer", "--json"], env)).stdout);
    assert.equal(j.entry.id, "abc-1");
    assert.match(j.offer.text, /Add those numbers to your lunch\?$/);
    assert.match(o.bodies[0].messages[1].content, /Chicken burrito and a coke/);
    const revised = JSON.parse((await run(["--revise", "it was a small one", "--json"], env)).stdout);
    assert.match(revised.offer.text, /Add those numbers to your lunch\?$/);
    const filled = await run(["log-pending"], env);
    assert.match(filled.stdout, /^Updated the chicken burrito and coke, ~879 kcal \(lunch · /);
    const rows = healthLog(dir).nutritionLog["2026-11-02"];
    assert.equal(rows.length, 1); assert.equal(rows[0].id, "abc-1"); assert.equal(rows[0].calories, 879); assert.equal(rows[0].loggedAt, "2026-11-02T12:30:00Z");
  } finally { await o.close(); }
});

test("CLI: inbox estimates the fixture item once, writes its result, offers it in chat and leaves it pending", async () => {
  const o = await fakeOllama(BOWL); const dir = stateDir();
  try {
    mkdirSync(join(dir, "food-inbox"));
    cpSync(join(fixtures, "meal-001.jpg"), join(dir, "food-inbox", "meal-001.jpg"));
    cpSync(join(fixtures, "meal-001.json"), join(dir, "food-inbox", "meal-001.json"));
    writeFileSync(join(dir, "food-inbox", "half-001.jpg"), "");   // a photo whose .json has not landed yet: not complete, not read
    const sent = join(dir, "reach.log");
    const reach = join(dir, "fake-reach.mjs");
    writeFileSync(reach, `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(sent)}, JSON.stringify(process.argv.slice(2)) + "\\n");`);
    const env = { ORION_OLLAMA_URL: o.url, ORION_CONTROLLED_DIR: dir, ORION_NOW: "2026-11-02T13:00:00Z", ORION_REACH_BIN: reach };
    const first = JSON.parse((await run(["inbox", "--json"], env)).stdout);
    assert.equal(first.items.length, 1);
    assert.equal(first.items[0].notified, true);
    const args = JSON.parse(readFileSync(sent, "utf8").trim());
    assert.match(args[0], /^Logged ~600 kcal — white rice, grilled chicken breast, olive oil: 52P 56C 16F\. Fix anything\?$/);
    assert.deepEqual(args.slice(1), ["--kind", "question", "--why", "food: meal-001"]);
    assert.match(o.bodies[0].messages[1].content, /chicken rice bowl from the canteen/);
    assert.equal(o.bodies[0].messages[1].images.length, 1);
    const result = JSON.parse(readFileSync(join(dir, "food-inbox", "meal-001.estimate.json"), "utf8"));
    assert.equal(result.ok, true);
    const pending = JSON.parse(readFileSync(join(dir, "food-pending.json"), "utf8")).offers.at(-1);   // offers kept by id (food-pending.test.mjs)
    assert.equal(pending.via, "inbox"); assert.equal(pending.inboxId, "meal-001"); assert.equal(pending.eatenAt, "2026-11-02T12:40:00.000Z");
    const again = JSON.parse((await run(["inbox", "--json"], env)).stdout);
    assert.equal(again.items.length, 0, "each item is estimated once");
    // already logged, at the time the photo was taken; two hours on the correction window is closed and a late yes adds nothing
    const late = await run(["log-pending"], { ...env, ORION_NOW: "2026-11-02T15:00:00Z" });
    assert.equal(late.code, 1);
    assert.equal(healthLog(dir).nutritionLog["2026-11-02"].length, 1);
    const row = healthLog(dir).nutritionLog["2026-11-02"][0];
    assert.equal(row.loggedAt, "2026-11-02T12:40:00Z"); assert.match(row.photo, /meal-001\.jpg$/);
  } finally { await o.close(); }
});

test("CLI: inbox does nothing during an evaluation or without an inbox", async () => {
  const dir = stateDir();
  const none = JSON.parse((await run(["inbox", "--json"], { ORION_CONTROLLED_DIR: dir, ORION_OLLAMA_URL: "http://127.0.0.1:9" })).stdout);
  assert.equal(none.ran, false);
  mkdirSync(join(dir, "food-inbox")); writeFileSync(join(dir, "eval-mode"), "");
  const evalRun = JSON.parse((await run(["inbox", "--json"], { ORION_CONTROLLED_DIR: dir, ORION_OLLAMA_URL: "http://127.0.0.1:9" })).stdout);
  assert.equal(evalRun.why, "evaluation");
});

test("CLI: usage errors exit 2", async () => {
  const dir = stateDir();
  assert.equal((await run([], { ORION_CONTROLLED_DIR: dir })).code, 2);
  assert.equal((await run(["--text", "x", "--meal", "elevenses"], { ORION_CONTROLLED_DIR: dir })).code, 2);
});

test("the summary counts repeated items and keeps the assumption short", () => {
  const e = validateEstimate({ items: [
    { name: "Pepperoni pizza slice", grams: 105, kcal: 313, p: 13, c: 33, f: 14, confidence: "high" },
    { name: "pepperoni pizza slice", grams: 105, kcal: 313, p: 13, c: 33, f: 14, confidence: "high" },
  ], assumptions: ["Assumed standard restaurant slice size (~105g)."] }).estimate;
  assert.equal(summaryLine(e), "~630 kcal · 26P 66C 28F (2× pepperoni pizza slice, ~210 g; assumed standard restaurant slice size)");
});

test("a long assumption is cut at its first clause, never mid-word", () => {
  const e = validateEstimate({ items: [{ name: "cheeseburger", grams: 250, kcal: 660, p: 38, c: 60, f: 30, confidence: "medium" }],
    assumptions: ["Cheeseburger assumed standard fast-food size with cheese, lettuce and tomato"] }).estimate;
  assert.match(summaryLine(e), /; cheeseburger assumed standard fast-food size with cheese\)$/);
  const long = validateEstimate({ items: [{ name: "x", grams: 100, kcal: 100, p: 5, c: 15, f: 2, confidence: "low" }],
    assumptions: ["assumed a very large restaurant portion that was shared between several people at the table"] }).estimate;
  assert.match(summaryLine(long), /; assumed a very large restaurant portion that was shared…\)$/);
});

import { kickFoodInbox } from "../scripts/lib/food/tick.mjs";
test("the tick hook starts a detached inbox run only when a complete, new item is waiting", () => {
  const dir = stateDir();
  const calls = [];
  const spawnImpl = (cmd, args, opts) => { calls.push({ args, opts }); return { unref() {} }; };
  const env = { ...process.env, ORION_CONTROLLED_DIR: dir };
  assert.equal(kickFoodInbox({ env, spawnImpl }), false, "no inbox");
  mkdirSync(join(dir, "food-inbox"));
  writeFileSync(join(dir, "food-inbox", "a.jpg"), "");
  assert.equal(kickFoodInbox({ env, spawnImpl }), false, "a photo without its .json is not complete");
  cpSync(join(fixtures, "meal-001.json"), join(dir, "food-inbox", "meal-001.json"));
  assert.equal(kickFoodInbox({ env, spawnImpl }), true);
  assert.equal(calls[0].args.at(-1), "inbox");
  assert.equal(calls[0].opts.detached, true);
  writeFileSync(join(dir, "food-inbox", ".state.json"), JSON.stringify({ done: { "meal-001": { ok: true } } }));
  assert.equal(kickFoodInbox({ env, spawnImpl }), false, "already estimated");
});

test("CLI: discard drops the offer, so a later yes logs nothing", async () => {
  const o = await fakeOllama(BOWL); const dir = stateDir();
  try {
    const env = { ORION_OLLAMA_URL: o.url, ORION_CONTROLLED_DIR: dir, ORION_NOW: "2026-11-02T13:00:00Z" };
    await run(["--text", "toast", "--offer"], env);
    assert.equal((await run(["discard"], env)).stdout, "Okay, not logged.");
    assert.equal((await run(["log-pending"], env)).code, 1);
  } finally { await o.close(); }
});
