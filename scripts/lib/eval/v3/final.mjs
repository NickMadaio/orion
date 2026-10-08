// Held-out finals (handoff §9 step 7): a frozen configuration, three repeats of
// the whole held-out set — two at temperature 0 (to catch nondeterminism even
// there), one at the tuned temperature — each in a different case order, with
// per-case results kept for pass^3. Only aggregates are printed.
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)
import { runFrontDesk } from "./run-j1.mjs";
import { runToolJob } from "./run-tools.mjs";
import { runScheduleJob } from "./run-schedule.mjs";
import { schemaFor } from "./prompts.mjs";
import { wilson, passAllK, ruleOfThree } from "./stats.mjs";

const SCHEDULE = new Set(["J3", "J6"]);

/** Temperatures for repeat r of 3 (or more, for borderline extra repeats). */
export const repeatTemps = (tuned, repeats = 3) => Array.from({ length: repeats }, (_, r) => (r % 3 === 2 ? tuned : 0));

export async function runFinal({ job, frozen, cases, menu, repeats = 3, seed = 101, onTrial = () => {} }) {
  const { model, config, system } = frozen;
  const trials = [];
  for (const [r, temp] of repeatTemps(config.temp ?? "card", repeats).entries()) {
    const tag = (t) => { const row = { ...t, repeat: r, temp }; trials.push(row); onTrial(row); };
    const common = { model, think: config.think ?? "off", temp, ctx: config.ctx ?? 16384, seed: seed + r, onTrial: tag };
    if (job === "J1") await runFrontDesk(cases, { ...common, menu, system, schema: schemaFor(config), historyTurns: config.historyTurns ?? 4 });
    else if (SCHEDULE.has(job)) await runScheduleJob(cases, { ...common, menu, template: system });
    else await runToolJob(cases, { ...common, menu, template: system, iface: config.iface ?? "T1" });
  }
  return { trials, summary: summariseFinal(trials) };
}

export function summariseFinal(trials) {
  const byCase = trials.reduce((m, t) => m.set(t.id, [...(m.get(t.id) ?? []), t]), new Map());
  const pass = trials.filter((t) => t.pass).length;
  const honesty = (k) => trials.filter((t) => t.honesty?.[k]).length;
  const byProv = trials.reduce((m, t) => ({ ...m, [t.provenance]: { n: (m[t.provenance]?.n ?? 0) + 1, pass: (m[t.provenance]?.pass ?? 0) + (t.pass ? 1 : 0) } }), {});
  const failureTrials = trials.filter((t) => (t.calls ?? []).length).length;
  return {
    trials: trials.length, cases: byCase.size, pass, pooled: wilson(pass, trials.length),
    pass3: passAllK([...byCase.values()].map((ts) => ts.map((t) => t.pass))),
    criticalMisroutes: trials.filter((t) => t.critical).length,
    honesty: { falseClaims: honesty("falseClaim"), falseDenials: honesty("falseDenial"), omittedFailures: honesty("omittedFailure"), wrongDetails: honesty("wrongDetail"), toolTrials: failureTrials,
      falseClaimBound: honesty("falseClaim") === 0 ? ruleOfThree(trials.length) : null },
    byProvenance: byProv,
    perCase: Object.fromEntries([...byCase].map(([id, ts]) => [id, ts.sort((a, b) => a.repeat - b.repeat).map((t) => t.pass)])),
  };
}
