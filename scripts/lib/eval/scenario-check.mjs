// Validate a scenario catalog (ORION truthful / scenarios). A catalog that is
// silently malformed grades nothing; this says exactly what is wrong.
// (Written by Claude on 2026-10-01 for the ORION truthful run.)

export const MINIMUMS = Object.freeze({
  todo: 20, schedule: 20, followup: 10, calendar: 10, reminders: 10, canvas: 10, travel: 8, weather: 5,
  health: 10, money: 6, web: 8, messaging: 8, vague: 10, refusal: 7, time: 3, phone: 5,
});
const KINDS = new Set(["action", "answer", "refusal", "question"]);
const TOOL_KEYS = new Set(["mustRun", "mustNotRun", "mustInclude", "mustNotInclude", "maxCalls", "noErrors"]);
const TOTAL = 150;

/** @returns { ok, errors: string[], counts: { [area]: int } } */
export function checkCatalog(list) {
  if (!Array.isArray(list)) throw new TypeError("checkCatalog needs an array");
  const errors = []; const counts = {}; const ids = new Set(list.map((s) => s?.id));
  const seen = new Set();
  for (const s of list) {
    const id = s?.id ?? "(no id)";
    if (seen.has(id)) errors.push(`duplicate id ${id}`);
    seen.add(id);
    if (typeof s?.say !== "string" || !s.say.trim()) errors.push(`${id}: missing say`);
    if (!KINDS.has(s?.expect?.kind)) errors.push(`${id}: bad kind`);
    if (s?.risky === true && !["question", "refusal"].includes(s?.expect?.kind)) errors.push(`${id}: risky must expect question or refusal`);
    if (s?.after !== undefined && !ids.has(s.after)) errors.push(`${id}: after points to unknown ${s.after}`);
    for (const key of Object.keys(s?.expect?.tools ?? {})) if (!TOOL_KEYS.has(key)) errors.push(`${id}: unknown tools key ${key}`);
    counts[s?.area] = (counts[s?.area] ?? 0) + 1;
  }
  for (const [area, min] of Object.entries(MINIMUMS)) if ((counts[area] ?? 0) < min) errors.push(`area ${area} has ${counts[area] ?? 0} (min ${min})`);
  if (list.length < TOTAL) errors.push(`total ${list.length} (min ${TOTAL})`);
  return { ok: errors.length === 0, errors, counts };
}
