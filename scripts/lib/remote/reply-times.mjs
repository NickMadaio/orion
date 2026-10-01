// Do the times ORION says match what was booked? (ORION truthful / reply-times)
//
// 30 September 2026: ORION booked "finish resume" 14:30–16:00 and told Nick
// "resume at 4:00 PM"; the same night, "dinner 7:30, gym 7:30–8:30" for gym
// 19:30 and dinner 20:30. A time belongs to the clause it sits in ("dinner 7:30"
// is dinner's time, not gym's), and a time without AM/PM is read the way the
// booking makes sense of it before falling back to the bare-hour rule.
// (Rewritten by Claude on 2026-10-01 from Qwen's draft, which matched times to
// titles by the six words either side and fixed AM/PM before looking at the day.)

const STOP_WORDS = new Set(["the", "my", "your", "and", "then", "with", "after", "before", "until"]);
const CLAUSE = /[,;.!?\n]|\bthen\b|\band then\b/i;
const TIME = /\b(noon|midnight)\b|\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?:\s*(?:–|-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?)?/gi;

/** 1..7 → PM, 8..11 → AM, 12 → noon (the brief's bare-hour rule). */
function bareHour(hour) {
  if (hour >= 1 && hour <= 7) return hour + 12;
  if (hour >= 8 && hour <= 11) return hour;
  if (hour === 12) return 12;
  return null;
}

/** Minutes after midnight, plus the other reading when AM/PM was not said. */
function readTime(hourText, minuteText, meridiem) {
  const hour = Number(hourText); const minute = minuteText ? Number(minuteText) : 0;
  if (!Number.isInteger(hour) || minute > 59) return null;
  const mer = meridiem ? meridiem.replace(/\./g, "").toLowerCase() : null;
  if (mer) {
    if (hour < 1 || hour > 12) return null;
    const h = mer === "pm" ? (hour % 12) + 12 : hour % 12;
    return { minute: h * 60 + minute, alternatives: [] };
  }
  if (hour >= 13 && hour <= 23) return { minute: hour * 60 + minute, alternatives: [] };   // 24-hour
  if (hour === 0) return { minute, alternatives: [] };
  if (hour > 23) return null;
  const h = bareHour(hour);
  if (h === null) return null;
  const chosen = h * 60 + minute;
  const other = (chosen + 720) % 1440;
  return { minute: chosen, alternatives: [other] };
}

function words(text) {
  return String(text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
}

/**
 * Every clock time in the reply: [{ phrase, minute, near }].
 * `near` is the clause the time sits in (the words that say what it is for).
 */
export function mentions(reply) {
  if (typeof reply !== "string") throw new TypeError("reply must be a string");
  return parse(reply).map(({ phrase, minute, near }) => ({ phrase, minute, near }));
}

function parse(reply) {
  const out = [];
  // Split into clauses but keep offsets, so each time knows its own clause.
  let start = 0;
  const clauses = [];
  for (const part of reply.split(new RegExp(`(${CLAUSE.source})`, "i"))) {
    if (part === undefined) continue;
    if (CLAUSE.test(part) && part.length <= 9) { start += part.length; continue; }
    clauses.push({ text: part, start }); start += part.length;
  }
  for (const clause of clauses) {
    for (const m of clause.text.matchAll(TIME)) {
      const phrase = m[0].trim();
      if (m[1]) {
        out.push({ phrase, minute: m[1].toLowerCase() === "noon" ? 720 : 0, alternatives: [], near: clause.text.trim(), range: false });
        continue;
      }
      // A lone number is not a time unless it says so ("at 4", "4 PM", "4:30").
      const hasColon = m[3] !== undefined; const hasMer = m[4] !== undefined || m[7] !== undefined;
      const before = clause.text.slice(0, m.index);
      if (!hasColon && !hasMer && m[5] === undefined && !/\b(at|by|from|until|till|around)\s*$/i.test(before)) continue;
      if (m[5] !== undefined) {
        // A range: a trailing AM/PM applies to both ends.
        const mer = m[7] ?? m[4];
        const a = readTime(m[2], m[3], m[4] ?? mer); const b = readTime(m[5], m[6], m[7] ?? mer);
        if (!a || !b) continue;
        out.push({ phrase, minute: a.minute, alternatives: a.alternatives, near: clause.text.trim(), range: true, end: false });
        out.push({ phrase, minute: b.minute, alternatives: b.alternatives, near: clause.text.trim(), range: true, end: true });
      } else {
        const t = readTime(m[2], m[3], m[4]);
        if (t) out.push({ phrase, minute: t.minute, alternatives: t.alternatives, near: clause.text.trim(), range: false });
      }
    }
  }
  return out;
}

/**
 * @param reply   ORION's reply text
 * @param booked  [{ title, start, end }] minutes after midnight
 * @returns { ok, mismatches: [{ title, said, booked }], unmatched: [phrase] }
 */
export function checkReplyTimes(reply, booked) {
  if (typeof reply !== "string") throw new TypeError("reply must be a string");
  if (!Array.isArray(booked)) throw new TypeError("booked must be an array");
  const mismatches = []; const unmatched = [];
  for (const mention of parse(reply)) {
    const clauseWords = new Set(words(mention.near));
    const scored = booked.map((block) => ({ block, score: words(block.title).filter((w) => clauseWords.has(w)).length }))
      .filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
    if (!scored.length) { unmatched.push(mention.phrase); continue; }
    const best = scored.filter((x) => x.score === scored[0].score);
    const readings = [mention.minute, ...mention.alternatives];
    // A lone time is when it starts; only the end of a range may be when it ends.
    const fits = (block, minute) => (mention.range && mention.end ? minute === block.end : minute === block.start);
    const hit = best.find(({ block }) => readings.some((minute) => fits(block, minute)));
    if (hit) continue;
    // Ties go to the block nearest what he was told.
    const block = best.map((x) => x.block).sort((a, b) => Math.abs(a.start - mention.minute) - Math.abs(b.start - mention.minute))[0];
    if (!mismatches.some((x) => x.title === block.title && x.said === mention.minute)) {
      mismatches.push({ title: block.title, said: mention.minute, booked: block.start });
    }
  }
  return { ok: mismatches.length === 0, mismatches, unmatched };
}
