// Real breaks in the day (2026-11-04). Nick: "He also doesn't give me a single break." The planner packed six blocks edge to edge
// from 13:20 to 20:15 with no lunch. After the day is laid out this adds, as visible blocks:
//   - a meal in the lunch and dinner windows when none is there,
//   - a short transition right before a class when ORION work runs up to it,
//   - a break (10 to 15 min) after each stretch of work (default 60 min), never more than maxWorkMinutes without one.
// Later movable blocks slide just far enough to make room; classes, plans with people, pinned times and anything before `now` never
// move. When a wall stops a break it is skipped and reported (`unsatisfied`), never forced into an overlap. Pure: nothing is mutated.

export const BREAK_DEFAULTS = Object.freeze({
  enabled: true,
  breakMinutes: 15,        // a break after a stretch of work
  minBreakMinutes: 10,     // the shortest break worth the name (a 5-minute gap is not one)
  breakAfterMinutes: 60,   // take it once this much work is behind him
  maxWorkMinutes: 120,     // never stack more than this without one
  classBufferMinutes: 10,  // a transition right before a class
  lunch: Object.freeze({ from: "12:00", to: "14:30", minutes: 45 }),
  dinner: Object.freeze({ from: "18:00", to: "20:30", minutes: 45 }),
});

const toMin = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };
const REST_KINDS = new Set(["rest", "meal", "sleep", "gym", "travel"]);
const TRAVEL = /^commute|^getting (to|back)/i;
const MEAL_WORDS = /\b(lunch|dinner|breakfast|supper|meal)\b/i;
export const isRest = (b) => REST_KINDS.has(b.kind) || TRAVEL.test(String(b.title ?? ""));
const dur = (b) => b.end - b.start;

/** The settings with every default filled in; a saved config's planBreaks may name only the fields it changes. */
export function breakSettings(config = {}) {
  const saved = config?.planBreaks && typeof config.planBreaks === "object" ? config.planBreaks : {};
  return { ...BREAK_DEFAULTS, ...saved, lunch: { ...BREAK_DEFAULTS.lunch, ...(saved.lunch ?? {}) }, dinner: { ...BREAK_DEFAULTS.dinner, ...(saved.dinner ?? {}) } };
}

/** Minutes a day still has to give to meals (a lunch or dinner window ahead with no meal in it), so the planner leaves room for them. */
export function mealAllowance(blocks, { now, window, settings = BREAK_DEFAULTS }) {
  if (!settings.enabled) return 0;
  const floor = Math.max(window.start, now);
  return [settings.lunch, settings.dinner].reduce((sum, cfg) => {
    const from = toMin(cfg.from); const to = toMin(cfg.to);
    const has = blocks.some((b) => b.end > from && b.start < to && (b.kind === "meal" || MEAL_WORDS.test(b.title)) && !(b.tags ?? []).includes("autobreak"));
    return !(cfg.minutes > 0) || has || Math.max(from, floor) + cfg.minutes > to || window.end < to - 60 ? sum : sum + cfg.minutes;
  }, 0);
}

/** The time a stretch of work really takes with the breaks it earns: 60 minutes of work, one 15-minute break. */
export const withBreakShare = (minutes, settings = BREAK_DEFAULTS) => (settings.enabled ? Math.ceil(minutes * (1 + settings.breakMinutes / settings.breakAfterMinutes)) : minutes);

/** The longest stretch of work with no rest-like block and no gap of 10 minutes or more in it. */
export function longestWorkRun(blocks) {
  let best = 0; let from = null; let to = null;
  for (const b of [...blocks].sort((x, y) => x.start - y.start)) {
    if (isRest(b)) { from = null; continue; }
    if (from === null || b.start - to >= 10) from = b.start;
    to = Math.max(to ?? b.end, b.end);
    best = Math.max(best, to - from);
  }
  return best;
}

/** Slide the movable items from `i` on so nothing starts before `cursor`; null when a wall (or the end of the day) is in the way. */
function slide(items, i, cursor, window, buffer, moved) {
  const out = items.map((b) => ({ ...b }));
  let need = cursor;
  for (let j = i; j < out.length; j += 1) {
    const b = out[j];
    if (b.start >= need) break;
    if (!b._movable) return null;
    const start = need; const end = start + dur(b);
    if (end > window.end || (b._win && (start < b._win.from || end > b._win.to))) return null;
    moved.set(b.id, { from: moved.get(b.id)?.from ?? b.start, fromEnd: moved.get(b.id)?.fromEnd ?? b.end });
    out[j] = { ...b, start, end };
    need = end + buffer;
  }
  return out;
}

const cost = (before, after) => after.reduce((sum, b, k) => sum + Math.abs(b.start - (before[k]?.start ?? b.start)), 0);

/**
 * @param blocks   the day's blocks after planning ({ id, title, kind, start, end, fixed, source?, pinned? })
 * @param opts     { window: {start,end}, now, settings, soft?: travel walls, buffer?, pinned?: Set of ids }
 * @returns { blocks, added, shifts: [{id,title,from,to,toEnd}], unsatisfied: [{before, why}] }
 */
