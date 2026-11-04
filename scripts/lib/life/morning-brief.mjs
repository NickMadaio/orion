// The first thing ORION says each morning (tighten-orion/morning-brief).
// Written by Claude after Qwen's run stopped, 2026-09-30. 2026-10-30: the top of the list is recomputed each day from real
// deadlines and rank, the same item cannot head it three days running without an honest "this keeps slipping" and a
// choice, repeated lines collapse, and the brief carries what the night did to the day and what ORION cannot see.
export function clock12(minute) {
  const m = ((minute % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, "0");
  return `${h % 12 || 12}:${mm} ${h < 12 ? "AM" : "PM"}`;
}

const MAX_LENGTH = 420;
const toUTC = (date) => { const [y, mo, d] = date.split("-").map(Number); return Date.UTC(y, mo - 1, d); };
const shortTitle = (title) => String(title).replace(/^DUE \d{1,2}:\d{2} — /, "").replace(/\s+/g, " ").trim();
const oneDecimal = (n) => String(Math.round(n * 10) / 10);
/** The same item written two ways ("DUE 13:00 — Panopto presentation", "panopto presentation") is one key. */
export const itemKey = (title) => shortTitle(title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const RANK = { must: 0, high: 1, medium: 2, low: 3 };
const listOf = (items) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

const unique = (list, keyOf) => { const seen = new Set(); return list.filter((x) => { const k = keyOf(x); return !seen.has(k) && seen.add(k); }); };

/**
 * What heads the list today: due soonest, then ranked, then as given; waiting items are not candidates.
 * @param candidates [{ title, due?: "YYYY-MM-DD", rank?, waiting? }]
 * @param history    [{ date, head }] earlier briefs, newest first (head is an itemKey)
 * @returns {{ head: {title,key}|null, streak: number, text: string|null }}
 */
export function topOfList({ candidates = [], history = [], now }) {
  const open = unique(candidates.filter((c) => c && c.title && !c.waiting), (c) => itemKey(c.title));
  const due = (c) => (c.due ? Math.round((toUTC(c.due) - toUTC(now.date)) / 86_400_000) : 999);
  // A candidate that carries a `score` (lib/life/todo-rank.mjs: priority, deadline, coursework) is ordered by it; without one, due soonest
  // then rank. Due soonest alone put an 11-day-stale medium "finish resume" first for days (2026-11-04).
  const scored = open.some((c) => typeof c.score === "number");
  const ranked = open.map((c, i) => ({ c, i })).sort((a, b) => (scored ? (b.c.score ?? -1) - (a.c.score ?? -1) : 0) || due(a.c) - due(b.c) || (RANK[a.c.rank] ?? 2) - (RANK[b.c.rank] ?? 2) || a.i - b.i).map((x) => x.c);
  if (!ranked.length) return { head: null, streak: 0, text: null };
  const head = ranked[0]; const key = itemKey(head.title);
  let streak = 0;
  for (const h of history) { if (h?.head === key) streak += 1; else break; }
  const title = shortTitle(head.title);
  const text = streak >= 2
    ? `${title} has been first on my list ${streak + 1} days running and hasn't moved - this keeps slipping. Give it a time today, or drop it?`
    : `First on my list: ${title}.`;
  return { head: { title, key }, streak, text };
}

export function morningBrief(facts) {
  if (!facts || typeof facts !== "object" || !facts.now || !Array.isArray(facts.blocks)) {
    throw new TypeError("morningBrief needs now and blocks");
  }
  const { now, blocks, deadlines = [], sleep = null, weather = null, sideProjectLabel = null,
    candidates = null, history = [], proposal = null, sensorNotices = [], gym = null } = facts;
  const parts = [];
  if (sleep && typeof sleep.hours === "number" && sleep.hours < 6) parts.push({ key: "sleep", text: `Short night — ${oneDecimal(sleep.hours)}h.` });
  else if (sleep && typeof sleep.recovery === "number" && sleep.recovery < 34) parts.push({ key: "sleep", text: `Recovery's low (${sleep.recovery}%) — go easy.` });
  if (proposal) parts.push({ key: "proposal", text: proposal });

  const fixedAhead = [...blocks].filter((b) => b.fixed && b.start > now.minute).sort((a, b) => a.start - b.start);
  // A proposal that already names the first fixed thing and its time says it; the brief does not say it twice.
  const proposalHasFirst = proposal && fixedAhead.length && proposal.includes(`${fixedAhead[0].title} at ${clock12(fixedAhead[0].start)}`);
  if (!proposalHasFirst) parts.push({ key: "first", text: fixedAhead.length ? `${fixedAhead[0].title} at ${clock12(fixedAhead[0].start)}.` : "Nothing fixed today." });
  const lastFixed = fixedAhead.reduce((latest, b) => (latest === null || b.end > latest.end ? b : latest), null);
  if (fixedAhead.length >= 2) parts.push({ key: "shape", text: `${fixedAhead.length} things fixed, last ends ${clock12(lastFixed.end)}.` });

  const dated = unique(deadlines.map((d) => ({ ...d, away: Math.round((toUTC(d.date) - toUTC(now.date)) / 86_400_000) }))
    .filter((d) => d.away >= 0 && d.away <= 7), (d) => `${itemKey(d.title)}|${d.date}`)
    .sort((a, b) => a.away - b.away || String(a.title).localeCompare(String(b.title)));
  const nearest = dated[0];
  let deadlineKeys = [];
  if (nearest) {
    const sameDay = dated.filter((d) => d.away === nearest.away);
    const titles = sameDay.map((d) => shortTitle(d.title));
    deadlineKeys = sameDay.map((d) => itemKey(d.title));
    const when = nearest.away === 0 ? "today" : nearest.away === 1 ? "tomorrow" : `in ${nearest.away} days`;
    const text = titles.length > 1 ? `${listOf(titles)} are due ${when}.` : nearest.away <= 1 ? `${titles[0]} is ${when}.` : `${titles[0]} ${when}.`;
    parts.push({ key: "deadline", text });
  }
  let head = null;
  if (candidates) {
    const top = topOfList({ candidates, history, now });
    head = top.head;
    // A deadline already said above is not said a second time as the head of the list, unless it keeps slipping.
    if (top.text && (top.streak >= 2 || !deadlineKeys.includes(top.head.key))) parts.push({ key: "top", text: top.text });
  }
  if (gym) parts.push({ key: "gym", text: `Gym at ${clock12(gym.start)}, ${gym.minutes} min${gym.easy ? ", easy" : ""}.` });
  if (!blocks.some((b) => b.kind === "side_project")) {
    const label = sideProjectLabel ?? "Side project";
    const after = lastFixed ? clock12(lastFixed.end) : "1:00 PM";
    parts.push({ key: "side", text: `${label} hour isn't booked — want it after ${after}?` });
  }
  if (sensorNotices.length) parts.push({ key: "sensors", text: sensorNotices.map((n) => `${n[0].toUpperCase()}${n.slice(1)}.`).join(" ") });
  if (weather && typeof weather.rainChance === "number" && weather.rainChance >= 50) parts.push({ key: "weather", text: "Rain likely — take a jacket." });

  let kept = unique(parts, (p) => itemKey(p.text));
  for (const drop of ["weather", "side", "gym", "shape"]) {
    if (kept.map((p) => p.text).join(" ").length <= MAX_LENGTH) break;
    kept = kept.filter((p) => p.key !== drop);
  }
  let text = kept.map((p) => p.text).join(" ");
  if (text.length > MAX_LENGTH) text = `${text.slice(0, MAX_LENGTH - 3)}…`;
  return { text, parts: kept.map((p) => p.text), head };
}
