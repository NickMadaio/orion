// Write the acceptance record that localRouting "on" requires (plugin/orion-control/src/local-routing.ts,
// acceptanceVerdict): the latest Phase 8 end-to-end run through the REAL route (orion-v3-pipeline).
// It records what happened; the plugin decides. Today's latest run (7/21, 35 s median) fails the gate.
// Usage: node scripts/eval/v3/ops/local-acceptance.mjs
// (Written by Claude on 2026-10-12 after local routing went live too early.)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const V3 = join(homedir(), ".openclaw/orion-controlled/evals/v3");
const runs = readFileSync(join(V3, "ledger.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.kind === "pipeline");
const latest = runs.at(-1);
if (!latest) { console.error("no pipeline run in the ledger — run scripts/orion-v3-pipeline first"); process.exit(2); }
const record = { at: latest.at, runId: latest.runId, n: latest.result.n, pass: latest.result.pass, medianMs: latest.result.totalMsP50, front: latest.front, tiers: latest.tiers };
const dir = join(homedir(), ".openclaw/orion-controlled/local-routing");
mkdirSync(dir, { recursive: true, mode: 0o700 });
writeFileSync(join(dir, "acceptance.json"), `${JSON.stringify(record, null, 1)}\n`, { mode: 0o600 });
console.log(JSON.stringify(record));
