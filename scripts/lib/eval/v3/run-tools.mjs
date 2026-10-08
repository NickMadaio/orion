// One tool-job run (J2 simple tools, J4 honesty): each case through the agent
// loop with scripted tool results, graded on the calls made and on whether the
// reply agrees with what the tools returned (handoff §6 J2/J4, §8.2–8.3).
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)
import { chat } from "./ollama.mjs";
import { runAgent } from "./loop.mjs";
import { messagesFor } from "./frontdesk.mjs";
import { fixtureExecutor, toolsFor } from "./fixtures.mjs";
import { gradeToolJob } from "./graders.mjs";
import { configure } from "./presets.mjs";
import { rng } from "./stats.mjs";

const shuffle = (xs, seed) => { const next = rng(seed); return xs.map((x) => [next(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x); };

export async function runToolJob(cases, { model, template, menu, iface = "T1", think = "off", temp = "card", ctx = 16384, repeats = 1, seed = 1, timeoutMs = 60000, maxSteps = 6, onTrial = () => {}, chatImpl = chat }) {
  const cfg = configure(model, { think, temp, ctx });
  const tools = toolsFor(iface, menu);
  const system = template.trim();
  await chatImpl({ model, messages: [{ role: "system", content: system }, { role: "user", content: "Now: warm-up.\n\nMessage:\nNick: hi" }], tools, think: cfg.think, options: cfg.options, timeoutMs: 180000 });
  const trials = [];
  for (let r = 0; r < repeats; r++) {
    for (const c of shuffle(cases, seed + r)) {
      const run = await runAgent({ model, system, messages: messagesFor(c), tools, executor: fixtureExecutor(c.fixtures ?? []), think: cfg.think, options: cfg.options, maxSteps, stepTimeoutMs: timeoutMs, chatImpl });
      const grade = gradeToolJob(c, run);
      const wall = run.steps.reduce((s, x) => s + (x.timings?.wallMs ?? 0), 0);
      const trial = { repeat: r, id: c.id, job: c.job, provenance: c.provenance, pass: grade.pass, reasons: grade.reasons, honesty: grade.honesty, calls: run.toolLog.map((t) => t.canonical),
        reply: run.reply, stopped: run.stopped, malformedCalls: run.malformedCalls, timings: { ttftMs: run.steps[0]?.timings?.ttftMs ?? null, wallMs: wall, steps: run.steps.length } };
      trials.push(trial);
      onTrial(trial);
    }
  }
  return { trials, cfg };
}
