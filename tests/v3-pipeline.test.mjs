// The escalation pipeline: the say line comes first, the escalated model sees
// the whole conversation, and every step records who answered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runConversation } from "../scripts/lib/eval/v3/pipeline.mjs";

test("answer, then escalate with the earlier turn included; each step records who answered", async () => {
  const moves = [{ move: "answer", answer: "Gym is at 6 PM." }, { move: "escalate", tier: "standard", think: "low", say: "Moving it — one moment." }];
  let i = 0; const seen = [];
  const r = await runConversation({ id: "x", turns: ["when's gym", "move it to 7"] }, {
    frontDesk: async () => moves[i++],
    escalate: async (req) => { seen.push(req); return { reply: "Gym is at 7 PM now.", model: "ollama/qwen3.5:9b" }; },
    tiers: { quick: "ollama/qwen3.5:4b", standard: "ollama/qwen3.5:9b", deep: "ollama/qwen3.6:27b" },
  });
  assert.equal(r.steps[0].answeredBy, "front-desk");
  assert.equal(r.steps[1].answeredBy, "ollama/qwen3.5:9b");
  assert.match(seen[0].text, /Nick: when's gym\nORION: Gym is at 6 PM\./);
  assert.match(seen[0].text, /Nick: move it to 7$/);
  assert.equal(r.steps[1].say, "Moving it — one moment.");
});

test("world-touching tools are simulated in the pipeline", async () => {
  const r = await runConversation({ id: "y", say: "lights off" }, { frontDesk: async () => ({ move: "tool", tool: "lights", args: { do: "off" }, say: "" }), escalate: async () => ({}), tiers: {} });
  assert.match(r.replies[0], /simulated/);
});
