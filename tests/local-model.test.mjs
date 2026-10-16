// 2026-10-16: small local work shares the resident qwen3.5:9b (one load, num_ctx 32768, kept 24h, thinking off);
// the big gpt-oss:20b is loaded only for heavy offline work, unloaded right after, and only while Nick is away.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RESIDENT_MODEL, HEAVY_MODEL, residentOptions, heavyOptions, nickIsAway } from "../scripts/lib/local-model.mjs";

const script = (name) => readFileSync(join(import.meta.dirname, "../scripts", name), "utf8");

test("the resident request keeps the model loaded at one context size", () => {
  assert.deepEqual(residentOptions({ temperature: 0.2 }), { model: "qwen3.5:9b", think: false, keep_alive: "24h", options: { temperature: 0.2, num_ctx: 32768 } });
  assert.equal(RESIDENT_MODEL, "qwen3.5:9b");
});

test("the heavy request unloads at once", () => {
  assert.deepEqual(heavyOptions(), { model: HEAVY_MODEL, keep_alive: 0, options: {} });
  assert.equal(HEAVY_MODEL, "gpt-oss:20b");
});

test("standing polish and the focus judge use the resident model; learn --judge and orion-code stay heavy and unload", () => {
  assert.match(script("orion-standing"), /\.\.\.residentOptions\(/);
  assert.doesNotMatch(script("orion-standing"), /model: "gpt-oss/);
  assert.match(script("orion-focus"), /\.\.\.residentOptions\(\)/);
  assert.doesNotMatch(script("orion-focus"), /gpt-oss:20b"/);
  assert.match(script("orion-learn"), /\.\.\.heavyOptions\(\)/);
  assert.match(script("orion-code"), /"keep_alive": 0/);
});

test("nickIsAway: idle, locked, display asleep or the small hours; at the Mac by day is not", () => {
  const day = new Date(2026, 9, 16, 14, 0), night = new Date(2026, 9, 16, 3, 0);
  const env = (facts) => ({ ORION_REACH_FACTS: JSON.stringify(facts) });
  assert.equal(nickIsAway({ now: day, env: env({ idleSeconds: 5, locked: false }) }), false);
  assert.equal(nickIsAway({ now: day, env: env({ idleSeconds: 900, locked: false }) }), true);
  assert.equal(nickIsAway({ now: day, env: env({ idleSeconds: 5, locked: true }) }), true);
  assert.equal(nickIsAway({ now: day, env: env({ idleSeconds: 5, displayAsleep: true }) }), true);
  assert.equal(nickIsAway({ now: night, env: env({ idleSeconds: 5, locked: false }) }), true);
});