export function planRests(blocks, { window, now, settings = BREAK_DEFAULTS, soft = [], buffer = 0, pinned = new Set() }) {
  const none = { blocks: blocks.map((b) => ({ ...b })), added: [], shifts: [], unsatisfied: [] };
  if (!settings.enabled) return none;
  const floor = Math.max(window.start, now);
  const date = blocks[0]?.date;
  const isMovable = (b) => !b.fixed && b.kind !== "class" && b.kind !== "sleep" && !b.pinned && !pinned.has(b.id) && b.start >= floor;
  let items = [...blocks.map((b) => ({ ...b, _movable: isMovable(b) })),
    ...soft.map((w, i) => ({ id: `soft-${i}`, title: w.title ?? "travel", kind: "travel", start: w.start, end: w.end, fixed: true, _soft: true, _movable: false }))]
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const moved = new Map(); const added = []; const unsatisfied = [];
  let serial = 0;
  const make = (title, kind, start, end, extra = {}) => ({ id: `rest-${serial++}`, title, kind, ...(date ? { date } : {}), start, end, fixed: false, source: "orion", tags: ["autobreak"], _movable: true, ...extra });

  /** Put `rest` before the first item starting at or after it, sliding what follows; null when it cannot be done. */
  const insert = (list, rest) => {
    const i = list.findIndex((b) => b.start >= rest.start);
    const at = i < 0 ? list.length : i;
    if (at > 0 && list[at - 1].end > rest.start) return null;
    const slid = slide(list, at, rest.end, window, buffer, moved);
    if (!slid) return null;
    return [...slid.slice(0, at), rest, ...slid.slice(at)];
  };

  // 1. Meals, each in its window, where it costs the least sliding.
  for (const [title, cfg] of [["Lunch", settings.lunch], ["Dinner", settings.dinner]]) {
    const from = toMin(cfg.from); const to = toMin(cfg.to); const length = cfg.minutes;
    if (!(length > 0) || Math.max(from, floor) + length > to) continue;
    if (items.some((b) => !b._soft && ((b.kind === "meal" && b.end > from && b.start < to) || (MEAL_WORDS.test(b.title) && b.end > from && b.start < to)))) continue;
    let best = null;
    for (let i = 0; i <= items.length; i += 1) {
      const prevEnd = i > 0 ? items[i - 1].end : floor;
      const start = Math.max(prevEnd, from, floor);
      if (start + length > to || (i < items.length && items[i].start < start && items[i].end > start)) continue;
      const rest = make(title, "meal", start, start + length, { _win: { from, to } });
      const next = insert(items, rest);
      if (next) { const c = cost(items.filter((b) => b.id !== rest.id), next.filter((b) => b.id !== rest.id)); if (!best || c < best.c) best = { c, next, rest }; }
    }
    if (best) { items = best.next; added.push(best.rest); }
  }

  // 2. A short transition right before a class that ORION work runs up to.
  for (const cls of items.filter((b) => b.kind === "class" && b.fixed && b.start > floor)) {
    const k = items.findIndex((b) => b.id === cls.id);
    const prev = items[k - 1];
    const start = cls.start - settings.classBufferMinutes;
    if (!prev || isRest(prev) || prev.kind === "class" || prev.end > start || start < floor) continue;
    const t = make("Transition", "rest", start, cls.start);
    items = [...items.slice(0, k), t, ...items.slice(k)]; added.push(t);
  }

  // 3. Breaks: after a stretch of work, and before one that would push the stretch past the limit.
  let run = 0;
  for (let j = 0; j < items.length; j += 1) {
    const b = items[j];
    if (b.end <= floor) continue;
    if (isRest(b)) { if (dur(b) >= settings.minBreakMinutes || b.kind === "meal") run = 0; continue; }
    const prev = j > 0 && items[j - 1].end > floor ? items[j - 1] : null;
    const gap = prev ? b.start - prev.end : Infinity;
    if (gap >= 30) run = 0;
    if (prev && run > 0 && !isRest(prev) && (run >= settings.breakAfterMinutes || run + dur(b) > settings.maxWorkMinutes)) {
      let next = null; let rest = null;
      for (const length of gap >= settings.minBreakMinutes ? [Math.min(settings.breakMinutes, gap)] : [settings.breakMinutes, settings.minBreakMinutes]) {
        rest = make("Break", "rest", prev.end, prev.end + length);
        next = insert(items, rest);
        if (next) break;
      }
      if (next) { items = next; added.push(rest); run = 0; } else unsatisfied.push({ before: b.title, why: "a class or plan is in the way" });
    }
    run += dur(items.find((x) => x.id === b.id));
  }

  const strip = ({ _movable, _soft, _win, ...rest }) => rest;
  const kept = items.filter((b) => !b._soft).map(strip);
  const shifts = [...moved].map(([id, was]) => { const now2 = kept.find((b) => b.id === id); return now2 && now2.start !== was.from ? { id, title: now2.title, from: was.from, to: now2.start, toEnd: now2.end } : null; }).filter(Boolean);
  return { blocks: kept, added: added.map((a) => kept.find((b) => b.id === a.id)).filter(Boolean), shifts, unsatisfied };
}
