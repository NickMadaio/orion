// The first thing ORION says each morning (tighten-orion/morning-brief).
// Written by Claude after Qwen's run stopped, 2026-09-30.
export function clock12(minute) {
  const m = ((minute % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, "0");
  return `${h % 12 || 12}:${mm} ${h < 12 ? "AM" : "PM"}`;
}

const toUTC = (date) => { const [y, mo, d] = date.split("-").map(Number); return Date.UTC(y, mo - 1, d); };
const shortTitle = (title) => String(title).replace(/^DUE \d{1,2}:\d{2} — /, "");
const oneDecimal = (n) => String(Math.round(n * 10) / 10);

export function morningBrief(facts) {
  if (!facts || typeof facts !== "object" || !facts.now || !Array.isArray(facts.blocks)) {
    throw new TypeError("morningBrief needs now and blocks");
  }
  const { now, blocks, deadlines = [], sleep = null, weather = null, sideProjectLabel = null } = facts;
  const parts = [];
  if (sleep && typeof sleep.hours === "number" && sleep.hours < 6) parts.push({ key: "sleep", text: `Short night — ${oneDecimal(sleep.hours)}h.` });
  else if (sleep && typeof sleep.recovery === "number" && sleep.recovery < 34) parts.push({ key: "sleep", text: `Recovery's low (${sleep.recovery}%) — go easy.` });

  const fixedAhead = [...blocks].filter((b) => b.fixed && b.start > now.minute).sort((a, b) => a.start - b.start);
  parts.push({ key: "first", text: fixedAhead.length ? `${fixedAhead[0].title} at ${clock12(fixedAhead[0].start)}.` : "Nothing fixed today." });
  const lastFixed = fixedAhead.reduce((latest, b) => (latest === null || b.end > latest.end ? b : latest), null);
  if (fixedAhead.length >= 2) parts.push({ key: "shape", text: `${fixedAhead.length} things fixed, last ends ${clock12(lastFixed.end)}.` });

  const nearest = [...deadlines]
    .map((d) => ({ ...d, away: Math.round((toUTC(d.date) - toUTC(now.date)) / 86_400_000) }))
    .filter((d) => d.away >= 0 && d.away <= 7)
    .sort((a, b) => a.away - b.away || String(a.title).localeCompare(String(b.title)))[0];
  if (nearest) {
    const title = shortTitle(nearest.title);
    parts.push({ key: "deadline", text: nearest.away === 0 ? `${title} is today.` : nearest.away === 1 ? `${title} is tomorrow.` : `${title} in ${nearest.away} days.` });
  }
  if (!blocks.some((b) => b.kind === "side_project")) {
    const label = sideProjectLabel ?? "Side project";
    const after = lastFixed ? clock12(lastFixed.end) : "1:00 PM";
    parts.push({ key: "side", text: `${label} hour isn't booked — want it after ${after}?` });
  }
  if (weather && typeof weather.rainChance === "number" && weather.rainChance >= 50) parts.push({ key: "weather", text: "Rain likely — take a jacket." });

  let kept = parts;
  for (const drop of ["weather", "side", "shape"]) {
    if (kept.map((p) => p.text).join(" ").length <= 300) break;
    kept = kept.filter((p) => p.key !== drop);
  }
  let text = kept.map((p) => p.text).join(" ");
  if (text.length > 300) text = `${text.slice(0, 297)}…`;
  return { text, parts: kept.map((p) => p.text) };
}
