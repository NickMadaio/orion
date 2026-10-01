import { strict as assert } from 'node:assert';

const LEADING_WRAPPERS = [
  'can you ', 'could you ', 'please ', 'add ', 'put ',
  'i need to ', 'todo: ', 'to do: ',
  'add to my todo list ', 'add to my schedule ',
];

const TRAILING_WRAPPERS = [
  ' to my todo list', ' to my schedule', ' today', ' please',
];

const JOINING_WORDS = [
  'and ', 'then ', 'also ', 'plus ', 'maybe ', 'probably ', 'possibly ',
  'try to ', 'i should ', 'gotta ',
];

const OPTIONAL_PHRASES = [
  'maybe', "if i have time", "if there's time", 'possibly',
  'probably', 'try to', 'ideally',
];

const DURATION_RE = /\b(\d+)\s*(?:min|mins?|m)\b|\b(\d+)\s*(?:h|hours?)\b|\ban?\s*hour\b|\bhalf\s+an?\s*hour\b|\bfor\s+(\d+)\b/i;

const KEYWORD_MINUTES = [
  { re: /\b(?:application|applications|resume|cv|cover letter)\b/i, mins: 90 },
  { re: /\b(?:email|reply|text|call|send)\b/i, mins: 30 },
  { re: /\b(?:study|revise|homework|assignment|problem set|coursework|essay)\b/i, mins: 60 },
  { re: /\b(?:gym|workout|run)\b/i, mins: 60 },
  { re: /\b(?:laundry|clean|tidy|groceries|shop)\b/i, mins: 45 },
  { re: /\b(?:fix|build|code|debug|project)\b/i, mins: 60 },
];

const TIME_RE = /\bat\s+(?:(noon|midnight)|(\d{1,2})(?::(\d{2}))?\s*(?:am|pm)?)\b/i;

const DUE_RE = {
  today: /\btoday\b/i,
  tomorrow: /\btomorrow\b/i,
  thisWeekday: /\bthis\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  byWeekday: /\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
};

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function parseDuration(text) {
  const m = text.match(DURATION_RE);
  if (!m) return null;
  if (m[1]) return parseInt(m[1], 10);
  if (m[2]) return parseInt(m[2], 10) * 60;
  if (m[3]) return parseInt(m[3], 10);
  if (/half\s+an?\s*hour/i.test(text)) return 30;
  if (/an?\s*hour/i.test(text)) return 60;
  return null;
}

function parseTime(text) {
  const m = text.match(TIME_RE);
  if (!m) return null;
  if (m[1]) {
    return /noon/i.test(m[1]) ? 720 : 0;
  }
  let hour = parseInt(m[2], 10);
  const minute = m[3] ? parseInt(m[3], 10) : 0;
  const ampm = (m[4] || '').toLowerCase();
  if (ampm === 'am') {
    if (hour === 12) hour = 0;
  } else if (ampm === 'pm') {
    if (hour !== 12) hour += 12;
  } else {
    // no am/pm: 1..7 → afternoon
    if (hour >= 1 && hour <= 7) hour += 12;
  }
  return hour * 60 + minute;
}

function keywordMinutes(title) {
  for (const kw of KEYWORD_MINUTES) {
    if (kw.re.test(title)) return kw.mins;
  }
  return 45;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function nextDay(dateStr, offset) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + offset));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function weekdayIndex(name) {
  // JS: Sun=0..Sat=6; our list: mon=0..sun=6
  const jsDay = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return jsDay.indexOf(name.toLowerCase());
}

function nextWeekday(dateStr, targetName) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const targetIdx = weekdayIndex(targetName);
  let currentIdx = dt.getUTCDay();
  let diff = (targetIdx - currentIdx + 7) % 7;
  if (diff === 0) diff = 7; // strictly after today
  return nextDay(dateStr, diff);
}

function isProperNoun(word, originalPiece) {
  // Keep capitalised words that appear capitalised in the original
  const idx = originalPiece.toLowerCase().indexOf(word.toLowerCase());
  if (idx === -1) return false;
  const origChar = originalPiece[idx];
  return origChar === origChar.toUpperCase() && origChar !== origChar.toLowerCase();
}

