// Phone photo to health log, end to end with a stubbed model: a real JPEG (a BBQ chicken pizza) dropped into a temp
// inbox the way ORION Link writes it, run through runInbox, offered to Nick, logged by his yes, in the shape the Health tab reads.
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInbox } from "../scripts/lib/food/inbox.mjs";
import { estimateMeal } from "../scripts/lib/food/estimate.mjs";
import { livePending, claimPending } from "../scripts/lib/food/pending.mjs";
import { logEstimate } from "../scripts/lib/food/log.mjs";

const photo = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "food-inbox", "pizza-photo.jpg");
const MODEL = { items: [
  { name: "pizza slice", grams: 150, kcal: 399, p: 16.5, c: 49.5, f: 15, confidence: "medium" },
  { name: "chicken topping", grams: 40, kcal: 66, p: 12.4, c: 0, f: 1.4, confidence: "high" },
], assumptions: ["estimated the slice weight"] };

const NOW = new Date("2026-11-03T18:30:00Z");
const reply = (content) => async (_url, init) => ({ ok: true, status: 200, json: async () => ({ message: { content }, init }) });
const stubbedModel = (seen) => (input) => estimateMeal(input, {
  fetchImpl: async (url, init) => { seen.push(JSON.parse(init.body)); return reply("```json\n" + JSON.stringify(MODEL) + "\n```")(url, init); },
});

function inboxWith(id, note) {
  const dir = mkdtempSync(join(tmpdir(), "food-pipe-"));
  mkdirSync(join(dir, "food-inbox"));
  cpSync(photo, join(dir, "food-inbox", `${id}.jpg`));
  writeFileSync(join(dir, "food-inbox", `${id}.json`), JSON.stringify({ id, at: "2026-11-03T18:20:00Z", note }));
  return dir;
}

test("a real JPEG in the inbox is sent to the model as base64, offered, and logged in the Health tab's shape", async () => {
  const dir = inboxWith("p-1", "just one slice");
  const env = { ORION_CONTROLLED_DIR: dir };
  const seen = [], told = [];
  const out = await runInbox({ now: NOW, env, estimate: stubbedModel(seen), notify: (text) => { told.push(text); return { ok: true }; } });

  assert.equal(out.items.length, 1); assert.equal(out.items[0].ok, true);
  const sent = seen[0].messages[1];
  assert.equal(sent.images.length, 1);
  assert.deepEqual(Buffer.from(sent.images[0], "base64"), readFileSync(photo), "the model gets the exact JPEG bytes");
  assert.match(sent.content, /just one slice/);
  assert.match(told[0], /^Food photo: ~\d+ kcal · \d+P \d+C \d+F .*Log it\?$/);

  const [offer] = claimPending(livePending({ now: NOW, env }).map((o) => o.id), { now: NOW, env });
  const logged = logEstimate(offer.estimate, { meal: offer.meal, at: new Date(offer.eatenAt), now: NOW, env });
  assert.equal(logged.ok, true);
  const log = JSON.parse(readFileSync(join(dir, "health-log.json"), "utf8"));
  const [entry] = log.nutritionLog["2026-11-03"];
  for (const key of ["id", "title", "meal", "calories", "protein", "carbohydrates", "fat", "fiber", "notes", "loggedAt"]) assert.ok(key in entry, key);
  assert.match(entry.id, /^FOOD-/);
  for (const key of ["calories", "protein", "carbohydrates", "fat", "fiber"]) assert.ok(Number.isInteger(entry[key]), `${key} is an integer`);
  assert.equal(entry.meal, "Dinner");
  assert.equal(log.days["2026-11-03"].calories, entry.calories);
  assert.ok(entry.calories > 400 && entry.calories < 600);
});

test("a photo the model cannot read becomes a plain sentence to Nick, not a silent drop", async () => {
  const dir = inboxWith("p-2", "");
  const told = [];
  const out = await runInbox({ now: NOW, env: { ORION_CONTROLLED_DIR: dir }, notify: (t) => { told.push(t); return { ok: true }; },
    estimate: (input) => estimateMeal(input, { fetchImpl: reply("sorry, I can't tell") }) });
  assert.equal(out.items[0].ok, false);
  assert.match(told[0], /couldn't estimate the food photo/);
});
