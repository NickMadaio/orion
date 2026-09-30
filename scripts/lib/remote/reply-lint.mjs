// reply-lint — find and fix reply-quality problems

export const RULES = [
  "meta_talk",
  "time_24h",
  "time_both",
  "markdown_spoken",
  "too_long_spoken",
  "repeated_sentence",
];

// --- clock12 helper ---------------------------------------------------

export function clock12(hour, minute) {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new TypeError("hour must be 0-23, minute must be 0-59");
  }
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const ampm = hour < 12 ? "AM" : "PM";
  const mm = String(minute).padStart(2, "0");
  return `${h12}:${mm} ${ampm}`;
}

// --- meta_talk --------------------------------------------------------

const META_PHRASES = [
  "script",
  "the tool",
  "a tool",
  "no tool",
  "tool_call",
  "tool_search",
  "catalog",
  "exec",
  "TOOLS.md",
  "AGENTS.md",
  "this check",
  "my previous answer",
  "you were right, i did have",
  "allowlist",
];

function findMetaTalk(text) {
  const lower = text.toLowerCase();
  for (const phrase of META_PHRASES) {
    if (lower.includes(phrase)) {
      // Find the actual excerpt in original case
      const idx = lower.indexOf(phrase);
      const start = Math.max(0, idx - 10);
      const end = Math.min(text.length, idx + phrase.length + 10);
      return text.slice(start, end).slice(0, 60);
    }
  }
  return null;
}

// --- time helpers -----------------------------------------------------

// Match H:MM or HH:MM that are NOT part of HH:MM:SS and not followed by AM/PM
// 24-hour means hour 13-23 or exactly 00
const TIME_24H_RE = /(?<!\d)(?:(?:0[0-9]|1[0-2]):[0-5]\d|[1-9]:[0-5]\d)\s*(?:AM|PM|am|pm)(?!:)/gi;
// For 24h detection: hour 13-23 or 00, not part of HH:MM:SS, not followed by AM/PM
const TIME_24H_DETECT_RE = /(?<!\d)(?:[01]?\d|2[0-3]):[0-5]\d(?::\d{2})?(?!\s*(?:AM|PM|am|pm))/gi;

function find24hTimes(text) {
  const results = [];
  // We need to find times with hour 13-23 or 00 that are NOT followed by AM/PM
  // and are not part of HH:MM:SS
  const re = /(?<!\d)(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\s*(?:AM|PM|am|pm))/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    // Skip if it's HH:MM:SS (has seconds group)
    if (m[3] !== undefined) continue;
    const hour = parseInt(m[1], 10);
    // 24-hour: hour 13-23 or exactly 00
    if ((hour >= 13 && hour <= 23) || m[1] === "00") {
      results.push({
        full: m[0],
        hour,
        minute: parseInt(m[2], 10),
        index: m.index,
      });
    }
  }
  return results;
}

function has12hTime(text) {
  // Check if text contains a 12-hour time with AM/PM
  // Matches "9:05 AM", "8 PM" (hour only), etc.
  return /(?<!\d)\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)(?!:)/i.test(text);
}

// --- markdown_spoken --------------------------------------------------

function findMarkdownSpoken(text) {
  // ** bold markers
  if (/\*\*/.test(text)) return "**";
  // line starting with #
  if (/^#/m.test(text)) return "#";
  // list markers: - , * , 1. 
  if (/^- /m.test(text)) return "- ";
  if (/^\* /m.test(text)) return "* ";
  if (/^1\. /m.test(text)) return "1. ";
  return null;
}

// --- repeated_sentence ------------------------------------------------

function splitSentences(text) {
  // Split on ". ", "! ", "? " and end of text
  const parts = text.split(/(?<=[.!?])\s+/);
  return parts.filter((s) => s.length > 0);
}

function normalizeSentence(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "");
}

function findRepeatedSentence(text) {
  const sentences = splitSentences(text);
  const seen = new Map(); // normalized -> first sentence text
  for (const sent of sentences) {
    const norm = normalizeSentence(sent);
    if (seen.has(norm)) {
      return sent.slice(0, 60);
    }
    seen.set(norm, sent);
  }
  return null;
}

// --- lintReply --------------------------------------------------------