function processTitle(raw, originalPiece) {
  let title = raw.trim();
  // Strip joining words from the start
  for (const jw of JOINING_WORDS) {
    if (title.toLowerCase().startsWith(jw)) {
      title = title.slice(jw.length);
    }
  }
  // Lower-case first letter unless it's a proper noun / acronym
  if (title.length > 0) {
    const firstWordEnd = title.search(/\s/);
    const firstWord = firstWordEnd === -1 ? title : title.slice(0, firstWordEnd);
    if (firstWord.toUpperCase() !== firstWord && !isProperNoun(firstWord, originalPiece)) {
      title = firstWord[0].toLowerCase() + firstWord.slice(1) + (firstWordEnd === -1 ? '' : title.slice(firstWordEnd));
    }
  }
  return title;
}

function extractDue(text, nowDate) {
  let due = null;
  let cleaned = text;

  if (DUE_RE.today.test(cleaned)) {
    due = nowDate;
    cleaned = cleaned.replace(DUE_RE.today, '');
  } else if (DUE_RE.tomorrow.test(cleaned)) {
    due = nextDay(nowDate, 1);
    cleaned = cleaned.replace(DUE_RE.tomorrow, '');
  } else if (DUE_RE.thisWeekday.test(cleaned)) {
    const m = cleaned.match(DUE_RE.thisWeekday);
    const dayName = m[1].toLowerCase();
    const todayIdx = (() => {
      const [y, mo, d] = nowDate.split('-').map(Number);
      return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    })();
    const targetIdx = weekdayIndex(dayName);
    if (todayIdx === targetIdx) {
      due = nowDate; // "this <weekday>" and it IS today → today
    } else {
      due = nextWeekday(nowDate, dayName);
    }
    cleaned = cleaned.replace(DUE_RE.thisWeekday, '');
  } else if (DUE_RE.byWeekday.test(cleaned)) {
    const m = cleaned.match(DUE_RE.byWeekday);
    const dayName = m[1].toLowerCase();
    due = nextWeekday(nowDate, dayName);
    cleaned = cleaned.replace(DUE_RE.byWeekday, '');
  }

  return { due, cleaned };
}

export function parseTodos(text, opts = {}) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new TypeError('text must be a non-empty string');
  }
  const { now } = opts;
  if (!now || typeof now.date !== 'string' || typeof now.minute !== 'number') {
    throw new TypeError('now is required with date and minute');
  }

  // 1. Strip request wrapper
  let cleaned = text.trim();
  const lower = cleaned.toLowerCase();
  for (const w of LEADING_WRAPPERS) {
    if (lower.startsWith(w)) {
      cleaned = cleaned.slice(w.length);
      break;
    }
  }
  for (const w of TRAILING_WRAPPERS) {
    if (cleaned.toLowerCase().endsWith(w)) {
      cleaned = cleaned.slice(0, cleaned.length - w.length);
      break;
    }
  }

  // 2. Split on delimiters
  // Replace " and ", " & ", " then " with comma so they act as item separators
  let splitText = cleaned.replace(/\s+and\s+/g, ',').replace(/\s*&\s+/g, ',').replace(/\s+then\s+/g, ',');
  const pieces = splitText.split(/[,\n;•*-]+/).map(p => p.trim()).filter(Boolean);

  // 3-7. Process each piece
  const seenTitles = new Set();
  const tasks = [];

  for (const piece of pieces) {
    const originalPiece = piece;

    // 4. Check optional
    const lowerPiece = piece.toLowerCase();
    let optional = false;
    for (const op of OPTIONAL_PHRASES) {
      if (lowerPiece.includes(op)) {
        optional = true;
        break;
      }
    }

    // Remove optional phrases from title processing
    let titleText = piece;
    for (const op of OPTIONAL_PHRASES) {
      titleText = titleText.replace(new RegExp(op, 'gi'), '');
    }

    // 7. Extract due date (before title finalisation so due words are removed)
    const { due, cleaned: afterDue } = extractDue(titleText, now.date);
    titleText = afterDue;

    // 5. Minutes
    let minutes = parseDuration(titleText);
    if (minutes === null) {
      minutes = keywordMinutes(titleText);
    }
    minutes = clamp(minutes, 10, 240);

    // 6. at / fixed
    const timeVal = parseTime(titleText);
    const at = timeVal !== null ? timeVal : null;
    const fixed = timeVal !== null;

    // Remove time phrase from title
    let finalTitle = titleText.replace(TIME_RE, '').trim();

    // 3. Process title
    finalTitle = processTitle(finalTitle, originalPiece);

    // 8. Duplicate collapse
    const key = finalTitle.toLowerCase();
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);

    tasks.push({ title: finalTitle, minutes, optional, due, at, fixed });
  }

  // leftover: words not part of any task — for simplicity, empty since we split everything
  return { tasks, leftover: '' };
}
