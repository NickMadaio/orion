// One J1 (front desk) run: every case through one model configuration, graded,
// with per-trial timings (handoff §9, §13.4). The model is warmed up first so
// timings are warm unless a cold measurement is asked for.
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)
import { chat } from "./ollama.mjs";
import { systemPrompt, messagesFor, oracleOutput, FRONT_DESK_SCHEMA } from "./frontdesk.mjs";
import { gradeFrontDesk } from "./graders.mjs";
import { configure } from "./presets.mjs";
import { rng, median } from "./stats.mjs";

const pct = (xs, q) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
const shuffle = (xs, seed) => { const next = rng(seed); return xs.map((x) => [next(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x); };

/**
 * cases, { model, template, menu, think, temp, ctx, repeats, seed, oracle, onTrial }
 * → { trials, summary }
 */
export async function runFrontDesk(cases, { model, template, menu, think = "off", temp = "card", ctx = 16384, repeats = 1, seed = 1, oracle = false, timeoutMs = 60000, onTrial = () => {}, chatImpl = chat }) {
  const system = systemPrompt(template, menu);
  const cfg = configure(model, { think, temp, ctx });
  if (!oracle) await chatImpl({ model, messages: [{ role: "system", content: system }, { role: "user", content: "Now: warm-up.\n\nMessage:\nNick: hi" }], format: FRONT_DESK_SCHEMA, think: cfg.think, options: cfg.options, timeoutMs: 180000 });
  const trials = [];
  for (let r = 0; r < repeats; r++) {
    for (const c of shuffle(cases, seed + r)) {
      const res = oracle ? { message: { content: oracleOutput(c) }, timings: {}, aborted: null, error: null }
        : await chatImpl({ model, messages: [{ role: "system", content: system }, ...messagesFor(c)], format: FRONT_DESK_SCHEMA, think: cfg.think, options: cfg.options, timeoutMs });
      const failed = res.error || res.aborted;
      const grade = failed ? { pass: false, validJson: false, move: null, critical: null, reasons: [res.error ? `error: ${res.error}` : `aborted: ${res.aborted}`] } : gradeFrontDesk(c, res.message.content);
      const trial = { repeat: r, id: c.id, provenance: c.provenance, pass: grade.pass, validJson: grade.validJson, move: grade.move, critical: grade.critical,
        reasons: grade.reasons, content: res.message?.content ?? "", thinkingChars: (res.message?.thinking ?? "").length, timings: res.timings };
      trials.push(trial);
      onTrial(trial);
    }
  }
  return { trials, summary: summarise(trials, { cfg }) };
}

export function summarise(trials, { cfg } = {}) {
  const byProv = trials.reduce((m, t) => m.set(t.provenance, [...(m.get(t.provenance) ?? []), t]), new Map());
  const critical = trials.filter((t) => t.critical).reduce((m, t) => ({ ...m, [t.critical]: (m[t.critical] ?? 0) + 1 }), {});
  const ttft = trials.map((t) => t.timings?.ttftMs);
  const wall = trials.map((t) => t.timings?.wallMs);
  const reasons = trials.flatMap((t) => t.reasons ?? []).map((r) => r.replace(/ not in .*| do not match .*|".*"/, "")).reduce((m, r) => ({ ...m, [r]: (m[r] ?? 0) + 1 }), {});
  return {
    n: trials.length, pass: trials.filter((t) => t.pass).length, validJson: trials.filter((t) => t.validJson).length,
    criticalMisroutes: Object.values(critical).reduce((s, x) => s + x, 0), critical,
    byProvenance: Object.fromEntries([...byProv].map(([k, ts]) => [k, { n: ts.length, pass: ts.filter((t) => t.pass).length }])),
    failureReasons: reasons,
    speed: { ttftP50: pct(ttft, 0.5), ttftP90: pct(ttft, 0.9), wallP50: pct(wall, 0.5), wallP90: pct(wall, 0.9), wallMedian: median(wall.filter((x) => x != null).length ? wall.filter((x) => x != null) : [0]) },
    thinkApplied: cfg?.applied ?? null, options: cfg?.options ?? null,
  };
}