export function lintReply(text, opts = {}) {
  if (typeof text !== "string") {
    throw new TypeError("text must be a string");
  }
  const { spoken = false } = opts;
  const findings = [];

  // meta_talk
  const metaExcerpt = findMetaTalk(text);
  if (metaExcerpt) {
    findings.push({ rule: "meta_talk", excerpt: metaExcerpt });
  }

  // time_24h
  const times24 = find24hTimes(text);
  if (times24.length > 0) {
    findings.push({ rule: "time_24h", excerpt: times24[0].full.slice(0, 60) });
  }

  // time_both
  if (times24.length > 0 && has12hTime(text)) {
    findings.push({ rule: "time_both", excerpt: text.slice(0, 60) });
  }

  // markdown_spoken (spoken only)
  if (spoken) {
    const md = findMarkdownSpoken(text);
    if (md) {
      findings.push({ rule: "markdown_spoken", excerpt: md });
    }
  }

  // too_long_spoken (spoken only)
  if (spoken && text.length > 320) {
    findings.push({ rule: "too_long_spoken", excerpt: text.slice(0, 60) });
  }

  // repeated_sentence
  const rep = findRepeatedSentence(text);
  if (rep) {
    findings.push({ rule: "repeated_sentence", excerpt: rep });
  }

  return findings;
}

// --- fixReply ---------------------------------------------------------

export function fixReply(text, opts = {}) {
  if (typeof text !== "string") {
    throw new TypeError("text must be a string");
  }
  const { spoken = false } = opts;
  let result = text;
  const changed = [];

  // Fix time_24h and time_both: rewrite 24h times to 12h, drop duplicates
  const times24 = find24hTimes(result);
  if (times24.length > 0) {
    // Process from end to start to preserve indices
    for (let i = times24.length - 1; i >= 0; i--) {
      const t = times24[i];
      const replacement = clock12(t.hour, t.minute);

      // Check if there's a 12h duplicate in brackets or after em dash nearby
      // Pattern: "20:32 GMT+1 (8:32 PM)" or "20:32 — 8:32 PM"
      const afterTime = result.slice(t.index + t.full.length);

      // Look for timezone token then parenthesized 12h time, or em-dash then 12h time
      const tzParenRe = /^\s*(?:GMT[+-]\d+|BST|UTC)?\s*\((\d{1,2}:\d{2}\s*(?:AM|PM))\)/i;
      const tzDashRe = /^\s*(?:GMT[+-]\d+|BST|UTC)?\s*[—–-]\s*(\d{1,2}:\d{2}\s*(?:AM|PM))/i;

      let mParen = afterTime.match(tzParenRe);
      let mDash = afterTime.match(tzDashRe);

      if (mParen) {
        // Replace the 24h time + tz + parenthesized 12h with just the 12h
        const fullMatch = t.full + afterTime.slice(0, mParen[0].length);
        result = result.slice(0, t.index) + mParen[1] + result.slice(t.index + fullMatch.length);
      } else if (mDash) {
        // Replace the 24h time + tz + dash + 12h with just the 12h
        const fullMatch = t.full + afterTime.slice(0, mDash[0].length);
        result = result.slice(0, t.index) + mDash[1] + result.slice(t.index + fullMatch.length);
      } else {
        // Just rewrite the 24h time to 12h
        result = result.slice(0, t.index) + replacement + result.slice(t.index + t.full.length);
      }
    }
    changed.push("time_24h");
  }

  // Fix markdown_spoken (spoken only)
  if (spoken) {
    // Remove ** bold markers
    result = result.replace(/\*\*/g, "");

    // Handle list items: join lines starting with - , * , 1. 
    // First, collect list lines and their preceding context
    const lines = result.split("\n");
    const joined = [];
    let prevNonList = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const listMatch = line.match(/^(\s*[-*]|\s*\d+\.)\s+(.*)/);
      if (listMatch) {
        joined.push(listMatch[2]);
      } else {
        // If we have accumulated list items, join them with ", " and append to previous non-list line
        if (joined.length > 0) {
          const listText = joined.join(", ");
          if (prevNonList !== null) {
            lines[prevNonList] = lines[prevNonList] + " " + listText;
          } else {
            // No preceding non-list line, prepend to current line
            lines[i] = listText + " " + line;
          }
          joined.length = 0;
        }
        if (line.trim().length > 0 || i < lines.length - 1) {
          prevNonList = i;
        }
      }
    }
    // Handle remaining list items at end
    if (joined.length > 0) {
      const listText = joined.join(", ");
      if (prevNonList !== null) {
        lines[prevNonList] = lines[prevNonList] + " " + listText;
      } else {
        result = listText;
      }
    }

    // Remove leading # from lines
    result = lines
      .map((l) => l.replace(/^#+\s*/, ""))
      .join("\n");

    changed.push("markdown_spoken");
  }

  // Fix repeated_sentence: keep first occurrence
  const sentences = splitSentences(result);
  const seen = new Set();
  const kept = [];
  for (const sent of sentences) {
    const norm = normalizeSentence(sent);
    if (seen.has(norm)) {
      changed.push("repeated_sentence");
    } else {
      seen.add(norm);
      kept.push(sent);
    }
  }
  result = kept.join(" ");

  return { text: result, changed };
}
