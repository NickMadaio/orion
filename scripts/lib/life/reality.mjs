// Reality replaces the plan, then replan by weight (2026-10-16, spec 3.5 step 5 and 3.8).
// Pure planning: given the day and what he really did, say what to write on the calendar, which
// slips to record and how the rest of today is re-weighed. orion-reschedule does the writing.
import { replan } from "./replan.mjs";
import { weightOf } from "./priority.mjs";
import { minimumFor } from "./lengths.mjs";

const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const isWall = (b) => b.fixed && !b.pinned;               // his own plans and classes; a pinned block is ORION's
const MIN_PIECE = 5;

export const LOG_EARLIEST = 4 * 60;                       // nothing before 04:00
export const LOG_AHEAD = 180;                              // ...or more than 3 h past now

/** Free pieces of [from, to] once his fixed plans are cut out (the logged event never overwrites one). */
export function logSegments(blocks, from, to) {
  const walls = blocks.filter((b) => isWall(b) && overlaps(b, { start: from, end: to })).sort((a, b) => a.start - b.start);
  const out = []; let cursor = from;
  for (const w of walls) {
    if (w.start - cursor >= MIN_PIECE) out.push({ start: cursor, end: w.start });
    cursor = Math.max(cursor, w.end);
  }
  if (to - cursor >= MIN_PIECE) out.push({ start: cursor, end: to });
  return out;
}

/** What is left of a displaced block once the logged interval is cut out: 0, 1 or 2 pieces. */
function leftovers(block, from, to) {
  return [{ start: block.start, end: Math.min(block.end, from) }, { start: Math.max(block.start, to), end: block.end }]
    .filter((p) => p.end - p.start >= MIN_PIECE && p.end > p.start && !(p.start === block.start && p.end === block.end && overlaps(block, { start: from, end: to })));
}

const slipRow = ({ date, at, block, missed, replacedBy, reason, txn, config }) => ({
  date, at, planned: { title: block.title, start: block.start, end: block.end, kind: block.kind, rank: weightOf(block, config).rank },
  missedMinutes: missed, replacedBy, reason, ...(txn ? { txn } : {}),
});

/**
 * Re-weigh the rest of today with the displaced items put back by weight.
 * @returns { result, entries } where entries tell each displaced item's fate
 */
function reweigh({ blocks, displaced, now, window, soft, config, buffer, walls = [] }) {
  const reenter = displaced.filter((d) => weightOf(d.block, config).rank !== "low");   // a missed break is not re-entered
  const result = replan([...blocks, ...walls], { now, window, soft, add: [], rebuild: true, buffer, keepFree: 0, displaced: reenter, config });
  return { result, reenter };
}

/**
 * Log what he really did over the plan.
 * @param blocks  the day's blocks; @param interval { from, to } minutes today
 * @param opts    { title, kind, date, now, window, soft, config, buffer, instead?: block, replan = true, txn, at }
 * @returns { refused?: string, created, moves, removed, slips, summary, lines }
 */
export function planLog(blocks, interval, opts) {
  const { title, kind, date, now, window, soft = [], config = {}, buffer = 0, instead = null, reweighDay = true, txn, at } = opts;
  const { from, to } = interval;
  const span = { start: from, end: to };
  const segments = logSegments(blocks, from, to);
  if (!segments.length) return { refused: `${title} ${hh(from)}–${hh(to)} is covered by his own plans, so there is nothing to log` };
  const done = blocks.find((b) => b.logged && overlaps(b, span));
  if (done) return { refused: `${done.title} ${hh(done.start)}–${hh(done.end)} is already logged over that time — ask him which one is right` };

  const overlapped = blocks.filter((b) => !isWall(b) && overlaps(b, span));
  const named = instead && !overlapped.includes(instead) && instead.end <= now && !isWall(instead) ? [instead] : [];
  const targets = [...overlapped, ...named];

  const created = segments.map((s, i) => ({ id: `logged-${i}`, title, kind, date, start: s.start, end: s.end, fixed: false, source: "orion", tags: ["logged"] }));
  const moves = []; const removed = []; const displaced = []; const extra = [];
  for (const b of targets) {
    const inside = Math.max(0, Math.min(b.end, to) - Math.max(b.start, from));
    const missed = Math.min(b.end - b.start, Math.max(inside || b.end - b.start, minimumFor(b.title, config.minimums ?? {})));
    displaced.push({ block: b, minutes: missed });
    const left = overlaps(b, span) ? leftovers(b, from, to) : [];
    if (!left.length) { removed.push(b); continue; }
    const [first, ...others] = left;
    moves.push({ id: b.id, title: b.title, from: b.start, to: first.start, toEnd: first.end });
    extra.push(...others.map((p, i) => ({ id: `rest-${b.id}-${i}`, title: b.title, kind: b.kind, date, start: p.start, end: p.end, fixed: false, source: "orion", tags: b.tags ?? [], ...(b.rank ? { rank: b.rank } : {}) })));
  }
  const gone = new Set(removed.map((b) => b.id));
  const moved = new Map(moves.map((m) => [m.id, m]));
  const kept = blocks.filter((b) => !gone.has(b.id)).map((b) => {
    const m = moved.get(b.id);
    return m ? { ...b, start: m.to, end: m.toEnd } : b;
  });
  const walls = [...created, ...extra].map((c) => ({ ...c, fixed: true }));

  const slips = []; const lines = []; const bumped = []; const placedAgain = []; const offToday = [];
  let allCreated = [...created, ...extra]; let allMoves = moves; let allRemoved = removed;
  if (reweighDay && displaced.length) {
    const { result } = reweigh({ blocks: kept, displaced, now, window, soft, config, buffer, walls });
    const byId = new Map(kept.map((b) => [b.id, b]));
    // Where each surviving block ends up, compared with the calendar as it was before this log.
    const final = new Map(result.blocks.map((b) => [b.id, b]));
    const gonePlanned = new Set(result.unplaced.filter((u) => !u.displaced).map((u) => u.id));
    allMoves = blocks.filter((b) => !gone.has(b.id) && !gonePlanned.has(b.id) && final.has(b.id) && (final.get(b.id).start !== b.start || final.get(b.id).end !== b.end))
      .map((b) => ({ id: b.id, title: b.title, from: b.start, to: final.get(b.id).start, toEnd: final.get(b.id).end }));
    const back = result.created.filter((c) => c.id.startsWith("displaced-"));
    allCreated = [...allCreated, ...back.map((c) => ({ ...c, tags: displacedTags(c, displaced) }))];
    for (const u of result.unplaced) {
      if (u.displaced) offToday.push(u);
      else if (byId.has(u.id)) { const b = blocks.find((x) => x.id === u.id) ?? byId.get(u.id); bumped.push(b); allRemoved = [...allRemoved, b]; }
    }
    placedAgain.push(...back);
    const why = displaced[0].block.title;
    for (const b of bumped) slips.push(slipRow({ date, at, block: b, missed: b.end - b.start, replacedBy: why, reason: `bumped:${why}`, txn, config }));
  }
  for (const d of displaced) {
    const off = offToday.some((u) => u.title === d.block.title);
    slips.push(slipRow({ date, at, block: d.block, missed: d.minutes, replacedBy: title, reason: off ? "no-room" : "reality", txn, config }));
  }
  return { created: allCreated, moves: allMoves, removed: allRemoved, slips, bumped, placedAgain, offToday, displaced, interval,
    summary: logSummary({ title, segments, placedAgain, bumped, offToday, displaced }), lines };
}

