/**
 * @param {{ date: string, blocks: Array<{title:string, kind:string, start:number, end:number, fixed:boolean, source:string}>, checkins: Array<{what:string, dueMinute:number, startedMinute:number|null, doneMinute:number|null, phase:string}>, todosDone: string[], now: {date:string, minute:number}, tomorrowFirst?: {title:string, minute:number} }} opts
 * @returns {{ planned: number, done: number, slipped: string[], lateMinutes: number|null, text: string }}
 */
export function reviewDay({ date, blocks, checkins, todosDone, now, tomorrowFirst, actual }) {
  // Validate inputs
  if (typeof date !== "string" || !date) {
    throw new TypeError("date is required");
  }
  if (!Array.isArray(blocks)) {
    throw new TypeError("blocks must be an array");
  }
  if (!Array.isArray(checkins)) {
    throw new TypeError("checkins must be an array");
  }
  if (!Array.isArray(todosDone)) {
    throw new TypeError("todosDone must be an array");
  }
  if (!now || typeof now !== "object" || !("date" in now) || !("minute" in now)) {
    throw new TypeError("now must have date and minute");
  }

  // With logged reality (actualDay) the review reads what happened: logged, served, attended, slipped, unknown.
  if (actual) {
    return { planned: blocks.filter((b) => b.source === "orion").length, done: actual.done.length, slipped: actual.slipped.map((s) => s.title),
      lateMinutes: null, actual, text: actualText(actual, { tomorrowFirst }) };
  }

  // Decision 1: Planned = ORION blocks that ended by now, excluding rest kind and Wind down/Break titles
  const plannedBlocks = blocks.filter((b) => {
    if (b.source !== "orion") return false;
    if (b.end > now.minute) return false;
    if (b.kind === "rest") return false;
    if (b.title === "Wind down" || b.title === "Break") return false;
    return true;
  });

  // Decision 6: No planned blocks
  if (plannedBlocks.length === 0) {
    return {
      planned: 0,
      done: 0,
      slipped: [],
      lateMinutes: null,
      text: "Nothing was planned today.",
    };
  }

  // Decision 2: A block is done when a check-in whose `what` shares a 4+ letter word with its title (case-insensitive) is `done`, or a to-do in `todosDone` does.
  const doneTitles = new Set();

  for (const block of plannedBlocks) {
    const blockWords = getLongWords(block.title);

    // Check check-ins
    for (const ci of checkins) {
      if (ci.phase !== "done") continue;
      const ciWords = getLongWords(ci.what);
      if (sharesWord(blockWords, ciWords)) {
        doneTitles.add(block.title);
        break;
      }
    }

    // Check todosDone
    if (!doneTitles.has(block.title)) {
      for (const todo of todosDone) {
        const todoWords = getLongWords(todo);
        if (sharesWord(blockWords, todoWords)) {
          doneTitles.add(block.title);
          break;
        }
      }
    }
  }

  const doneCount = doneTitles.size;

  // Decision 3: Slipped = planned and not done
  const slipped = plannedBlocks
    .filter((b) => !doneTitles.has(b.title))
    .map((b) => b.title);

  // Decision 4: lateMinutes = median of (startedMinute - dueMinute) over check-ins that started, rounded; null if none
  let lateMinutes = null;
  const delays = checkins
    .filter((ci) => ci.startedMinute !== null && ci.startedMinute !== undefined)
    .map((ci) => ci.startedMinute - ci.dueMinute);

  if (delays.length > 0) {
    // Create a copy to sort, avoiding mutation of input-derived array if possible, though map returns new array
    const sortedDelays = [...delays].sort((a, b) => a - b);
    const mid = Math.floor(sortedDelays.length / 2);
    lateMinutes = sortedDelays.length % 2 !== 0
      ? Math.round(sortedDelays[mid])
      : Math.round((sortedDelays[mid - 1] + sortedDelays[mid]) / 2);
  }

  // Decision 5: text construction
  let text = `Today: ${doneCount} of ${plannedBlocks.length} planned blocks done.`;

  if (slipped.length > 0) {
    const listed = slipped.slice(0, 3);
    let slippedPart = listed.join(", ");
    if (slipped.length > 3) {
      slippedPart += `, and ${slipped.length - 3} more`;
    }
    text += ` Slipped: ${slippedPart}.`;
  }

  if (lateMinutes !== null && lateMinutes >= 10) {
    text += ` You started things about ${lateMinutes} min late.`;
  }

  if (tomorrowFirst && typeof tomorrowFirst === "object" && "title" in tomorrowFirst && "minute" in tomorrowFirst) {
    const clock = minuteToClock(tomorrowFirst.minute);
    text += ` Tomorrow starts with ${tomorrowFirst.title} at ${clock}.`;
  }

  return {
    planned: plannedBlocks.length,
    done: doneCount,
    slipped,
    lateMinutes,
    text,
  };
}

