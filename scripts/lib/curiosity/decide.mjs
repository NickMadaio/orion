// Blank asks (spec 3.4.2): nothing is on the calendar and nothing is known about what he is doing. Pure.
// One of these is a mismatch type in the loop; this module keeps the eligibility table and the choice of question.
import { blankAllowed, hasAsked, daysAtCell } from "./ledger.mjs";
import { words, topTodo } from "./words.mjs";

const MIN = 60_000;
const HOME_GAP_MIN = 30, AWAY_DWELL = 20, SAVE_DWELL = 90;
const dwellMinutes = (loc, now) => (Date.parse(loc?.since) ? Math.floor((now - Date.parse(loc.since)) / MIN) : null);
const slug = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The conditions every blank ask needs (spec 3.4.2). Returns the reason it may not be asked, or null. */
// He just told ORION what he did (a `log`): asking "what are you up to?" over it, or offering the thing he logged, is the 2026-10-19 bug.
export const JUST_LOGGED_MINUTES = 45;
const norm = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const sameTitle = (a, b) => { const x = norm(a).split(" ").filter(Boolean), y = norm(b).split(" ").filter(Boolean); const [s, l] = x.length <= y.length ? [x, y] : [y, x]; return s.length > 0 && s.every((w) => l.includes(w)); };
export function blankBlocker(aw, { minute, ledger, turns = [], now, from = 9 * 60, to = 22 * 60, day = [] }) {
  if (day.some((b) => b.logged && b.start <= minute && b.end > minute - JUST_LOGGED_MINUTES)) return "just-logged";
  if (aw.sleep?.state !== "awake" || aw.sleep?.inWindow) return "sleep";
  if (!["none", "unknown"].includes(aw.session?.state)) return "session";
  if (aw.calendar?.state !== "ok") return "calendar-unknown";
  if (aw.calendar.now || aw.calendar.travelNow) return "busy";
  if (minute < from || minute >= to) return "hours";
  if (!blankAllowed(ledger, { turns, now })) return "backoff";
  return null;
}

/** Start of the free stretch he is in: the end of the last block that finished, else midnight. */
const gapStart = (day, minute) => Math.max(0, ...(day ?? []).filter((b) => b.end <= minute).map((b) => b.end));

/**
 * @param aw      awareness (C1, after readAwareness)
 * @param ctx     { minute, date, day, todos, ledger, turns, now (ms) }
 * @returns { key, type, text, ask } | null; `ask` is the tag orion-reach stores (C4)
 */
export function blankAsk(aw, ctx) {
  const { minute, date, day = [], todos = [], travel = [], ledger, turns = [], now } = ctx;
  const loc = aw.location ?? {};
  const atHome = aw.derived?.atHome;
  const blocker = blankBlocker(aw, { minute, ledger, turns, now, day });
  const dwell = dwellMinutes(loc, now);
  const away = loc.state === "elsewhere" || loc.state === "known";
  const make = (type, key, text, extra = {}) => ({ key, type, text, ask: { type, window: { date, start: extra.from ?? minute, end: null }, place: loc.placeId ?? null, cell: loc.cell ?? null } });

  // save-place is its own question about a long stay, not spaced by the blank gap; it is asked once per cell.
  if (loc.state === "elsewhere" && loc.cell && dwell !== null && !hasAsked(ledger, `save-place-${loc.cell}`)
      && (dwell >= SAVE_DWELL || daysAtCell(ledger, loc.cell) >= 2 && dwell >= AWAY_DWELL)
      && !blankBlockerIgnoringSpacing(aw, ctx)) {
    return make("save-place", `save-place-${loc.cell}`, words.savePlace());
  }
  if (blocker) return null;

  if (atHome === true && loc.state === "home") {
    // the gap ends at the next block OR the start of the next commute, whichever is first (2026-10-13: "free until 1:30"
    // was said 44 min before a 12:45 departure)
    const wall = travel.filter((w) => w.start > minute).sort((a, b) => a.start - b.start)[0];
    const limit = Math.min(aw.calendar.freeUntil ?? Infinity, wall?.start ?? Infinity);
    const free = Number.isFinite(limit) ? limit : null;
    if (free != null && free - minute < HOME_GAP_MIN) return null;
    const from = gapStart(day, minute);
    const key = `home-gap-${date}-${from}`;
    if (hasAsked(ledger, key)) return null;
    // never offered: a to-do he already logged doing today ("I could put CS Lab there" an hour after `log "cs lab"`)
    const todo = topTodo(todos.filter((t) => !day.some((b) => b.logged && sameTitle(b.title, t.title))), date);
    return make("home-gap", key, words.homeGap({ until: free, todo }), { from });
  }
  if (away && dwell !== null && dwell >= AWAY_DWELL) {
    const stay = `${date}-${loc.cell ?? loc.placeId}-${slug(loc.since)}`;
    if (loc.state === "known") {
      const key = `away-${stay}`;
      return hasAsked(ledger, key) ? null : make("away-gap", key, words.awayGap({ place: loc.placeId }), { from: Math.max(0, minute - dwell) });
    }
    const known = ledger.asks.some((a) => a.cell === loc.cell && a.type === "unknown-place" && a.answeredAt && a.outcome !== "declined");
    const key = `${known ? "away" : "unknown-place"}-${stay}`;
    if (hasAsked(ledger, key)) return null;
    return known ? make("away-gap", key, words.awayGap({}), { from: Math.max(0, minute - dwell) })
      : make("unknown-place", key, words.unknownPlace(), { from: Math.max(0, minute - dwell) });
  }
  return null;
}

/** The gates of blankBlocker minus the spacing and the "something is on" rule, for the save-place question. */
function blankBlockerIgnoringSpacing(aw, { minute, ledger, now }) {
  if (ledger.pausedUntil && Date.parse(ledger.pausedUntil) > now) return "paused";
  if (aw.sleep?.state !== "awake" || aw.sleep?.inWindow) return "sleep";
  if (!["none", "unknown"].includes(aw.session?.state)) return "session";
  if (aw.calendar?.state !== "ok") return "calendar-unknown";
  return minute < 9 * 60 || minute >= 22 * 60 ? "hours" : null;
}

/**
 * The evening question (spec 3.4.2 fill-blank): the largest unanswered blank today over 45 min, once,
 * from 20:00 to bedtime minus 30. `blanks`: [{ start, end }] from day-review.blanks.
 */
export function fillBlankAsk(aw, { minute, date, bed, blanks, ledger, turns = [], now }) {
  if (minute < 20 * 60 || minute > bed - 30) return null;
  const reason = blankBlocker(aw, { minute, ledger, turns, now, from: 0, to: 24 * 60 });
  if (reason && reason !== "busy" || ledger.asks.some((a) => a.type === "fill-blank" && a.window?.date === date && !a.dropped)) return null;
  const big = [...blanks].filter((b) => b.end - b.start > 45).sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
  if (!big) return null;
  return { key: `fill-blank-${date}`, type: "fill-blank", text: words.fillBlank({ from: big.start, to: big.end }),
    ask: { type: "fill-blank", window: { date, start: big.start, end: big.end }, place: null, cell: null } };
}
