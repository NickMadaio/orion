// V3 cases (handoff §13.2–13.3): one shape for real-derived and synthetic
// cases, validated against the front-desk menu, and a practice/held-out split
// made once with a fixed seed and stratified by job, provenance and expected
// move. Cases added later join the split without moving earlier ones, so
// held-out cases stay unseen. Tuning selects "practice" only.
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)
import { rng } from "./stats.mjs";

export const MOVES = new Set(["answer", "tool", "escalate", "ask", "ignore"]);
export const TIERS = new Set(["quick", "standard", "deep"]);
const PARTS = new Set(["practice", "heldout"]);

/** A case's args pattern ("(?i)" prefix = case-insensitive) as a RegExp. */
export const patternOf = (src) => new RegExp(String(src).replace(/^\(\?i\)/, ""), String(src).startsWith("(?i)") ? "i" : "");

/** Synthetic shorthand ({ moves, tiers, tools, args } at the top) → { expect: { J1: … } }. */
export function normaliseCase(raw, { job, provenance }) {
  const j1 = raw.expect?.J1 ?? { moves: raw.moves ?? [], tiers: raw.tiers ?? [], tools: raw.tools ?? [], args: raw.args ?? null };
  return {
    id: raw.id, job: raw.job ?? job, provenance: raw.provenance ?? provenance, source: raw.source ?? null,
    clock: raw.clock ?? null, facts: raw.facts ?? {}, history: raw.history ?? [], say: raw.say ?? "",
    expect: { ...(raw.expect ?? {}), J1: { moves: j1.moves ?? [], tiers: j1.tiers ?? [], tools: j1.tools ?? [], args: j1.args ?? null } },
    notes: raw.notes ?? null, ...(raw.state ? { state: raw.state } : {}), ...(raw.fixtures ? { fixtures: raw.fixtures } : {}),
  };
}

export function validateCase(c, { menu }) {
  const errors = [];
  const at = (m) => errors.push(`${c.id ?? "(no id)"}: ${m}`);
  if (!c.id) at("missing id");
  if (!String(c.say ?? "").trim()) at("missing say");
  const j1 = c.expect?.J1;
  if (c.job === "J1") {
    if (!j1?.moves?.length) at("no acceptable move");
    for (const m of j1?.moves ?? []) if (!MOVES.has(m)) at(`unknown move ${m}`);
    for (const t of j1?.tiers ?? []) if (!TIERS.has(t)) at(`unknown tier ${t}`);
    for (const t of j1?.tools ?? []) if (!menu.has(t)) at(`unknown tool ${t}`);
    if (j1?.moves?.includes("tool") && !j1.tools?.length) at("move tool but no acceptable tool");
    if (j1?.moves?.includes("escalate") && !j1.tiers?.length) at("move escalate but no acceptable tier");
    if (j1?.args) { try { patternOf(j1.args); } catch { at(`args is not a valid regex: ${j1.args}`); } }
  }
  return errors;
}

const stratum = (c) => `${c.job}|${c.provenance}|${[...(c.expect?.J1?.moves ?? [])].sort().join("+")}`;

/** id → "practice" | "heldout". `previous` keeps earlier assignments fixed. */
export function makeSplit(cases, { seed = 20261008, heldoutShare = 1 / 3, previous = {} } = {}) {
  const next = rng(seed);
  const groups = cases.reduce((m, c) => m.set(stratum(c), [...(m.get(stratum(c)) ?? []), c.id]), new Map());
  const out = { ...previous };
  for (const key of [...groups.keys()].sort()) {
    const ids = groups.get(key).filter((id) => !(id in previous)).sort();
    const order = ids.map((id) => [next(), id]).sort((a, b) => a[0] - b[0]).map(([, id]) => id);
    const already = groups.get(key).filter((id) => previous[id] === "heldout").length;
    const target = Math.round(groups.get(key).length * heldoutShare);
    order.forEach((id, i) => { out[id] = i < Math.max(0, target - already) ? "heldout" : "practice"; });
  }
  return out;
}

export function selectCases(cases, split, part) {
  if (!PARTS.has(part)) throw new Error(`part must be practice or heldout, not ${part}`);
  return cases.filter((c) => split[c.id] === part);
}
