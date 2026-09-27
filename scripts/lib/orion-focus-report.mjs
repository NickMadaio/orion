/**
 * Summarize focus sessions per day and in total.
 *
 * @param {object[]} rows  – focus-history JSONL records
 * @param {{ from: number, to: number }} window – inclusive start, exclusive end (ms)
 * @returns {{ totals: object, byDay: object, longest: object|null, skipped: number }}
 */
export function focusReport(rows, { from, to }) {
  const byDay = Object.create(null);
  let skipped = 0;
  let longestRow = null;
  let allSeconds = 0;

  for (const row of rows) {
    // Malformed: missing/invalid startedAt or non-finite servedFocusSeconds
    if (
      !row ||
      typeof row.startedAt !== "string" ||
      typeof row.servedFocusSeconds !== "number" ||
      !Number.isFinite(row.servedFocusSeconds)
    ) {
      skipped++;
      continue;
    }

    const startedMs = Date.parse(row.startedAt);
    if (Number.isNaN(startedMs)) {
      skipped++;
      continue;
    }

    // Outside window → excluded, not skipped
    if (startedMs < from || startedMs >= to) {
      continue;
    }

    const dayKey = new Date(startedMs).toISOString().slice(0, 10);

    if (!(dayKey in byDay)) {
      byDay[dayKey] = {
        sessions: 0,
        _seconds: 0,
        completedBlocks: 0,
        earlyEnds: 0,
      };
    }

    const day = byDay[dayKey];
    day.sessions++;
    day._seconds += row.servedFocusSeconds;
    allSeconds += row.servedFocusSeconds;
    day.completedBlocks += (typeof row.completedFocusBlocks === "number" ? row.completedFocusBlocks : 0);
    if (row.reason === "early") {
      day.earlyEnds++;
    }

    // Track longest session by servedFocusSeconds
    if (longestRow === null || row.servedFocusSeconds > longestRow.servedFocusSeconds) {
      longestRow = row;
    }
  }

  // Build output byDay with rounded focusMinutes
  const outputByDay = Object.create(null);
  for (const key of Object.keys(byDay)) {
    const day = byDay[key];
    outputByDay[key] = {
      sessions: day.sessions,
      focusMinutes: Math.round(day._seconds / 60 * 10) / 10,
      completedBlocks: day.completedBlocks,
      earlyEnds: day.earlyEnds,
    };
  }

  // Totals: sum all counted seconds, round once
  const totals = {
    sessions: Object.values(byDay).reduce((sum, d) => sum + d.sessions, 0),
    focusMinutes: Math.round(allSeconds / 60 * 10) / 10,
    completedBlocks: Object.values(byDay).reduce((sum, d) => sum + d.completedBlocks, 0),
    earlyEnds: Object.values(byDay).reduce((sum, d) => sum + d.earlyEnds, 0),
  };

  // Longest session output
  let longest = null;
  if (longestRow !== null) {
    longest = {
      startedAt: longestRow.startedAt,
      minutes: Math.round(longestRow.servedFocusSeconds / 60 * 10) / 10,
      task: longestRow.task ?? "",
    };
  }

  return { totals, byDay: outputByDay, longest, skipped };
}
