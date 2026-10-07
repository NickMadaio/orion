import { test } from "node:test";
import assert from "node:assert/strict";
import { thinkingLevel } from "../scripts/lib/thinking-policy.mjs";

test("ordinary talk does not think; changing his day does (2026-10-07)", () => {
  assert.equal(thinkingLevel("how's it going"), "off");
  assert.equal(thinkingLevel("tell me a joke"), "off");
  for (const text of ["can you start organize safari directly after CS lab", "make a new to-do", "move the gym to 6pm", "what's on tomorrow"]) {
    assert.equal(thinkingLevel(text), "low", text);
  }
  assert.equal(thinkingLevel("reschedule my day", { model: "ollama/qwen3.5:9b" }), "off");
});
