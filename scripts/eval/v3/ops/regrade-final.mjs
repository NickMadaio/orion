// Re-grade held-out scheduling finals after a grader fix — AGGREGATES ONLY (held-out details stay
// unread, handoff §9). Usage: node scripts/eval/v3/ops/regrade-final.mjs [J2|J3|J4|J5|J6] [--write]
// --write appends a "final" ledger entry (regradeOf: runId) for the latest run per model, so the
// report uses the re-graded numbers.
// (Written by Claude on 2026-10-09 for the V3 local-first evaluation.)
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { gradeScheduleJob, gradeToolJob } from "../../../lib/eval/v3/graders.mjs";
import { summariseFinal } from "../../../lib/eval/v3/final.mjs";
import { appendLedger } from "../../../lib/eval/v3/ledger.mjs";
const job = process.argv[2] ?? "J3";
const V3 = join(homedir(), ".openclaw/orion-controlled/evals/v3");
const cases = new Map(JSON.parse(readFileSync(join(V3, `cases/heldout/${job.toLowerCase()}.json`), "utf8")).map((c) => [c.id, c]));
const m = (t) => { const [h, mm] = t.split(":").map(Number); return h * 60 + mm; };
const hhmm = (clock) => (String(clock).match(/(\d{1,2}:\d{2})/) ?? [null, "12:00"])[1];
const runs = join(V3, "runs");
const write = process.argv.includes("--write");
const ledger = readFileSync(join(V3, "ledger.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const latest = new Map();
for (const r of readdirSync(runs).filter((n) => n.includes(`final-${job}-`)).sort()) {
  const f = join(runs, r, "trials.jsonl");
  if (!existsSync(f)) continue;
  const T = readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const schedule = ["J3", "J6"].includes(job);
  const g = T.map((t) => { const c = cases.get(t.id);
    if (!schedule) return { id: t.id, ...gradeToolJob(c, { reply: t.reply, stopped: t.stopped, toolLog: t.toolLog ?? [] }) };
    const before = c.state.day.map((b) => ({ title: b.title, start: m(b.start), end: m(b.end), fixed: !!b.fixed }));
    return { id: t.id, ...gradeScheduleJob(c, { before, after: t.day, now: m(hhmm(c.clock)), reply: t.stopped === "reply" ? t.replies.at(-1) : `(no reply: ${t.stopped})`, toolLog: t.toolLog ?? [], todos: t.todos }) }; });
  const k = (x) => g.filter((y) => y.honesty[x]).length;
  const ids = [...new Set(g.map((x) => x.id))];
  const pass3 = ids.filter((id) => g.filter((x) => x.id === id).every((x) => x.pass)).length / ids.length;
  latest.set(r.split(`final-${job}-`)[1], { r, T, g });
  console.log(r.split(`final-${job}-`)[1].padEnd(22), `${g.filter((x) => x.pass).length}/${T.length}`, `pass^3 ${pass3.toFixed(2)}`, `FC ${k("falseClaim")} OF ${k("omittedFailure")} FD ${k("falseDenial")} WD ${k("wrongDetail")}`);
}

if (write) for (const [, { r, T, g }] of latest) {
  const original = ledger.find((e) => e.kind === "final" && e.runId === r);
  if (!original) { console.log(`no ledger entry for ${r} — not written`); continue; }
  const trials = T.map((t, i) => ({ ...t, pass: g[i].pass, honesty: g[i].honesty }));
  const { perCase, ...result } = summariseFinal(trials);
  const { at, ...rest } = original;
  appendLedger({ ...rest, kind: "final", regradeOf: r, result });
  console.log(`wrote re-graded final for ${original.model}: ${result.pass}/${result.trials}`);
}
