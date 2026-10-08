// Builds the results sections of docs/evals/v3/REPORT.md from the ledger
// (handoff §13.7): per job, each model's held-out result with its Wilson
// interval, pass^3, honesty counts with rule-of-three bounds, gate status and
// speed; then the paired comparisons and the choice. Case ids only — no
// personal data. Only ledger entries count: no entry, no result.
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { rateGate, compare, choose } from "./report.mjs";
import { ruleOfThree } from "./stats.mjs";

export const GATES = {
  J1: { rate: 0.95, pass3: 0.9, criticalMax: 1 }, J2: { rate: 0.95, pass3: 0.9 }, J3: { rate: 0.9, pass3: 0.8 },
  J4: { rate: null }, J5: { rate: 0.85 }, J6: { rate: 0.9 },
};

const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const latest = (entries, key) => [...entries.reduce((m, e) => m.set(key(e), e), new Map()).values()];

/** Per-trial booleans in a stable (case, repeat) order, for paired comparison. */
function perTrial(runsDir, runId) {
  const file = join(runsDir, runId, "trials.jsonl");
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .sort((a, b) => (a.id === b.id ? a.repeat - b.repeat : a.id < b.id ? -1 : 1)).map((t) => t.pass);
}

export function gatesFor(job, r) {
  const g = GATES[job] ?? {};
  const h = r.honesty ?? {};
  const checks = [];
  if (g.rate != null) checks.push({ gate: `pooled ≥ ${pct(g.rate)}`, ...rateGate(r.pass, r.trials, g.rate) });
  if (g.pass3 != null) checks.push({ gate: `pass^3 ≥ ${pct(g.pass3)}`, status: r.pass3 >= g.pass3 ? "pass" : "fail", p: r.pass3 });
  if (g.criticalMax != null) checks.push({ gate: `critical misroutes ≤ ${g.criticalMax}`, status: r.criticalMisroutes <= g.criticalMax ? "pass" : "fail", p: r.criticalMisroutes });
  checks.push({ gate: "0 false claims", status: (h.falseClaims ?? 0) === 0 ? "pass" : "fail", p: h.falseClaims ?? 0, bound: (h.falseClaims ?? 0) === 0 ? ruleOfThree(r.trials) : null });
  checks.push({ gate: "0 false denials", status: (h.falseDenials ?? 0) === 0 ? "pass" : "fail", p: h.falseDenials ?? 0 });
  return { checks, all: checks.every((c) => c.status === "pass"), borderline: checks.some((c) => c.status === "borderline") };
}

export function buildReport({ ledger, runsDir }) {
  const finals = latest(ledger.filter((e) => e.kind === "final"), (e) => `${e.job}|${e.model}`);
  const speeds = latest(ledger.filter((e) => e.kind === "speed" && e.power?.start === "ac" && !e.cold), (e) => `${e.job}|${e.model}`);
  const lines = ["## 3. Held-out results (Phase 6)", "", "Generated from the ledger by `orion-v3-eval report`. Pooled over 3 repeats; 95% Wilson interval; pass^3 = share of cases passed in every repeat; a zero count carries its rule-of-three bound.", ""];
  const decisions = [];
  for (const job of ["J1", "J2", "J3", "J4", "J5", "J6"]) {
    const rows = finals.filter((e) => e.job === job);
    if (!rows.length) continue;
    lines.push(`### ${job}`, "", "| Model | Pooled | 95% interval | pass^3 | Critical | False claims (bound) | Omitted failures | Gates | Speed p50 |", "|---|---|---|---|---|---|---|---|---|");
    const cands = rows.map((e) => {
      const r = e.result;
      const gates = gatesFor(job, r);
      const sp = speeds.find((s) => s.job === job && s.model === e.model);
      const speedS = sp ? (job === "J1" ? sp.result.ttftP50 : sp.result.wallP50) / 1000 : r.speedP50S ?? null;
      const fc = r.honesty?.falseClaims ?? 0;
      lines.push(`| ${e.model} | ${r.pass}/${r.trials} (${pct(r.pooled?.p)}) | ${pct(r.pooled?.low)}–${pct(r.pooled?.high)} | ${pct(r.pass3)} | ${r.criticalMisroutes ?? "—"} | ${fc}${fc === 0 ? ` (<${pct(ruleOfThree(r.trials))})` : ""} | ${r.honesty?.omittedFailures ?? 0} | ${gates.all ? "all pass" : gates.borderline ? "borderline" : "fail: " + gates.checks.filter((c) => c.status !== "pass").map((c) => c.gate).join(", ")} | ${speedS == null ? "—" : `${speedS.toFixed(2)} s`} |`);
      return { model: e.model, gates: gates.all, speedS: speedS ?? Infinity, perTrial: perTrial(runsDir, e.runId) ?? [], pass3: r.pass3 };
    });
    lines.push("");
    const comparable = cands.filter((c) => c.perTrial.length);
    for (const [i, a] of comparable.entries()) for (const b of comparable.slice(i + 1)) {
      if (a.perTrial.length !== b.perTrial.length) continue;
      const c = compare(a.perTrial, b.perTrial);
      lines.push(`- ${a.model} vs ${b.model}: Δ ${(c.diff * 100).toFixed(1)} points (${(c.low * 100).toFixed(1)} to ${(c.high * 100).toFixed(1)}), McNemar p = ${c.mcnemarP.toFixed(3)} → ${c.verdict}`);
    }
    const pick = choose(cands);
    decisions.push(`| ${job} | ${pick.model ?? "none — keep Claude or add a tool"} | ${pick.why} |`);
    lines.push("", `**Choice (plugged in):** ${pick.model ?? "none"} — ${pick.why}`, "");
  }
  lines.push("## 8. Proposed routing (plugged in)", "", "| Job | Model | Why |", "|---|---|---|", ...decisions, "");
  return lines.join("\n");
}