/**
 * Extract words of length >= 4 from a string, lowercased.
 */
function getLongWords(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length >= 4);
}

/**
 * Check if two word sets share at least one common word.
 */
function sharesWord(wordsA, wordsB) {
  const setB = new Set(wordsB);
  return wordsA.some((w) => setB.has(w));
}

/**
 * Convert minutes after midnight to 12-hour clock string like "8:15 PM".
 */
function minuteToClock(minute) {
  let h = Math.floor(minute / 60);
  const m = minute % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

// ---- Reality (spec 3.6, contract C8) -------------------------------------------------------------------------------
// The review reads what happened, not just what was planned: logged blocks, focus served, classes attended, slips and
// the blanks he answered. A stretch nobody knows about is "unknown", never "nothing"; "nothing" is his answer, "free".
const DAY_START = 8 * 60;

/** Merge [{start,end}] into disjoint sorted intervals. */
const merge = (list) => list.filter((x) => x.end > x.start).sort((a, b) => a.start - b.start)
  .reduce((out, x) => (out.length && x.start <= out.at(-1).end ? [...out.slice(0, -1), { start: out.at(-1).start, end: Math.max(out.at(-1).end, x.end) }] : [...out, { ...x }]), []);

/**
 * Stretches over `minMinutes`, from 08:00 to now, with no block, no focus session and no answer (C8).
 * @param day { blocks: [{start,end}], sessions?: [{start,end}], answered?: [{start,end}] }
 * @param now a minute, or { minute }
 */
export function blanks(day, { now, minMinutes = 30 } = {}) {
  const until = typeof now === "object" ? now.minute : now;
  const covered = merge([...(day.blocks ?? []), ...(day.sessions ?? []), ...(day.answered ?? [])].map((x) => ({ start: x.start, end: Math.min(x.end, until) })));
  const gaps = [];
  let cursor = Math.max(DAY_START, Number.isFinite(day.from) ? day.from : 0);   // nobody is "blank" before he woke
  for (const c of covered) { if (c.start > cursor) gaps.push({ start: cursor, end: Math.min(c.start, until) }); cursor = Math.max(cursor, c.end); }
  if (cursor < until) gaps.push({ start: cursor, end: until });
  return gaps.filter((g) => g.end - g.start > minMinutes);
}

const norm = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const titlesShare = (a, b) => sharesWord(getLongWords(String(a ?? "")), getLongWords(String(b ?? "")));
const minuteOfIso = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d.getHours() * 60 + d.getMinutes(); };

/** Focus sessions served that day as minute intervals ({ start, end, minutes, task }). */
function sessionsOf(history, date) {
  return (history ?? []).filter((r) => r?.dayKey === date && Number(r.servedFocusSeconds) >= 5 * 60).flatMap((r) => {
    const start = minuteOfIso(r.startedAt), end = minuteOfIso(r.endedAt);
    return start === null || end === null || end <= start ? [] : [{ start, end, minutes: Math.round(r.servedFocusSeconds / 60), task: r.task ?? null }];
  });
}

/**
 * @param blocks       today's blocks ({ id, title, kind, start, end, fixed, source, logged })
 * @param focusHistory focus-history.jsonl rows
 * @param attendance   { [blockId]: "attended"|"missed"|"unknown" } for real calendar blocks
 * @param slips        slips.jsonl rows for the day (C10)
 * @param early        logged.jsonl rows with `early: true` ("Done early"): those blocks read "done early"
 * @param asks         curiosity ledger asks
 * @param now          { date, minute }
 * @returns { done: [{ title, start, end, how }], slipped: [{ title, why }], free: [{ start, end }], blank: [{ start, end }], focusMinutes }
 */
