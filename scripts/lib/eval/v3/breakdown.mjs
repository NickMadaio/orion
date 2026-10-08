// What each model gets right and wrong (Nick, 2026-10-08): per run, pass rates
// by kind of request × expected move (or tool family for tool jobs), a
// confusion table of expected vs chosen moves, and the commonest failure
// reasons. Drives model-specific prompt engineering.
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)
import { jobOf } from "./jobs.mjs";

const reasonKey = (r) => String(r).replace(/ not in .*| do not match .*|".*"|\d+ calls \(max \d+\)/, (m) => (/calls/.test(m) ? "too many calls" : "")).replace(/: .*/, "").trim();

export function categoryOf(c) {
  const kind = jobOf(c.say ?? c.turns?.[0] ?? "");
  if (c.job === "J1") return `${kind} · ${c.expect.J1.moves[0]}`;
  const family = String(c.expect?.calls?.[0]?.[0] ?? "").split("|")[0].replace(/\W/g, "") || "no tool";
  return `${kind} · ${family}`;
}

export function breakdown(trials, casesById) {
  const byCategory = {}; const byExpected = {}; const confusion = {}; const reasons = {};
  for (const t of trials) {
    const c = casesById.get(t.id);
    if (!c) continue;
    const cat = categoryOf(c);
    const row = byCategory[cat] ?? { n: 0, pass: 0, failing: [] };
    byCategory[cat] = { n: row.n + 1, pass: row.pass + (t.pass ? 1 : 0), failing: t.pass ? row.failing : [...row.failing, t.id] };
    if (c.job === "J1") {
      const exp = c.expect.J1.moves[0];
      byExpected[exp] = { n: (byExpected[exp]?.n ?? 0) + 1, pass: (byExpected[exp]?.pass ?? 0) + (t.pass ? 1 : 0) };
      confusion[exp] = { ...(confusion[exp] ?? {}), [t.move ?? "invalid"]: (confusion[exp]?.[t.move ?? "invalid"] ?? 0) + 1 };
    }
    for (const r of t.reasons ?? []) reasons[reasonKey(r)] = (reasons[reasonKey(r)] ?? 0) + 1;
  }
  return { byCategory, byExpected, confusion, reasons };
}

/** Markdown for one job across models: { model: breakdown } → text. */
export function breakdownMarkdown(job, perModel) {
  const models = Object.keys(perModel);
  const cats = [...new Set(models.flatMap((m) => Object.keys(perModel[m].byCategory)))].sort();
  const cell = (r) => (r ? `${r.pass}/${r.n}` : "—");
  const out = [`## ${job} — right and wrong by category`, "", `| Category | ${models.join(" | ")} |`, `|---|${models.map(() => "---").join("|")}|`,
    ...cats.map((cat) => `| ${cat} | ${models.map((m) => cell(perModel[m].byCategory[cat])).join(" | ")} |`), ""];
  for (const m of models) {
    const b = perModel[m];
    out.push(`### ${m}`, "", `Top failure reasons: ${Object.entries(b.reasons).sort((a, c) => c[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ×${v}`).join(", ") || "none"}`);
    if (Object.keys(b.confusion).length) out.push("", "Expected → chosen: " + Object.entries(b.confusion).map(([e, row]) => `${e}→{${Object.entries(row).map(([k, v]) => `${k}:${v}`).join(", ")}}`).join("; "));
    out.push("");
  }
  return out.join("\n");
}
