// Focus time for the whole day (6 Oct 2026). Restarting a session made ORION
// report only the latest segment ("16 minutes" on a 2-hour day). This adds up
// every session in the history, early and abandoned ones included.

const finite = value => (Number.isFinite(Number(value)) ? Number(value) : 0);

export function focusToday(records, { dayKey, live } = {}) {
  if (!Array.isArray(records)) throw new TypeError("records must be a list");
  if (typeof dayKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) throw new TypeError("dayKey must be YYYY-MM-DD");
  const today = records.filter(r => r && r.dayKey === dayKey);
  const latest = today.reduce((best, r) => (!best || String(r.endedAt) > String(best.endedAt) ? r : best), null);
  const liveSeconds = live ? finite(live.servedFocusSeconds) : 0;
  const seconds = today.map(r => finite(r.servedFocusSeconds));
  return {
    dayKey,
    sessions: seconds.filter(s => s >= 60).length + (live ? 1 : 0),
    focusSeconds: seconds.reduce((a, b) => a + b, 0) + liveSeconds,
    restSeconds: today.reduce((a, r) => a + finite(r.servedRestSeconds), 0),
    latestSessionSeconds: live ? liveSeconds : latest ? finite(latest.servedFocusSeconds) : 0,
    longestSessionSeconds: Math.max(0, liveSeconds, ...seconds),
  };
}

function span(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
}

export function formatFocusToday(total) {
  if (!total || total.focusSeconds < 30) return "No focus time yet today.";
  const sessions = `${total.sessions} session${total.sessions === 1 ? "" : "s"}`;
  return `Focused today: ${span(total.focusSeconds)} across ${sessions} (latest ${span(total.latestSessionSeconds)}).`;
}
