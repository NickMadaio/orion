/**
 * @param {object[]} rows - audit rows with at, decision, verb?, reason?
 * @param {{ from: number, to: number }} window - epoch ms bounds [from, to)
 * @returns {{ total: number, byDecision: object, byVerb: {verb,count}[], perDay: object, topRefusalReasons: {reason,count}[], skipped: number }}
 */
export function remoteAuditStats(rows, { from, to }) {
  const byDecision = {};
  const verbCounts = {};
  const perDay = {};
  const refusalReasonCounts = {};
  let total = 0;
  let skipped = 0;

  for (const row of rows) {
    // Validate decision
    if (typeof row.decision !== "string") {
      skipped++;
      continue;
    }

    // Parse timestamp
    const ts = Date.parse(row.at);
    if (Number.isNaN(ts)) {
      skipped++;
      continue;
    }

    // Window check: outside window is excluded, not skipped
    if (ts < from || ts >= to) {
      continue;
    }

    total++;

    // Count by decision
    byDecision[row.decision] = (byDecision[row.decision] || 0) + 1;

    // Count by verb — missing verb counts as "(none)"
    const verb = typeof row.verb === "string" ? row.verb : "(none)";
    verbCounts[verb] = (verbCounts[verb] || 0) + 1;

    // Per-day bucket using UTC date string
    const d = new Date(ts);
    const yyyyMmDd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    perDay[yyyyMmDd] = (perDay[yyyyMmDd] || 0) + 1;

    // Refusal reasons: only from refused/rejected/error with a string reason
    if (["refused", "rejected", "error"].includes(row.decision)) {
      if (typeof row.reason === "string") {
        const reason = row.reason.length > 120 ? row.reason.slice(0, 120) : row.reason;
        refusalReasonCounts[reason] = (refusalReasonCounts[reason] || 0) + 1;
      }
    }
  }

  // byVerb: top 10, sorted count desc then name asc
  const allVerbs = Object.entries(verbCounts).map(([verb, count]) => ({ verb, count }));
  allVerbs.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.verb < b.verb ? -1 : a.verb > b.verb ? 1 : 0;
  });
  const byVerb = allVerbs.slice(0, 10);

  // topRefusalReasons: top 5, sorted count desc then name asc
  const allReasons = Object.entries(refusalReasonCounts).map(([reason, count]) => ({ reason, count }));
  allReasons.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0;
  });
  const topRefusalReasons = allReasons.slice(0, 5);

  return { total, byDecision, byVerb, perDay, topRefusalReasons, skipped };
}
