// The V3 agent loop: tool calls go to the executor, results come back as
// role:"tool" messages, and the loop stops on a reply, a step limit or an error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "../scripts/lib/eval/v3/loop.mjs";

const step = (message, extra = {}) => ({ message: { content: "", thinking: "", tool_calls: [], ...message }, timings: { ttftMs: 5, wallMs: 10, promptN: 100, promptMs: 1, evalN: 5, evalMs: 2 }, aborted: null, error: null, ...extra });
const scripted = (steps) => { const seen = []; let i = 0; const fn = async (req) => { seen.push(req); return steps[Math.min(i++, steps.length - 1)]; }; fn.seen = seen; return fn; };
const call = (name, args) => ({ function: { name, arguments: args } });

test("runs a tool, feeds the result back and returns the final reply", async () => {
  const chatImpl = scripted([step({ tool_calls: [call("exec", { command: "orion-lights off" })] }), step({ content: "Lights off." })]);
  const executor = async (c) => ({ canonical: `exec ${c.args.command}`, stdout: "Lights: sent off", exit: 0 });
  const r = await runAgent({ model: "m", system: "S", messages: [{ role: "user", content: "lights off" }], tools: [], executor, chatImpl });
  assert.equal(r.reply, "Lights off.");
  assert.equal(r.toolLog.length, 1);
  assert.equal(r.toolLog[0].canonical, "exec orion-lights off");
  const second = chatImpl.seen[1].messages;
  assert.equal(second[0].role, "system");
  assert.equal(second.at(-1).role, "tool");
  assert.equal(second.at(-1).tool_name, "exec");
  assert.match(second.at(-1).content, /Lights: sent off/);
  assert.equal(r.steps.length, 2);
});

test("an unknown tool gets an error result and the loop continues", async () => {
  const chatImpl = scripted([step({ tool_calls: [call("lights_off", {})] }), step({ content: "I couldn't do that." })]);
  const executor = async () => { throw new Error("should not run"); };
  const r = await runAgent({ model: "m", system: "S", messages: [{ role: "user", content: "x" }], tools: [{ type: "function", function: { name: "exec" } }], executor, chatImpl });
  assert.equal(r.toolLog[0].exit, null);
  assert.match(r.toolLog[0].stdout, /Unknown tool/);
  assert.equal(r.malformedCalls, 1);
});

test("the step limit stops a tool loop and is reported", async () => {
  const chatImpl = scripted([step({ tool_calls: [call("exec", { command: "orion-agenda today" })] })]);
  const r = await runAgent({ model: "m", system: "S", messages: [{ role: "user", content: "x" }], tools: [], maxSteps: 3,
    executor: async (c) => ({ canonical: `exec ${c.args.command}`, stdout: "ok", exit: 0 }), chatImpl });
  assert.equal(r.stopped, "max-steps");
  assert.equal(r.steps.length, 3);
});

test("a timed-out step ends the run as a failure with what was produced so far", async () => {
  const chatImpl = scripted([step({ content: "Wor" }, { aborted: "timeout" })]);
  const r = await runAgent({ model: "m", system: "S", messages: [{ role: "user", content: "x" }], tools: [], executor: async () => ({}), chatImpl });
  assert.equal(r.stopped, "timeout");
  assert.equal(r.reply, "Wor");
});

test("thinking is kept in the assistant message for the tool loop", async () => {
  const chatImpl = scripted([step({ thinking: "plan", tool_calls: [call("exec", { command: "a" })] }), step({ content: "done" })]);
  await runAgent({ model: "m", system: "S", messages: [{ role: "user", content: "x" }], tools: [], executor: async () => ({ canonical: "exec a", stdout: "", exit: 0 }), chatImpl });
  const assistant = chatImpl.seen[1].messages.find((m) => m.role === "assistant");
  assert.equal(assistant.thinking, "plan");
});
