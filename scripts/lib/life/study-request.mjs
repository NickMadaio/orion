import { strict as assert } from 'node:assert';

const SUBJECT_ALIASES = {
  macro: 'ECON1115',
  macroeconomics: 'ECON1115',
  econ: 'ECON1115',
  marketing: 'MKTG2201',
  mktg: 'MKTG2201',
  discrete: 'CS1800',
  cs1800: 'CS1800',
  programming: 'CS2100',
  cs2100: 'CS2100',
};

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * @param {string} text
 * @param {string} today - YYYY-MM-DD
 * @returns {{ minutes: number, subject: string | null, byDate: string, splitMinutes: number[] } | { error: string }}
 */
export function parseStudyRequest(text, today) {
  const lowerText = text.toLowerCase().trim();

  // 0. "two one-hour sessions", "3 x 45 min", "two 1 hour study sessions" (added 2026-09-29):
  //    the session count and length are said outright, so they win over everything else.
  const sessions = parseSessions(lowerText);
  if (sessions) {
    const total = sessions.count * sessions.each;
    if (total < 15 || total > 600) return { error: 'minutes out of range' };
    const byDate0 = parseByDate(lowerText, today) ?? today;
    return { minutes: total, subject: parseSubject(text), byDate: byDate0, splitMinutes: Array(sessions.count).fill(sessions.each) };
  }

  // 1. Parse minutes
  let minutes = parseMinutes(lowerText);
  if (minutes === null) {
    minutes = 60;
  }

  if (minutes < 15 || minutes > 600) {
    return { error: 'minutes out of range' };
  }

  // 2. Parse subject (pass original text to preserve casing)
  const subject = parseSubject(text);

  // 3. Parse byDate
  let byDate = parseByDate(lowerText, today);
  if (byDate === null) {
    byDate = today;
  }

  // 4. Split minutes
  const splitMinutes = splitSessions(minutes);

  return { minutes, subject, byDate, splitMinutes };
}

/**
 * @param {string} text
 * @returns {number | null}
 */
function parseMinutes(text) {
  // "an hour" -> 60
  if (/\ban\b.*\bhour\b/.test(text)) return 60;
  // "half an hour" -> 30
  if (/\bhalf\b.*\ban?\s*hour\b/.test(text)) return 30;

  // Number + unit: "2 hours", "2h", "90 min", "90 minutes", "1.5 hours"
  const match = text.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|mins?|minutes?)/);
  if (match) {
    const value = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    if (unit.startsWith('h')) {
      return Math.round(value * 60);
    }
    return Math.round(value);
  }

  return null;
}

/**
 * @param {string} text
 * @returns {string | null}
 */
function parseSubject(text) {
  // Look for "for <subject>" or "on <subject>"
  // Stop at "before", "by", or end of string
  
  const forMatch = text.match(/\bfor\s+(.+?)(?:\s+(?:before|by|this|next|today|tomorrow|on\s+(?:mon|tue|wed|thu|fri|sat|sun)\w*|outside|during|after)\b|[,.]|$)/i);
  if (forMatch) {
    return normalizeSubject(forMatch[1].trim());
  }

  const onMatch = text.match(/\bon\s+(.+?)(?:\s+(?:before|by|this|next|today|tomorrow|on\s+(?:mon|tue|wed|thu|fri|sat|sun)\w*|outside|during|after)\b|[,.]|$)/i);
  if (onMatch) {
    return normalizeSubject(onMatch[1].trim());
  }

  return null;
}

/**
 * @param {string} raw
 * @returns {string | null}
 */
function normalizeSubject(raw) {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (SUBJECT_ALIASES[lower]) {
    return SUBJECT_ALIASES[lower];
  }
  // Unknown subject is kept as typed (original case preserved)
  return trimmed || null;
}

/**
 * @param {string} text
 * @param {string} today - YYYY-MM-DD
 * @returns {string | null}
 */
function parseSessions(text) {
  const count = { one: 1, two: 2, three: 3, four: 4, a: 1, "1": 1, "2": 2, "3": 3, "4": 4 };
  const m = text.match(/\b(one|two|three|four|a|[1-4])\s*(?:x\s*)?(one|1|half|30|45|60|90)?[\s-]*(hour|hr|minute|min)s?[\s-]*(?:long\s+)?(?:study\s+)?(session|block|slot)s?\b/);
  if (!m) return null;
  const n = count[m[1]];
  let each;
  if (m[3].startsWith("h")) each = m[2] === "half" ? 30 : m[2] === "90" ? 90 : 60;
  else each = Number(m[2] ?? 60) || 60;
  return n ? { count: n, each } : null;
}

function parseByDate(text, today) {
  // Check for explicit date first
  const dateMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (dateMatch) {
    return dateMatch[1];
  }

  // "today"
  if (/\btoday\b/.test(text)) {
    return today;
  }

  // "tomorrow"
  if (/\btomorrow\b/.test(text)) {
    return addDays(today, 1);
  }

  // "this week" / "by the weekend" → the coming Sunday; "next week" → the Sunday after.
  if (/\b(this week|by the weekend|before the weekend|this weekend)\b/.test(text)) {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
    return addDays(today, dow === 0 ? 0 : 7 - dow);
  }
  if (/\bnext week\b/.test(text)) {
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
    return addDays(today, (dow === 0 ? 0 : 7 - dow) + 7);
  }

  // Weekday name
  const weekdayMatch = text.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (weekdayMatch) {
    const targetDayName = weekdayMatch[1];
    return nextWeekday(today, targetDayName);
  }

  return null;
}

/**
 * @param {string} today - YYYY-MM-DD
 * @param {number} days
 * @returns {string}
 */
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

/**
 * @param {string} today - YYYY-MM-DD
 * @param {string} dayName - lowercase weekday name
 * @returns {string}
 */
function nextWeekday(today, dayName) {
  const [y, m, d] = today.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  
  const targetIndex = WEEKDAYS.indexOf(dayName);
  const currentDayIndex = date.getDay(); // 0=Sun, 1=Mon... matches WEEKDAYS indices
  
  let diff = targetIndex - currentDayIndex;
  if (diff <= 0) {
    diff += 7;
  }
  
  date.setDate(date.getDate() + diff);
  return formatDate(date);
}

/**
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * @param {number} minutes
 * @returns {number[]}
 */
function splitSessions(minutes) {
  if (minutes <= 120) {
    return [minutes];
  }
  
  const chunks = [];
  let remaining = minutes;
  while (remaining > 0) {
    const chunk = Math.min(90, remaining);
    chunks.push(chunk);
    remaining -= chunk;
  }
  return chunks;
}
