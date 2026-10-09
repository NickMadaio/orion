// The V3 agent loop (handoff §13.1): one model, a system prompt, the
// conversation, a tool list and an executor. Tool calls run through the
// executor (scripted fixtures, or ORION's real scripts on a private sandbox),
// results return as role:"tool" messages with tool_name, and thinking stays in
// the assistant message so Ollama can keep it inside the current tool loop.
// A call to a tool that was not offered gets the error production gives, so a
// model that invents tools is measured, not rescued.
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)
import { chat } from "./ollama.mjs";

const offered = (tools, name) => !tools?.length || tools.some((t) => t.function?.name === name);

/**
 * Returns { reply, steps: [{ timings, thinking, toolCalls }], toolLog: [{ name, args, canonical, stdout, exit }],
 *           stopped: "reply"|"max-steps"|"timeout"|"think-cap"|"error", error, malformedCalls, messages }.
 */
export async function runAgent({ model, system, messages, tools = [], executor, think, format, options = {}, maxSteps = 8,
  stepTimeoutMs = 60000, thinkCap = null, chatImpl = chat }) {
  let history = [{ role: "system", content: system }, ...messages];
  const steps = [];
  const toolLog = [];
  let malformedCalls = 0;
  for (let i = 0; i < maxSteps; i++) {
    const r = await chatImpl({ model, messages: history, tools, think, format, options, timeoutMs: stepTimeoutMs, thinkCap });
    const calls = r.message?.tool_calls ?? [];
    steps.push({ timings: r.timings, thinking: r.message?.thinking ?? "", toolCalls: calls.map((c) => c.function), aborted: r.aborted, error: r.error });
    const reply = (r.message?.content ?? "").trim();
    if (r.error) return { reply, steps, toolLog, stopped: "error", error: r.error, malformedCalls, messages: history };
    if (r.aborted) return { reply, steps, toolLog, stopped: r.aborted, error: null, malformedCalls, messages: history };
    if (!calls.length) return { reply, steps, toolLog, stopped: "reply", error: null, malformedCalls, messages: [...history, { role: "assistant", content: reply }] };
    const assistant = { role: "assistant", content: r.message.content ?? "", ...(r.message.thinking ? { thinking: r.message.thinking } : {}), tool_calls: calls };
    const results = [];
    for (const c of calls) {
      const name = c.function?.name ?? "";
      const args = typeof c.function?.arguments === "string" ? safeJson(c.function.arguments) : (c.function?.arguments ?? {});
      if (!offered(tools, name)) {
        malformedCalls += 1;
        const out = { name, args, canonical: `unknown ${name}`, stdout: `Unknown tool: ${name}. Use one of the tools you were given.`, exit: null };
        toolLog.push(out); results.push(out);
        continue;
      }
      // A harness or fixture error is the tool failing, not the run: the model sees it like any error.
      const done = await executor({ name, args }).catch((error) => ({ canonical: `${name} (executor error)`, stdout: `error: ${error.message}`, exit: 1 }));
      const out = { name, args, ...done };
      toolLog.push(out); results.push(out);
    }
    history = [...history, assistant, ...results.map((o) => ({ role: "tool", tool_name: o.name, content: String(o.stdout ?? "") }))];
  }
  return { reply: "", steps, toolLog, stopped: "max-steps", error: null, malformedCalls, messages: history };
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return { _unparsed: s }; }
}
