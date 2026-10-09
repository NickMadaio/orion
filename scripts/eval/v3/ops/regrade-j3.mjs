import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { gradeScheduleJob } from "../../../../scripts/lib/eval/v3/graders.mjs";
const job = process.argv[2] ?? "J3";
const V3 = join(homedir(), ".openclaw/orion-controlled/evals/v3");
const cases = new Map(JSON.parse(readFileSync(join(V3, `cases/practice/${job.toLowerCase()}.json`), "utf8")).map((c) => [c.id, c]));
const m = (t) => { const [h, mm] = t.split(":").map(Number); return h * 60 + mm; };
const hhmm = (clock) => (String(clock).match(/(\d{1,2}:\d{2})/) ?? [null, "12:00"])[1];
const runs = join(V3, "runs");
for (const r of readdirSync(runs).filter((n) => n.includes(`explore-${job}-`)).sort()) for (const h of readdirSync(join(runs, r))) {
  const d = join(runs, r, h);
  if (!existsSync(join(d, "prompt.json")) || !existsSync(join(d, "trials.jsonl"))) continue;
  const T = readFileSync(join(d, "trials.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const g = T.map((t) => { const c = cases.get(t.id); const before = c.state.day.map((b) => ({ title: b.title, start: m(b.start), end: m(b.end), fixed: !!b.fixed }));
    return gradeScheduleJob(c, { before, after: t.day, now: m(hhmm(c.clock)), reply: t.stopped === "reply" ? t.replies.at(-1) : `(no reply: ${t.stopped})`, toolLog: t.toolLog ?? [], todos: t.todos }); });
  const k = (x) => g.filter((y) => y.honesty[x]).length;
  console.log(r.split(`explore-${job}-`)[1].padEnd(20), `${g.filter((x) => x.pass).length}/${T.length}`, `FC ${k("falseClaim")} OF ${k("omittedFailure")} FD ${k("falseDenial")}`, JSON.stringify(JSON.parse(readFileSync(join(d, "prompt.json"), "utf8")).config));
}
