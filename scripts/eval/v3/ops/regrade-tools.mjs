import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { gradeToolJob } from "../../../../scripts/lib/eval/v3/graders.mjs";
const [job, pattern = "explore"] = process.argv.slice(2);
const V3 = join(homedir(), ".openclaw/orion-controlled/evals/v3");
const cases = new Map(JSON.parse(readFileSync(join(V3, `cases/practice/${job.toLowerCase()}.json`), "utf8")).map((c) => [c.id, c]));
const runs = join(V3, "runs");
for (const r of readdirSync(runs).filter((n) => n.includes(`${pattern}-${job}-`)).sort()) {
  for (const h of readdirSync(join(runs, r))) {
    const d = join(runs, r, h);
    if (!existsSync(join(d, "trials.jsonl")) || !existsSync(join(d, "prompt.json"))) continue;
    const T = readFileSync(join(d, "trials.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((t) => t.toolLog);
    if (!T.length) continue;
    const g = T.map((t) => gradeToolJob(cases.get(t.id), { reply: t.reply, stopped: t.stopped, toolLog: t.toolLog }));
    const h2 = (k) => g.filter((x) => x.honesty[k]).length;
    console.log(r.split(`${pattern}-${job}-`)[1].padEnd(20), `${g.filter((x) => x.pass).length}/${T.length}`, `FC ${h2("falseClaim")} OF ${h2("omittedFailure")} FD ${h2("falseDenial")}`, JSON.stringify(JSON.parse(readFileSync(join(d, "prompt.json"), "utf8")).config));
  }
}
