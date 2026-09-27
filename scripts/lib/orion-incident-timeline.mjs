// scripts/lib/orion-incident-timeline.mjs
/**
 * Build a single incident timeline from four audit log streams.
 *
 * @param {{ permission: object[], remote: object[], repair: object[], location: object[] }} logs
 * @param {{ since?: number }} options
 * @returns {{ events: { at: number, iso: string, source: string, summary: string, severity: string }[], skipped: number }}
 */
export function buildIncidentTimeline(logs, options = {}) {
  const { permission = [], remote = [], repair = [], location = [] } = logs;
  const { since = 0 } = options;

  /** @type {{ at: number, iso: string, source: string, summary: string, severity: string }[]} */
  const events = [];
  let skipped = 0;

  // Permission rows
  for (const row of permission) {
    const ms = parseMs(row.changedAt);
    if (ms === null) { skipped++; continue; }
    if (ms < since) continue;
    const prevProfile = row.previous?.profile ?? "unknown";
    const nextProfile = row.next?.profile ?? "unknown";
    events.push({
      at: ms,
      iso: new Date(ms).toISOString(),
      source: "permission",
      summary: `permission ${prevProfile} -> ${nextProfile}`,
      severity: "high",
    });
  }

  // Remote rows
  for (const row of remote) {
    const ms = parseMs(row.at);
    if (ms === null) { skipped++; continue; }
    if (ms < since) continue;
    const decision = row.decision ?? "unknown";
    const verb = row.verb ?? "?";
    const text = String(row.text ?? "").slice(0, 80);
    let severity;
    if (decision === "refused" || decision === "rejected" || decision === "error") {
      severity = "medium";
    } else {
      severity = "low";
    }
    events.push({
      at: ms,
      iso: new Date(ms).toISOString(),
      source: "remote",
      summary: `${decision} ${verb}: ${text}`,
      severity,
    });
  }

  // Repair rows
  for (const row of repair) {
    const ms = parseMs(row.at);
    if (ms === null) { skipped++; continue; }
    if (ms < since) continue;
    events.push({
      at: ms,
      iso: new Date(ms).toISOString(),
      source: "repair",
      summary: `${row.kind} ${row.surface} ${row.target} -> ${row.outcome}`,
      severity: "high",
    });
  }

  // Location rows
  for (const row of location) {
    const ms = parseMs(row.at);
    if (ms === null) { skipped++; continue; }
    if (ms < since) continue;
    events.push({
      at: ms,
      iso: new Date(ms).toISOString(),
      source: "location",
      summary: `location ${row.action}`,
      severity: "low",
    });
  }

  // Sort ascending by time, then source name, then summary
  events.sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at;
    if (a.source < b.source) return -1;
    if (a.source > b.source) return 1;
    if (a.summary < b.summary) return -1;
    if (a.summary > b.summary) return 1;
    return 0;
  });

  return { events, skipped };
}

/**
 * Parse an ISO string or numeric timestamp into milliseconds.
 * Returns null if unparseable.
 */
function parseMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      return d.getTime();
    }
  }
  return null;
}
