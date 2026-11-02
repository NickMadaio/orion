// Food offers after review (wave 14 fix, 2026-11-02): no pending write during an evaluation, offers kept by id so three phone photos
// do not overwrite each other, a "yes" that names what it logged (or asks which when several wait), and an undo that puts a filled
// meal back the way it was. Against a fake Ollama; no live state.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { execFile } from "node:child_process";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "orion-food-estimate");
const FOODS = {
  burger: { items: [{ name: "cheeseburger", grams: 300, kcal: 850, p: 45, c: 55, f: 50, confidence: "medium" }, { name: "fries", grams: 110, kcal: 340, p: 4, c: 44, f: 17, confidence: "medium" }], assumptions: ["a restaurant burger"] },
  salad: { items: [{ name: "caesar salad", grams: 250, kcal: 400, p: 12, c: 18, f: 31, confidence: "medium" }], assumptions: ["with dressing"] },
  pasta: { items: [{ name: "pasta bolognese", grams: 400, kcal: 640, p: 30, c: 80, f: 22, confidence: "medium" }], assumptions: ["a big bowl"] },
};

async function fakeOllama() {
  const server = createServer((req, res) => {
    let raw = ""; req.on("data", (d) => { raw += d; });
    req.on("end", () => {
      const content = (JSON.parse(raw || "{}").messages?.[1]?.content ?? "").toLowerCase();
      const key = Object.keys(FOODS).find((k) => content.includes(k)) ?? "salad";
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ message: { content: JSON.stringify(FOODS[key]) } }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

function stateDir() {
  const dir = mkdtempSync(join(tmpdir(), "food-pending-"));
  writeFileSync(join(dir, "health-log.json"), JSON.stringify({ schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [], nutritionLog: {}, days: {} }));
  return dir;
}
const run = (args, env) => new Promise((resolve) => execFile(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ORION_EVAL_MARKER: join(env.ORION_CONTROLLED_DIR, "eval-mode"), ...env }, timeout: 20000 },
  (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout: stdout.trim(), stderr: stderr.trim() })));
const healthLog = (dir) => JSON.parse(readFileSync(join(dir, "health-log.json"), "utf8"));
const NOW = "2026-11-02T13:00:00Z";

test("during an evaluation --offer and --revise never write food-pending.json", async () => {
  const o = await fakeOllama(); const dir = stateDir();
  try {
    const env = { ORION_OLLAMA_URL: o.url, ORION_CONTROLLED_DIR: dir, ORION_NOW: NOW };
    writeFileSync(join(dir, "eval-mode"), "");
    const offered = await run(["--text", "burger", "--offer", "--json"], env);
    assert.equal(offered.code, 0, offered.stderr);
    assert.equal(existsSync(join(dir, "food-pending.json")), false, "no offer written in an evaluation");
    assert.match(JSON.parse(offered.stdout).offer?.note ?? "", /evaluation/);
    // an offer left from before the evaluation is not rewritten by a revise inside it
    const before = JSON.stringify({ offers: [{ id: "fp-old", at: NOW, expiresAt: "2026-11-02T13:30:00Z", via: "chat", offerText: "x. Log it?", summary: "x", text: "salad", estimate: { items: FOODS.salad.items, totals: { kcal: 400, p: 12, c: 18, f: 31 }, assumptions: [], confidence: "medium" } }] });
    writeFileSync(join(dir, "food-pending.json"), before);
    const revised = await run(["--revise", "it was a small one", "--json"], env);
    assert.equal(revised.code, 0, revised.stdout + revised.stderr);
    assert.equal(readFileSync(join(dir, "food-pending.json"), "utf8"), before);
  } finally { await o.close(); }
});

test("three phone photos leave three offers; a bare yes lists them and asks; naming one logs it and says which", async () => {
  const o = await fakeOllama(); const dir = stateDir();
  try {
    mkdirSync(join(dir, "food-inbox"));
    for (const [i, food] of ["burger", "salad", "pasta"].entries()) {
      writeFileSync(join(dir, "food-inbox", `m${i}.json`), JSON.stringify({ id: `m${i}`, at: `2026-11-02T12:4${i}:00Z`, note: food }));
    }
    const reach = join(dir, "fake-reach.mjs"); writeFileSync(reach, "");
    const env = { ORION_OLLAMA_URL: o.url, ORION_CONTROLLED_DIR: dir, ORION_NOW: NOW, ORION_REACH_BIN: reach };
    assert.equal(JSON.parse((await run(["inbox", "--json"], env)).stdout).items.length, 3);
    const offers = JSON.parse(readFileSync(join(dir, "food-pending.json"), "utf8")).offers;
    assert.deepEqual(offers.map((x) => x.inboxId), ["m0", "m1", "m2"], "kept by id, none overwritten");
    assert.equal(new Set(offers.map((x) => x.id)).size, 3);

    const yes = JSON.parse((await run(["log-pending", "--json"], env)).stdout);
    assert.equal(yes.ok, true);
    assert.equal(yes.choose.length, 3);
    assert.match(yes.say, /^You have 3 estimates waiting: the cheeseburger and fries \(~1138 kcal\), the caesar salad \(~318 kcal\) and the pasta bolognese \(~540 kcal\)\. Which should I log\?/);
    assert.equal(healthLog(dir).nutritionLog["2026-11-02"], undefined, "nothing logged on an ambiguous yes");

    const picked = JSON.parse((await run(["log-pending", "--pick", "the burger", "--json"], env)).stdout);
    assert.match(picked.say, /^Logged the cheeseburger and fries, ~1138 kcal/);
    assert.equal(healthLog(dir).nutritionLog["2026-11-02"].length, 1);
    assert.equal(JSON.parse(readFileSync(join(dir, "food-pending.json"), "utf8")).offers.length, 2);

    const both = JSON.parse((await run(["log-pending", "--pick", "both", "--json"], env)).stdout);
    assert.match(both.say, /^Logged the caesar salad \(~318 kcal\) and the pasta bolognese \(~540 kcal\)\./);
    assert.equal(healthLog(dir).nutritionLog["2026-11-02"].length, 3);
    assert.equal((await run(["log-pending", "--json"], env)).code, 1, "nothing left to log");
  } finally { await o.close(); }
});

test("with one offer waiting, a bare yes logs it and names it", async () => {
  const o = await fakeOllama(); const dir = stateDir();
  try {
    const env = { ORION_OLLAMA_URL: o.url, ORION_CONTROLLED_DIR: dir, ORION_NOW: NOW };
    await run(["--text", "burger", "--offer"], env);
    const yes = JSON.parse((await run(["log-pending", "--json"], env)).stdout);
    assert.match(yes.say, /^Logged the cheeseburger and fries, ~1138 kcal \(lunch · 49P 117C 54F\)\. 1138 kcal today\.$/);
    assert.equal(yes.logged.id, healthLog(dir).nutritionLog["2026-11-02"][0].id);
  } finally { await o.close(); }
});

test("a new chat offer does not erase a waiting photo offer; revise changes only the newest", async () => {
  const o = await fakeOllama(); const dir = stateDir();
  try {
    const env = { ORION_OLLAMA_URL: o.url, ORION_CONTROLLED_DIR: dir, ORION_NOW: NOW };
    await run(["--text", "pasta", "--offer"], env);
    await run(["--text", "salad", "--offer"], env);
    await run(["--revise", "it was a small one", "--json"], env);
    const offers = JSON.parse(readFileSync(join(dir, "food-pending.json"), "utf8")).offers;
    assert.equal(offers.length, 2);
    assert.equal(offers[0].text, "pasta");
    assert.match(offers[1].text, /salad \(it was a small one\)/);
  } finally { await o.close(); }
});

test("undo after a yes that filled an existing meal puts the meal back as it was", async () => {
  const o = await fakeOllama(); const dir = stateDir();
  try {
    const original = { id: "abc-1", title: "Burger and fries", meal: "Lunch", calories: 0, protein: 0, carbohydrates: 0, fat: 0, fiber: 0, notes: "from chat", loggedAt: "2026-11-02T12:30:00Z" };
    writeFileSync(join(dir, "health-log.json"), JSON.stringify({ ...healthLog(dir), nutritionLog: { "2026-11-02": [original, { id: "other", title: "Coffee", meal: "Breakfast", calories: 5, loggedAt: "2026-11-02T08:00:00Z" }] } }));
    const env = { ORION_OLLAMA_URL: o.url, ORION_CONTROLLED_DIR: dir, ORION_NOW: NOW };
    await run(["--entry", "abc-1", "--offer"], env);
    const filled = JSON.parse((await run(["log-pending", "--json"], env)).stdout);
    assert.equal(filled.logged.filled, true);
    assert.equal(healthLog(dir).nutritionLog["2026-11-02"][0].calories, 1138);
    const undone = JSON.parse((await run(["undo", "abc-1", "--json"], env)).stdout);
    assert.equal(undone.ok, true);
    assert.equal(undone.restored, true);
    const rows = healthLog(dir).nutritionLog["2026-11-02"];
    assert.equal(rows.length, 2, "the meal is kept, not deleted");
    assert.deepEqual(rows[0], original);
    assert.equal(healthLog(dir).days["2026-11-02"].calories, 5);
    assert.equal((await run(["undo", "abc-1"], env)).code, 1, "a second undo has nothing to restore and refuses a meal it did not write");
  } finally { await o.close(); }
});
