// The J1 front desk: prompt and messages are built the same way for every
// model, and the labelled "oracle" answer passes every case (handoff §13.5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { systemPrompt, messagesFor, oracleOutput, FRONT_DESK_SCHEMA } from "../scripts/lib/eval/v3/frontdesk.mjs";
import { gradeFrontDesk } from "../scripts/lib/eval/v3/graders.mjs";
import { normaliseCase, validateCase } from "../scripts/lib/eval/v3/cases.mjs";

const menu = JSON.parse(readFileSync(new URL("../scripts/eval/v3/front-desk-menu.json", import.meta.url), "utf8"));
const synthetic = JSON.parse(readFileSync(new URL("../scripts/eval/v3/synthetic/j1.json", import.meta.url), "utf8"))
  .cases.map((c) => normaliseCase(c, { job: "J1", provenance: "synthetic-edge" }));

test("the system prompt lists every menu tool and has no per-case content", () => {
  const s = systemPrompt("{{tools}} end", menu);
  for (const t of menu.tools) assert.match(s, new RegExp(`- ${t.name}:`));
  assert.doesNotMatch(s, /\{\{/);
});

test("dynamic facts and the conversation come after the stable prompt, the message last", () => {
  const c = synthetic.find((x) => x.id === "j1-syn-actually-5");
  const msgs = messagesFor(c);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].content, /^Now: Fri 14:00/);
  assert.match(msgs[0].content, /Nick: move gym to 6\nORION: Moved gym to 6 PM\./);
  assert.ok(msgs[0].content.trim().endsWith("Nick: actually make it 5"));
});

test("every synthetic case is valid and its oracle output passes", () => {
  const names = new Set(menu.tools.map((t) => t.name));
  for (const c of synthetic) {
    assert.deepEqual(validateCase(c, { menu: names }), []);
    const g = gradeFrontDesk(c, oracleOutput(c));
    assert.equal(g.pass, true, `${c.id}: ${g.reasons.join("; ")}`);
  }
});

test("the JSON schema constrains the move to the five moves", () => {
  assert.deepEqual(FRONT_DESK_SCHEMA.properties.move.enum, ["answer", "tool", "escalate", "ask", "ignore"]);
});
