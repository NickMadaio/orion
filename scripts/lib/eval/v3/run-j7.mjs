// J7 (conversation and spoken style), handoff §6 J7: candidates reply first,
// then a calibrated local judge scores every reply on five dimensions, so the
// two models are not swapped in and out of memory for each case.
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)
import { chat } from "./ollama.mjs";
import { configure } from "./presets.mjs";
import { judgeAll, DIMENSIONS } from "./judge.mjs";

const userText = (c) => [
  `Now: ${c.clock ?? "unknown"}.`,
  c.facts?.length ? `What you know right now:\n${c.facts.map((f) => `- ${f}`).join("\n")}` : null,
  c.history?.length ? `Earlier:\n${c.history.map((m) => `${m.role === "assistant" ? "ORION" : "Nick"}: ${m.content}`).join("\n")}` : null,
  `Nick: ${c.say}`,
].filter(Boolean).join("\n\n");

export async function generateReplies(cases, { model, system, think = "off", temp = "card", ctx = 8192, onTrial = () => {}, chatImpl = chat }) {
  const cfg = configure(model, { think, temp, ctx });
  await chatImpl({ model, messages: [{ role: "system", content: system }, { role: "user", content: "Nick: hi" }], think: cfg.think, options: cfg.options, timeoutMs: 180000 });
  const trials = [];
  for (const c of cases) {
    const r = await chatImpl({ model, messages: [{ role: "system", content: system }, { role: "user", content: userText(c) }], think: cfg.think, options: cfg.options, timeoutMs: 60000 });
    const trial = { id: c.id, job: "J7", provenance: c.provenance, reply: (r.message?.content ?? "").trim(), error: r.error ?? r.aborted ?? null, timings: r.timings };
    trials.push(trial);
    onTrial(trial);
  }
  return { trials, cfg };
}

export async function judgeReplies(trials, casesById, { judge, chatImpl = chat, onScored = () => {} }) {
  const scored = [];
  for (const t of trials) {
    const c = casesById.get(t.id);
    const facts = [...(c.facts ?? []), ...(c.key ? [`(For the grader) A good answer contains: ${c.key}`] : [])];
    const scores = t.error ? null : await judgeAll({ model: judge, item: { facts, history: c.history ?? [], say: c.say, reply: t.reply }, chatImpl });
    const row = { ...t, judge, scores };
    scored.push(row);
    onScored(row);
  }
  return scored;
}

/** Mean per dimension (unknowns excluded, counted); the J7 gate is ≥4.0 average and no dimension below 3.5. */
export function summariseJudged(rows) {
  const out = {};
  for (const d of Object.keys(DIMENSIONS)) {
    const xs = rows.map((r) => r.scores?.[d]?.score).filter((x) => typeof x === "number");
    out[d] = { mean: xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100 : null, n: xs.length, unknown: rows.length - xs.length };
  }
  const means = Object.values(out).map((v) => v.mean).filter((x) => x != null);
  return { dimensions: out, average: means.length ? Math.round((means.reduce((s, x) => s + x, 0) / means.length) * 100) / 100 : null, gate: means.length === 5 && means.every((m) => m >= 3.5) && means.reduce((s, x) => s + x, 0) / 5 >= 4.0 };
}
