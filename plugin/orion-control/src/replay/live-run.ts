/*
 The live layer: `orion-replay --live`. Real local models (Ollama) on the private corpus and on the schedule suites, in a sandbox.

 Sandbox: every Session writes its own ORION_CONTROLLED_DIR under the system temp directory, with its own eval-mode marker and its
 own sandbox calendar, so nothing reaches his real calendar, notes, Mac or messages, and no marker is ever left in the live state
 directory (the 2026-10-07 stale-marker trap). The Session removes its directory when it closes, including on an exception.

 Output: a results JSON per run under <corpus>/results/ (per-case status, route, latency), a printed summary (pass rate, median
 and p90 turn latency, resident models), and with --compare BASELINE the list of cases that passed then and fail now.
*/
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FRONT_DESK_MODEL } from "../front-desk-prompt.js";
import { WORKER_MODEL } from "../job-instructions.js";
import { readCaseDir } from "./cases.js";
import { gradeOutcome } from "./grade.js";
import { liveHooks, resident, warmModels, type LiveModels, type Resident } from "./live-backend.js";
import { runScheduleSuites, type SuiteRow } from "./schedule-suites.js";
import { Session } from "./turn.js";
import type { Outcome, ReplayCase } from "./types.js";

export type LiveOptions = { dir: string; only?: string[]; desk?: string; worker?: string; label?: string; compare?: string; repoCases: ReplayCase[]; schedule?: string; limitGood?: number };
export type LiveRow = { id: string; kind: "replay" | "schedule"; ok: boolean; failures: string[]; ms: number; route?: string; reply?: string; model?: string };
export type LiveSummary = { label: string; desk: string; worker: string; at: string; rows: LiveRow[]; passRate: number; medianMs: number; p90Ms: number; resident: Resident[] };

export const percentile = (xs: readonly number[], p: number): number => {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
};

/** Every audit turn, and an even spread of the good ones (the chat turns that worked) so a run stays an hour or two, not a day. */
export function sample(cases: readonly ReplayCase[], limitGood: number): ReplayCase[] {
  const good = cases.filter((c) => c.id.startsWith("real-good-"));
  const step = Math.max(1, Math.ceil(good.length / Math.max(1, limitGood)));
  return [...cases.filter((c) => !c.id.startsWith("real-good-")), ...good.filter((_, i) => i % step === 0)];
}

async function playLive(c: ReplayCase, models: LiveModels): Promise<{ outcome: Outcome; ms: number }> {
  const hooks = liveHooks(models, c.day ?? c.recorded?.day);
  const day = c.day ?? c.recorded?.day;
  const s = new Session(c.now ?? (day ? `${day.date}T${day.now ?? "19:44"}` : "2026-11-04T19:44"), c.surface ?? "mac", c.spoken ?? false, c.seed ?? {}, hooks);
  const started = Date.now();
  try {
    for (const p of c.prior ?? []) await s.turn(p.say, {}, 45_000, p.outreach);
    const outcome = await s.turn(c.say, {}, 45_000, c.outreach);
    return { outcome, ms: Date.now() - started };
  } finally { s.close(); }
}

export async function runLive(opts: LiveOptions): Promise<number> {
  const models: LiveModels = { desk: opts.desk ?? FRONT_DESK_MODEL, worker: opts.worker ?? WORKER_MODEL };
  const label = opts.label ?? `${models.desk}+${models.worker}`.replace(/[^a-zA-Z0-9.+_-]+/g, "_");
  const privateCases = readCaseDir(opts.dir);
  const pool = privateCases.length ? privateCases : opts.repoCases;
  const only = opts.only;
  const chosen = (only ? pool.filter((c) => only.includes(c.id) || (c.audit !== undefined && only.includes(c.audit))) : sample(pool, opts.limitGood ?? 30)).filter((c) => !c.skip);
  console.log(`orion-replay --live: desk ${models.desk}, worker ${models.worker}; ${chosen.length} replay turns${privateCases.length ? " (private corpus)" : " (repo cases: no private corpus found, run scripts/lib/replay/build-corpus.mjs)"}`);
  await warmModels(models);
  const rows: LiveRow[] = [];
  for (const c of chosen) {
    let row: LiveRow;
    try {
      const { outcome, ms } = await playLive(c, models);
      const failures = gradeOutcome(c.expect, outcome);
      row = { id: c.id, kind: "replay", ok: failures.length === 0, failures, ms, route: outcome.route, reply: outcome.reply.slice(0, 240) };
    } catch (error) {
      row = { id: c.id, kind: "replay", ok: false, failures: [`harness threw: ${error instanceof Error ? error.message : String(error)}`], ms: 0 };
    }
    rows.push(row);
    console.log(`${row.ok ? "PASS" : "FAIL"} ${row.id} (${Math.round(row.ms / 1000)}s) ${row.route ?? ""}${row.ok ? "" : `\n   ${row.failures.join("\n   ")}\n   ORION: ${(row.reply ?? "").replace(/\n/g, " ").slice(0, 160)}`}`);
  }
  if ((opts.schedule ?? "all") !== "none") {
    const suite: SuiteRow[] = await runScheduleSuites(models, only);
    for (const r of suite) {
      rows.push({ id: r.id, kind: "schedule", ok: r.ok, failures: r.failures, ms: r.ms, reply: r.reply.slice(0, 240) });
      console.log(`${r.ok ? "PASS" : "FAIL"} ${r.id} (${Math.round(r.ms / 1000)}s)${r.ok ? "" : `\n   ${r.failures.join("\n   ")}`}`);
    }
  }
  const mem = await resident();
  const ms = rows.map((r) => r.ms).filter((m) => m > 0);
  const summary: LiveSummary = { label, desk: models.desk, worker: models.worker, at: new Date().toISOString(), rows, passRate: rows.length ? rows.filter((r) => r.ok).length / rows.length : 0, medianMs: percentile(ms, 50), p90Ms: percentile(ms, 90), resident: mem };
  const resultsDir = join(opts.dir, "results");
  mkdirSync(resultsDir, { recursive: true });
  const file = join(resultsDir, `${label}-${summary.at.replace(/[:.]/g, "")}.json`);
  writeFileSync(file, JSON.stringify(summary, null, 1), { mode: 0o600 });
  console.log(`\nlive ${label}: ${rows.filter((r) => r.ok).length}/${rows.length} pass (${(summary.passRate * 100).toFixed(0)}%), median ${(summary.medianMs / 1000).toFixed(1)}s, p90 ${(summary.p90Ms / 1000).toFixed(1)}s`);
  console.log(`resident: ${mem.map((m) => `${m.name} ${m.gib} GiB (ctx ${m.ctx})`).join("; ") || "none"}\nresults: ${file}`);
  if (!opts.compare) return 0;
  const base = JSON.parse(readFileSync(opts.compare, "utf8")) as LiveSummary;
  const was = new Map(base.rows.map((r) => [r.id, r]));
  const broke = rows.filter((r) => !r.ok && was.get(r.id)?.ok);
  const fixed = rows.filter((r) => r.ok && was.get(r.id) && !was.get(r.id)!.ok);
  console.log(`vs ${base.label}: ${broke.length} regressed, ${fixed.length} fixed`);
  for (const r of broke) console.log(`  REGRESSED ${r.id}: ${r.failures.join("; ")}`);
  return broke.length ? 1 : 0;
}
