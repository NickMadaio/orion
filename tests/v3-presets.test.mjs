// Thinking levels per model: gpt-oss only takes low/medium/high (an "on" sent 0/25 on 2026-10-09).
import { test } from "node:test";
import assert from "node:assert/strict";
import { thinkFor } from "../scripts/lib/eval/v3/presets.mjs";

test("think levels are translated to what each model accepts", () => {
  assert.deepEqual(thinkFor("gpt-oss:20b", "on"), { think: "medium", applied: "medium" });
  assert.deepEqual(thinkFor("gpt-oss:20b", "off"), { think: "low", applied: "low" });
  assert.deepEqual(thinkFor("gpt-oss:20b", "high"), { think: "high", applied: "high" });
  assert.deepEqual(thinkFor("qwen3.5:9b", "high"), { think: true, applied: "on" });
  assert.deepEqual(thinkFor("llama3.2:3b", "on"), { think: undefined, applied: "none" });
});
