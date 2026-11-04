// A nutrition question answers only the question, then offers to log; nothing is logged until he says yes.
// A photo sent alone (or with "log this") still logs at once; a photo that comes with a question follows the question flow.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { answerLine, focusOf, isFoodQuestion } from "../scripts/lib/food/question.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, "..", "scripts", "orion-food-estimate");
const PHOTO = join(here, "fixtures", "food-inbox", "pizza-photo.jpg");
const BAR = { items: [{ name: "protein bar", grams: 40, kcal: 190, p: 20, c: 23, f: 8, confidence: "high" }], assumptions: ["one bar"] };
const BOWL = { items: [{ name: "chipotle bowl", grams: 600, kcal: 650, p: 42, c: 70, f: 18, confidence: "medium" }], assumptions: ["standard bowl"] };

const est = (items) => ({ items, totals: { kcal: items.reduce((a, i) => a + i.kcal, 0), p: items.reduce((a, i) => a + i.p, 0), c: items.reduce((a, i) => a + i.c, 0), f: items.reduce((a, i) => a + i.f, 0) } });

test("question and focus detection, in his casual phrasing", () => {
  for (const q of ["how much protein is a nature valley protein bar", "how much protien is in this", "hwo much protein in this?", "how many calories in a chipotle bowl", "how many cals is this", "is this high protein", "is a chipotle bowl high in protein?", "whats the protein in this lol"]) assert.ok(isFoodQuestion(q), q);
  for (const q of ["log this", "had this for lunch", "", "this was my lunch", "how many calories have i had today"]) assert.ok(!isFoodQuestion(q), q);
  assert.equal(focusOf("how much protien is in this"), "protein");
  assert.equal(focusOf("how many cals is this"), "calories");
  assert.equal(focusOf("macros for this"), "macros");
});

test("the answer leads with what he asked, then offers to log", () => {
  const e = est([{ name: "chipotle bowl", grams: 600, kcal: 650, p: 42, c: 70, f: 18 }]);
  assert.equal(answerLine(e, "protein", "how much protein is in this"), "About 42 g of protein (and ~650 kcal). Want me to log it?");
  assert.equal(answerLine(e, "calories", "how many calories in a bowl"), "About 650 kcal (42 g protein). Want me to log it?");
  assert.match(answerLine(e, "protein", "is this high protein"), /^Yes, about 42 g of protein, that's a lot\. Want me to log it\?$/);
  assert.match(answerLine(est([{ name: "x", grams: 10, kcal: 90, p: 3, c: 15, f: 1 }]), "protein", "is this high protein"), /^Not really, about 3 g of protein\. Want me to log it\?$/);
  assert.equal(answerLine(e, "macros", "macros for this"), "About 650 kcal: 42 g protein, 70 g carbs, 18 g fat. Want me to log it?");
  assert.doesNotMatch(answerLine(e, "protein", "q"), /\dP|\dF/);
});

async function fakeOllama(answers) {
  let n = 0;
  const server = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ message: { content: JSON.stringify(answers[Math.min(n++, answers.length - 1)]) } })); });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}
function setup(note) {
  const dir = mkdtempSync(join(tmpdir(), "food-q-"));
  writeFileSync(join(dir, "health-log.json"), JSON.stringify({ schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [], nutritionLog: {}, days: {} }));
  mkdirSync(join(dir, "food-inbox"));
  cpSync(PHOTO, join(dir, "food-inbox", "ph-1.jpg"));
  writeFileSync(join(dir, "food-inbox", "ph-1.json"), JSON.stringify({ id: "ph-1", at: "2026-11-03T18:20:00Z", note }));
  const sent = join(dir, "reach.log"), reach = join(dir, "fake-reach.mjs");
  writeFileSync(reach, `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(sent)}, JSON.stringify(process.argv.slice(2)) + "\\n");`);
  return { dir, sent, reach };
}
const run = (args, env) => new Promise((resolve) => execFile(process.execPath, [SCRIPT, ...args],
  { env: { ...process.env, ORION_EVAL_MARKER: join(env.ORION_CONTROLLED_DIR, "eval-mode"), ...env }, timeout: 20000 },
  (error, stdout) => resolve({ code: error?.code ?? 0, stdout: stdout.trim() })));
const rows = (dir) => Object.values(JSON.parse(readFileSync(join(dir, "health-log.json"), "utf8")).nutritionLog).flat();
const told = (s) => readFileSync(s.sent, "utf8").trim().split("\n").map((l) => JSON.parse(l)[0]);
const envOf = (s, o) => ({ ORION_OLLAMA_URL: o.url, ORION_CONTROLLED_DIR: s.dir, ORION_NOW: "2026-11-03T18:30:00Z", ORION_REACH_BIN: s.reach });
const pending = (dir) => JSON.parse(readFileSync(join(dir, "food-pending.json"), "utf8")).offers;

for (const note of ["how much protien is in this", "hwo many calories is this lol", "is this high protein"]) {
  test(`a phone photo with the question "${note}" is answered, not logged; a yes logs it`, async () => {
    const o = await fakeOllama([BOWL]); const s = setup(note);
    try {
      const env = envOf(s, o);
      await run(["inbox", "--json"], env);
      assert.equal(rows(s.dir).length, 0, "nothing logged for a question");
      const [offer] = pending(s.dir);
      assert.equal(offer.logged, undefined);
      assert.match(told(s)[0], /Want me to log it\?$/);
      assert.match(told(s)[0], /42 g of protein|650 kcal/);
      assert.equal(told(s)[0], offer.offerText);
      const yes = await run(["log-pending", "--json"], env);
      assert.equal(JSON.parse(yes.stdout).ok, true);
      assert.equal(rows(s.dir).length, 1);
    } finally { await o.close(); }
  });
}

for (const note of ["", "log this", "had this for lunch"]) {
  test(`a phone photo with ${JSON.stringify(note)} still logs at once`, async () => {
    const o = await fakeOllama([BAR]); const s = setup(note);
    try {
      await run(["inbox", "--json"], envOf(s, o));
      assert.equal(rows(s.dir).length, 1);
      assert.match(told(s)[0], /Fix anything\?$/);
    } finally { await o.close(); }
  });
}

test("a typed question over the CLI answers first and keeps the offer for a yes", async () => {
  const o = await fakeOllama([BOWL]); const s = setup("");
  try {
    const env = envOf(s, o);
    const r = await run(["--text", "chipotle bowl", "--ask", "how much protein is in a chipotle bowl", "--offer", "--json"], env);
    const j = JSON.parse(r.stdout);
    assert.equal(j.offer.text, "About 42 g of protein (and ~650 kcal). Want me to log it?");
    assert.equal(rows(s.dir).length, 0);
    assert.equal(pending(s.dir)[0].offerText, j.offer.text);
  } finally { await o.close(); }
});
