import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { gradeFrontDesk } from "../../../../scripts/lib/eval/v3/graders.mjs";
const V3 = join(homedir(), ".openclaw/orion-controlled/evals/v3");
const cases = new Map(JSON.parse(readFileSync(join(V3, "cases/practice/j1.json"), "utf8")).map((c) => [c.id, c]));
const runs = join(V3, "runs");
const rows = [];
for (const r of readdirSync(runs).filter((n) => /-J1-/.test(n) && !/oracle|ABORTED/.test(n))) {
  const dirs = existsSync(join(runs, r, "trials.jsonl")) ? [join(runs, r)] : readdirSync(join(runs, r)).map((h) => join(runs, r, h)).filter((d) => existsSync(join(d, "trials.jsonl")));
  for (const d of dirs) {
    const T = readFileSync(join(d, "trials.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((t) => cases.has(t.id));
    if (T.length < 90) continue;
    const g = T.map((t) => gradeFrontDesk(cases.get(t.id), t.content));
    const cfg = existsSync(join(d, "prompt.json")) ? JSON.parse(readFileSync(join(d, "prompt.json"), "utf8")).config : { style: "p0" };
    const model = r.match(/J1-(.+?)-(baseline|tune|$)/)?.[1] ?? r.split("-J1-")[1];
    rows.push({ model, cfg: JSON.stringify(cfg), pass: g.filter((x) => x.pass).length, crit: g.filter((x) => x.critical).length, n: T.length });
  }
}
rows.sort((a, b) => a.model.localeCompare(b.model) || b.pass - a.pass);
for (const r of rows) console.log(r.model.padEnd(22), String(r.pass).padStart(3), "/", r.n, "crit", r.crit, r.cfg);
