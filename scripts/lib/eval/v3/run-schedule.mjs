// One J3 (scheduling) run: each case on its own private sandbox day, ORION's
// real calendar scripts doing the work, the day left behind graded with the
// existing schedule grader plus V3's honesty check (handoff §6 J3). Multi-turn
// cases keep the conversation. A failed preflight stops the run: a trial that
// cannot prove it is on the sandbox must not run at all.
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)
import { chat } from "./ollama.mjs";
import { runAgent } from "./loop.mjs";
import { createSandbox, REAL_SCRIPTS } from "./sandbox.mjs";
import { canonicalCall, fixtureExecutor, toolsFor } from "./fixtures.mjs";
import { gradeScheduleJob } from "./graders.mjs";
import { configure } from "./presets.mjs";
import { rng } from "./stats.mjs";
import { basename } from "node:path";

const shuffle = (xs, seed) => { const next = rng(seed); return xs.map((x) => [next(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x); };
const hhmm = (clock) => (String(clock ?? "12:00").match(/(\d{1,2}:\d{2})/) ?? [null, "12:00"])[1];
const minuteOf = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

// Calendar scripts run for real in the sandbox; anything else gets a scripted reply.
const sandboxExecutor = (sb, fixtures) => {
  const scripted = fixtureExecutor(fixtures);
  return async (call) => {
    const canonical = canonicalCall(call);
    const command = String(call.args?.command ?? "");
    if (call.name === "exec" && REAL_SCRIPTS.has(basename(command.trim().split(/\s+/)[0] ?? ""))) {
      const { stdout, exit } = await sb.run(command);
      return { canonical, stdout, exit };
    }
    return scripted(call);
  };
};

export async function runScheduleJob(cases, { model, template, menu, think = "off", temp = "card", ctx = 16384, repeats = 1, seed = 1, timeoutMs = 180000, maxSteps = 10, onTrial = () => {}, chatImpl = chat }) {
  const cfg = configure(model, { think, temp, ctx });
  const tools = toolsFor("T1", menu);
  const system = template.trim();
  await chatImpl({ model, messages: [{ role: "system", content: system }, { role: "user", content: "Now: warm-up.\n\nNick: hi" }], tools, think: cfg.think, options: cfg.options, timeoutMs: 300000 });
  const trials = [];
  for (let r = 0; r < repeats; r++) {
    for (const c of shuffle(cases, seed + r)) {
      const now = hhmm(c.clock);
      const sb = createSandbox({ day: c.state?.day ?? [], now, todos: c.state?.todos ?? [] });
      try {
        if (!(await sb.preflight())) throw new Error(`sandbox preflight failed for ${c.id}: the scripts did not see the private day — stopping`);
        const before = sb.state().day;
        const executor = sandboxExecutor(sb, c.fixtures ?? []);
        let history = (c.history ?? []).map((m) => ({ role: m.role, content: m.content }));
        const replies = []; const toolLog = []; let stopped = "reply"; let steps = 0; let wall = 0; let ttft = null;
        for (const [i, turn] of (c.turns ?? [c.say]).entries()) {
          const content = i === 0 ? `Now: ${c.clock ?? now}.\n\nNick: ${turn}` : `Nick: ${turn}`;
          const run = await runAgent({ model, system, messages: [...history, { role: "user", content }], tools, executor, think: cfg.think, options: cfg.options, maxSteps, stepTimeoutMs: timeoutMs, chatImpl });
          history = run.messages.slice(1);
          replies.push(run.reply); toolLog.push(...run.toolLog); steps += run.steps.length;
          wall += run.steps.reduce((s, x) => s + (x.timings?.wallMs ?? 0), 0);
          ttft ??= run.steps[0]?.timings?.ttftMs ?? null;
          if (run.stopped !== "reply") { stopped = run.stopped; break; }
        }
        const state = sb.state();
        const reply = replies.at(-1) ?? "";
        const grade = gradeScheduleJob(c, { before, after: state.day, now: minuteOf(now), reply: stopped === "reply" ? reply : `(no reply: ${stopped}) ${reply}`, toolLog, todos: state.todos });
        const trial = { repeat: r, id: c.id, job: c.job ?? "J3", provenance: c.provenance, pass: grade.pass, reasons: grade.reasons, honesty: grade.honesty, calls: toolLog.map((t) => t.canonical),
          replies, stopped, day: state.day, todos: state.todos, timings: { ttftMs: ttft, wallMs: wall, steps } };
        trials.push(trial);
        onTrial(trial);
      } finally {
        sb.cleanup();
      }
    }
  }
  return { trials, cfg };
}
