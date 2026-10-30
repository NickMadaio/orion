// Human text for facts. Times are 12-hour ("8:11 PM", never "20:11"): USER.md, 2026-09-29.

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Minutes after midnight (may run past 24 h for an evening that ends tomorrow) as "11:26 PM". */
export function clockOfMinutes(minutes) {
  if (!Number.isFinite(minutes)) return "?";
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(mm).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Minutes after local midnight in `zone` for an instant. */
export function localMinutes(iso, zone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone || "UTC", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(d);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  return get("hour") * 60 + get("minute");
}

/** "Fri 30 Oct, 7:25 PM" in `zone`. */
export function dayAndTime(iso, zone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso ?? "unknown");
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: zone || "UTC", weekday: "short", day: "numeric", month: "short" }).format(d);
  return `${day}, ${clockOfMinutes(localMinutes(iso, zone))}`;
}

/** The median clock time of instants that straddle midnight (bedtimes): measured from noon so 11 PM and 1 AM average to midnight. */
export function medianClock(isos, zone) {
  const fromNoon = isos.map((iso) => localMinutes(iso, zone)).filter((m) => m != null).map((m) => (m + 720) % 1440).sort((a, b) => a - b);
  if (!fromNoon.length) return null;
  const mid = fromNoon.length % 2 ? fromNoon[(fromNoon.length - 1) / 2] : (fromNoon[fromNoon.length / 2 - 1] + fromNoon[fromNoon.length / 2]) / 2;
  return (mid + 720) % 1440;
}

export const round1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
