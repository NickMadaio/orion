// V3 prompt composition (handoff §7.1): one change at a time from a config,
// examples only from practice cases, rules restated last when asked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderFrontDesk, schemaFor, pickExamples } from "../scripts/lib/eval/v3/prompts.mjs";

const menu = { tools: [{ name: "lights", does: "LED strip", args: { do: "on|off" } }, { name: "weather", does: "weather", args: {} }] };
const templates = { p0: "Front desk.\nTools:\n{{tools}}", p2: "Decide in this order.\nTools:\n{{tools}}" };
const kase = (id, moves, say, extra = {}) => ({ id, job: "J1", say, history: [], expect: { J1: { moves, tiers: extra.tiers ?? [], tools: extra.tools ?? [], args: extra.args ?? null } } });
const pool = [kase("a", ["tool"], "lights off", { tools: ["lights"], args: "(?i)off" }), kase("b", ["escalate"], "redo my day", { tiers: ["deep"] }),
  kase("c", ["ignore"], "yeah mom see you at seven"), kase("d", ["answer"], "what time is it"), kase("e", ["ask"], "do the thing"), kase("f", ["tool"], "rain later?", { tools: ["weather"] })];

test("the base template and tools are rendered; nothing else by default", () => {
  const p = renderFrontDesk({ style: "p0" }, { templates, menu, examplesPool: pool });
  assert.match(p, /^Front desk\./);
  assert.match(p, /- lights: LED strip/);
  assert.doesNotMatch(p, /Examples|<rules>/);
});

test("examples come from the pool, cover different moves, and are deterministic", () => {
  const ex = pickExamples(pool, 4, 7);
  assert.equal(ex.length, 4);
  assert.ok(new Set(ex.map((c) => c.expect.J1.moves[0])).size >= 4);
  assert.deepEqual(pickExamples(pool, 4, 7).map((c) => c.id), ex.map((c) => c.id));
  const p = renderFrontDesk({ style: "p2", examples: 3 }, { templates, menu, examplesPool: pool });
  assert.match(p, /Examples:/);
  assert.equal((p.match(/^Nick: /gm) ?? []).length, 3);
});

test("xml wraps the sections and restate repeats the key rules at the end", () => {
  const p = renderFrontDesk({ style: "p2", xml: true, restate: true }, { templates, menu, examplesPool: pool });
  assert.match(p, /<tools>[\s\S]*<\/tools>/);
  assert.match(p.trim().split("\n").slice(-4).join("\n"), /Never answer a request to change something/);
});

test("schemaAll makes every field required so an 'answer' move cannot come back empty-shaped", () => {
  assert.deepEqual(schemaFor({}).required, ["move"]);
  assert.deepEqual(schemaFor({ schemaAll: true }).required, ["move", "tool", "args", "tier", "think", "say", "answer"]);
});

import { renderToolPrompt } from "../scripts/lib/eval/v3/prompts.mjs";

test("tool prompts: base, then each switched-on block, examples, restate last", () => {
  const blocks = { rules: "RULES", procedure: "PROC", selfcheck: "CHECK", restate: "REMEMBER" };
  const p = renderToolPrompt({ base: "p0", rules: true, selfcheck: true, examples: true, restate: true }, { bases: { p0: "BASE" }, blocks, examples: "EXAMPLES" });
  assert.deepEqual(p.split("\n\n"), ["BASE", "RULES", "CHECK", "EXAMPLES", "REMEMBER"]);
  assert.equal(renderToolPrompt({ base: "p0" }, { bases: { p0: "BASE" }, blocks, examples: "" }), "BASE");
});
