// J7 judge calibration (handoff §8.4): agreement between a local judge and the hand scores in
// ~/.openclaw/orion-controlled/evals/v3/review/j7-hand-scores.json, within ±1 on ≥85% of
// (item, dimension) pairs. Usage: node scripts/eval/v3/ops/judge-calibration.mjs <judge-model> [v1|v2] [sample tag]
// (Written by Claude on 2026-10-09 for the V3 local-first evaluation.)
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { agreement, DIMENSIONS } from "../../../lib/eval/v3/judge.mjs";

const judge = process.argv[2] ?? "gpt-oss:20b";
const version = process.argv[3] ?? "v1"; // v1 files have no suffix
const tag = process.argv[4] ? `-${process.argv[4]}` : ""; // a second hand-scored sample, e.g. "b"
const V3 = join(homedir(), ".openclaw/orion-controlled/evals/v3");
const hand = JSON.parse(readFileSync(join(V3, `review/j7-hand-scores${tag}.json`), "utf8"));
const sample = JSON.parse(readFileSync(join(V3, `review/j7-calibration-sample${tag}.json`), "utf8"));
const pairs = [];
const perDim = Object.fromEntries(Object.keys(DIMENSIONS).map((d) => [d, []]));
for (const [short, runDir] of Object.entries(sample.runs)) {
  const file = join(V3, runDir, `judged-${judge.replace(/[:/]/g, "_")}${version === "v1" ? "" : `-${version}`}.jsonl`);
  if (!existsSync(file)) { console.log(`no ${judge} scores for ${short} (${hand.models[short]}) — skipped`); continue; }
  const rows = new Map(readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.id, r]));
  for (const id of sample.ids) {
    for (const d of Object.keys(DIMENSIONS)) {
      const p = { hand: hand.scores[id]?.[short]?.[d] ?? null, judge: rows.get(id)?.scores?.[d]?.score ?? null };
      pairs.push(p); perDim[d].push(p);
    }
  }
}
const all = agreement(pairs);
console.log(JSON.stringify({ judge, version, ...all, passes: all.withinOne >= 0.85, byDimension: Object.fromEntries(Object.entries(perDim).map(([d, ps]) => [d, agreement(ps).withinOne])) }, null, 1));
