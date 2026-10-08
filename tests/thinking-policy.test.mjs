import { test } from "node:test";
import assert from "node:assert/strict";
import { thinkingLevel } from "../scripts/lib/thinking-policy.mjs";

test("talk and one-step commands don't think (2026-10-07)", () => {
  for (const text of ["how's it going", "end my focus session", "start a focus session, standard timing", "remind me at 6:55 for the drop",
    "move the gym to 6pm", "what's on tomorrow", "is my phone locked", "cancel the bank reminder"]) {
    assert.equal(thinkingLevel(text), "off", text);
  }
});

test("multi-part changes, anchors and whole days think", () => {
  for (const text of ["can you start organize safari directly after CS lab, same end conditions",
    "get rid of send internship applications and push study back half an hour",
    "plan my day from my to-do list", "move study to after dinner", "after class i'm gonna nap so i'm up by 1:30, then do the cs lab",
    "i didnt go to marketing so delete that. ive been working on orion for the past hour, and will be continuing for another 30, schedule that in"]) {
    assert.equal(thinkingLevel(text), "low", text);
  }
  assert.equal(thinkingLevel("plan my day", { model: "ollama/qwen3.5:9b" }), "off");
});
