// The V3 Ollama client: streams, times the first token, assembles thinking,
// content and tool calls, and stops on a timeout or a thinking cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chat } from "../scripts/lib/eval/v3/ollama.mjs";

// A fetch that streams NDJSON chunks, one every `gapMs` of fake time.
const fakeFetch = (chunks, { gapMs = 10, captured = {} } = {}) => async (url, init) => {
  captured.url = url; captured.body = JSON.parse(init.body);
  let i = 0;
  const enc = new TextEncoder();
  const body = new ReadableStream({
    async pull(controller) {
      if (init.signal?.aborted) { controller.error(new DOMException("aborted", "AbortError")); return; }
      if (i >= chunks.length) { controller.close(); return; }
      await new Promise((r) => setTimeout(r, gapMs));
      controller.enqueue(enc.encode(JSON.stringify(chunks[i++]) + "\n"));
    },
  });
  return { ok: true, status: 200, body };
};

const done = { done: true, done_reason: "stop", load_duration: 5e6, prompt_eval_count: 900, prompt_eval_duration: 2e8, eval_count: 12, eval_duration: 3e8, message: { role: "assistant", content: "" } };

test("assembles thinking, content and timings; sends think, format and options as given", async () => {
  const captured = {};
  const r = await chat({
    model: "qwen3.5:9b", messages: [{ role: "user", content: "hi" }], think: false, format: { type: "object" },
    options: { temperature: 0, num_ctx: 16384 }, fetchImpl: fakeFetch([
      { message: { role: "assistant", thinking: "hm" } }, { message: { role: "assistant", content: "Hel" } },
      { message: { role: "assistant", content: "lo" } }, done], { captured }),
  });
  assert.equal(r.message.content, "Hello");
  assert.equal(r.message.thinking, "hm");
  assert.equal(r.aborted, null);
  assert.equal(r.timings.promptN, 900);
  assert.equal(r.timings.evalN, 12);
  assert.ok(r.timings.firstTokenMs <= r.timings.ttftMs && r.timings.ttftMs <= r.timings.wallMs);
  assert.equal(captured.body.think, false);
  assert.deepEqual(captured.body.format, { type: "object" });
  assert.equal(captured.body.options.num_ctx, 16384);
  assert.equal(captured.body.stream, true);
});

test("collects tool calls; the first tool call counts as the first answer token", async () => {
  const r = await chat({ model: "m", messages: [], fetchImpl: fakeFetch([
    { message: { role: "assistant", tool_calls: [{ function: { name: "exec", arguments: { command: "orion-lights off" } } }] } }, done]) });
  assert.equal(r.message.tool_calls.length, 1);
  assert.equal(r.message.tool_calls[0].function.name, "exec");
  assert.ok(r.timings.ttftMs !== null);
});

test("a thinking cap aborts a runaway thought and says so", async () => {
  const chunks = Array.from({ length: 50 }, () => ({ message: { role: "assistant", thinking: "loop " } }));
  const r = await chat({ model: "m", messages: [], thinkCap: 40, fetchImpl: fakeFetch(chunks, { gapMs: 1 }) });
  assert.equal(r.aborted, "think-cap");
  assert.ok(r.message.thinking.length >= 40 && r.message.thinking.length < 60);
});

test("a step timeout aborts and is reported, not thrown", async () => {
  const chunks = Array.from({ length: 50 }, () => ({ message: { role: "assistant", content: "x" } }));
  const r = await chat({ model: "m", messages: [], timeoutMs: 30, fetchImpl: fakeFetch(chunks, { gapMs: 10 }) });
  assert.equal(r.aborted, "timeout");
});

test("an HTTP error is returned as an error, not thrown", async () => {
  const r = await chat({ model: "m", messages: [], fetchImpl: async () => ({ ok: false, status: 404, text: async () => "model not found" }) });
  assert.match(r.error, /404.*model not found/);
});