export function actualDay({ blocks: rawBlocks, focusHistory = [], attendance = {}, slips = [], asks = [], early = [], now }) {
  // `logged` comes from WP6's live-day (tags / logged); accept either spelling of the marker
  const blocks = rawBlocks.map((b) => (b.logged || !b.tags?.includes("logged") ? b : { ...b, logged: true }));
  const sessions = sessionsOf(focusHistory, now.date);
  const dayAsks = asks.filter((a) => a.window?.date === now.date && a.answeredAt);
  const answered = dayAsks.filter((a) => a.outcome === "nothing").map((a) => ({ start: a.window.start, end: a.window.end ?? now.minute }));
  const upto = (b) => b.end <= now.minute || b.start < now.minute;
  const done = [
    // `early`: the logged rows "Done early" wrote. He finished it before its planned end: counted as done, never as a slip.
    ...blocks.filter((b) => b.logged && upto(b)).map((b) => ({ title: b.title, start: b.start, end: Math.min(b.end, now.minute), how: "logged",
      ...(early.some((r) => (r.identifier && r.identifier === b.calendarId) || (r.title === b.title && r.start === b.start)) ? { early: true } : {}) })),
    ...blocks.filter((b) => !b.logged && b.source !== "orion" && attendance[b.id] === "attended").map((b) => ({ title: b.title, start: b.start, end: b.end, how: "attended" })),
  ];
  const evidenced = (b) => sessions.some((s) => s.start < b.end && s.end > b.start && (!s.task || titlesShare(b.title, s.task) || b.kind === "study"));
  // He did the planned thing itself (the planned "CS Lab" replaced by his logged "cs lab"): that is not a slip, whatever an older `log` wrote (2026-10-19).
  const sameActivity = (a, b) => { const x = norm(a).split(" ").filter(Boolean), y = norm(b).split(" ").filter(Boolean); const [s, l] = x.length <= y.length ? [x, y] : [y, x]; return s.length > 0 && s.every((w) => l.includes(w)); };
  const slipRows = slips.filter((s) => s.date === now.date)
    .filter((s) => !(s.replacedBy && sameActivity(s.planned?.title, s.replacedBy)) && !(s.reason === "no-room" && done.some((d) => d.how === "logged" && sameActivity(d.title, s.planned?.title))))
    .map((s) => ({ title: s.planned?.title ?? "", why: s.reason, replacedBy: s.replacedBy ?? null, missedMinutes: s.missedMinutes ?? null }));
  const stillPlanned = blocks.filter((b) => b.source === "orion" && !b.fixed && !b.logged && b.end <= now.minute && !["rest", "sleep", "commute"].includes(b.kind)
    && !/^(wind down|break)$/i.test(b.title) && !evidenced(b) && !slipRows.some((s) => titlesShare(b.title, s.title) || s.title === b.title))
    .map((b) => ({ title: b.title, why: "no-evidence", replacedBy: null, missedMinutes: b.end - b.start }));
  const covering = blocks.map((b) => ({ start: b.start, end: b.end }));
  return {
    done,
    slipped: [...slipRows, ...stillPlanned],
    free: answered,
    blank: blanks({ blocks: covering, sessions, answered }, { now: now.minute }),
    focusMinutes: sessions.reduce((a, s) => a + s.minutes, 0),
  };
}

const clock = (m) => { const h = Math.floor(m / 60) % 24, mm = m % 60, t = h % 12 || 12; return mm ? `${t}:${String(mm).padStart(2, "0")}` : String(t); };
const range = (a, b) => `${clock(a)}-${clock(b)}`;
const lower = (t) => String(t).replace(/ — .*$/, "");
const minutesText = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}` : `${m}m`);

/** The one merged message (spec 3.6): "Today: CS1800, gym 2-4 (instead of finish resume), 1h40 focus. Slipped: ... 5-6 unknown." */
export function actualText(actual, { tomorrowFirst } = {}) {
  const items = actual.done.map((d) => {
    const slip = d.how === "logged" ? actual.slipped.find((s) => s.why === "reality" && s.replacedBy && (titlesShare(s.replacedBy, d.title) || s.replacedBy === d.title)) : null;
    return d.how === "logged" ? `${d.title.toLowerCase()} ${range(d.start, d.end)}${slip ? ` (instead of ${slip.title.toLowerCase()})` : ""}${d.early ? " (done early)" : ""}` : lower(d.title);
  });
  if (actual.focusMinutes >= 5) items.push(`${minutesText(actual.focusMinutes)} focus`);
  const parts = [items.length ? `Today: ${items.join(", ")}.` : "Nothing logged today."];
  const slips = actual.slipped.filter((s) => s.why !== "reality").slice(0, 3).map((s) => {
    const by = /^bumped:/.test(s.why) ? ` (bumped for ${s.why.slice(7)})` : s.why === "no-room" ? " (no room)" : "";
    return `${lower(s.title)}${by}`;
  });
  if (slips.length) parts.push(`Slipped: ${slips.join(", ")}.`);
  if (actual.blank.length) parts.push(`${actual.blank.map((b) => range(b.start, b.end)).join(", ")} unknown.`);
  if (tomorrowFirst?.title) parts.push(`Tomorrow starts with ${tomorrowFirst.title} at ${minuteToClock(tomorrowFirst.minute)}.`);
  return parts.join(" ");
}
