// Freeze each model's best practice configuration for the given jobs and queue its held-out final.
// Rule (the one used by hand so far): most practice passes on the CURRENT practice set, then fewest
// false claims, then fastest median. Only tune/explore entries after --since count (case sets grew on
// 2026-10-09). Usage: node scripts/eval/v3/ops/auto-freeze.mjs --jobs J2,J5,J6 --since 2026-10-09T17:50 [--dry]
// (Written by Claude on 2026-10-10 for the V3 local-first evaluation.)
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const jobs = arg("--jobs", "J2,J5,J6").split(",");
const since = arg("--since", "2026-10-09T17:50");
const dry = process.argv.includes("--dry");
const V3 = join(homedir(), ".openclaw/orion-controlled/evals/v3");
const Q = join(V3, "queue");
const MODELS = ["llama3.2:3b", "qwen3.5:4b-q4_K_M", "qwen3.5:9b", "gpt-oss:20b", "qwen3.6:27b"];

const ledger = readFileSync(join(V3, "ledger.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const practiceSize = (job) => JSON.parse(readFileSync(join(V3, `cases/practice/${job.toLowerCase()}.json`), "utf8")).length;

export function pickBest(entries) {
  const score = (e) => [e.practice.pass, -(e.practice.honesty?.falseClaims ?? 0), -(e.practice.speed?.wallP50 ?? Infinity)];
  const better = (a, b) => { const [x, y] = [score(a), score(b)]; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
  return entries.reduce((best, e) => (best && !better(e, best) ? best : e), null);
}

let n = readdirSync(Q).filter((f) => /\.(job|done|running|skip|hold)$/.test(f)).length + 2000;
const queue = (line) => { if (!dry) writeFileSync(join(Q, `${n}.job`), `${line}\n`); console.log(`queue ${n}: ${line}`); n += 1; };

for (const job of jobs) {
  const size = practiceSize(job);
  for (const model of MODELS) {
    const tries = ledger.filter((e) => e.job === job && e.model === model && ["tune", "explore"].includes(e.kind) && e.at >= since && e.practice?.n === size && e.config);
    const best = pickBest(tries);
    if (!best) { console.log(`${job} ${model}: no tries on the ${size}-case practice set — skipped`); continue; }
    const config = Object.fromEntries(Object.entries(best.config).filter(([k]) => !["base"].includes(k) || true));
    const why = `auto-freeze: best of ${tries.length} tries on the ${size}-case practice set — ${best.practice.pass}/${size}, ${best.practice.honesty?.falseClaims ?? 0} false claims`;
    console.log(`${job} ${model}: ${best.practice.pass}/${size} ${JSON.stringify(config)}`);
    if (!dry) execFileSync("node", ["scripts/orion-v3-eval", "freeze", "--job", job, "--model", model, "--config", JSON.stringify(config), "--why", why], { stdio: "inherit" });
    queue(`final --frozen --job ${job} --model ${model}`);
    queue(`!ollama stop ${model}`);
  }
}