function displacedTags(created, displaced) {
  const d = displaced[Number(String(created.id).replace("displaced-", ""))];
  return (d?.block.tags ?? []).filter((t) => t !== "logged");
}

/** The same re-weigh for a block that will not happen (cancelled, given up on): it leaves its slot and re-enters by weight. */
export function planDisplace(blocks, block, opts) {
  const { date, now, window, soft = [], config = {}, buffer = 0, why, txn, at } = opts;
  const missed = Math.min(block.end - block.start, Math.max(block.end - Math.max(block.start, now), minimumFor(block.title, config.minimums ?? {})));
  const displaced = [{ block, minutes: Math.max(MIN_PIECE, missed) }];
  const kept = blocks.filter((b) => b.id !== block.id);
  const { result } = reweigh({ blocks: kept, displaced, now, window, soft, config, buffer });
  const byId = new Map(kept.map((b) => [b.id, b]));
  const back = result.created.filter((c) => c.id.startsWith("displaced-")).map((c) => ({ ...c, tags: block.tags ?? [], ...(block.rank ? { rank: block.rank } : {}) }));
  const bumped = result.unplaced.filter((u) => !u.displaced && byId.has(u.id)).map((u) => byId.get(u.id));
  const off = result.unplaced.some((u) => u.displaced);
  const slips = [...bumped.map((b) => slipRow({ date, at, block: b, missed: b.end - b.start, replacedBy: block.title, reason: `bumped:${block.title}`, txn, config })),
    slipRow({ date, at, block, missed: displaced[0].minutes, replacedBy: null, reason: off ? "no-room" : why, txn, config })];
  return { created: back, moves: result.moves.filter((m) => byId.has(m.id)), removed: [block, ...bumped], slips, bumped, placedAgain: back, offToday: off ? [block] : [],
    summary: displaceSummary({ block, back, bumped, off, why }) };
}

const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
/** 12-hour short form, spoken the way he says it: 14:00 → "2", 19:30 → "7:30". */
const say = (m) => { const h = Math.floor(m / 60) % 12 || 12; return m % 60 ? `${h}:${String(m % 60).padStart(2, "0")}` : `${h}`; };
const sayRange = (s, e) => `${say(s)}-${say(e)}`;
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const list = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

function logSummary({ title, segments, placedAgain, bumped, offToday, displaced }) {
  const first = `Logged ${title} ${segments.map((s) => sayRange(s.start, s.end)).join(", ")}.`;
  const parts = [
    ...placedAgain.map((c) => `${cap(c.title)} moved to ${sayRange(c.start, c.end)}`),
    ...offToday.map((u) => `${cap(u.title)} has no room today`),
    ...bumped.map((b) => `${b.title} is off today`),
  ];
  void displaced;
  return parts.length ? `${first} ${parts.join("; ")}.` : first;
}

function displaceSummary({ block, back, bumped, off, why }) {
  const lead = why === "gave-up" ? `Gave up on ${block.title}.` : why === "cancel" ? `Cancelled ${block.title}.` : `${cap(block.title)} will not happen.`;
  const parts = [...back.map((c) => `${cap(c.title)} moved to ${sayRange(c.start, c.end)}`), ...(off ? [`${cap(block.title)} has no room today`] : []),
    ...bumped.map((b) => `${b.title} is off today`)];
  return parts.length ? `${lead} ${parts.join("; ")}.` : lead;
}

/** Evening of today: anchors due and not yet on the calendar (kind match, any time), as asks for the rebuild replan. */
export function dueAnchors(blocks, anchors, weekday) {
  return anchors.filter((a) => a.days.includes(weekday) && !blocks.some((b) => b.kind === a.kind))
    .map((a) => ({ title: a.title, kind: a.kind, minutes: a.minutes, rank: a.rank ?? "must", tags: ["anchor"], anchor: true }));
}
export { hh as clock, say as saySpoken, slipRow };
