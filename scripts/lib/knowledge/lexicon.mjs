// Fixed vocabularies for the deterministic extractors: course codes, Mac apps, and the words that are never a person.

/** Northeastern-style course codes: CS2100, ECON1115, MKTG2201. */
export const COURSE_CODE = /\b([A-Z]{2,5})\s?(\d{4})\b/g;

/**
 * Apps by the names he uses for them. Generic words ("calendar", "music", "notes") only count with the
 * "Apple" in front, because "my calendar" is a schedule, not an app.
 */
const APPS = [
  ["Calendar", /\bApple Calendar\b/i], ["Reminders", /\bApple Reminders\b/i], ["Notes", /\bApple Notes\b/i],
  ["Music", /\bApple Music\b/i], ["Mail", /\bApple Mail\b/i], ["Messages", /\b(Apple|i)Messages\b/i],
  ["Safari", /\bSafari\b/], ["Chrome", /\b(Google )?Chrome\b/], ["Xcode", /\bXcode\b/i], ["Terminal", /\bTerminal\b/],
  ["VS Code", /\b(VS ?Code|Visual Studio Code)\b/i], ["Spotify", /\bSpotify\b/i], ["Discord", /\bDiscord\b/i],
  ["Slack", /\bSlack\b/], ["Notion", /\bNotion\b/], ["Obsidian", /\bObsidian\b/], ["Zoom", /\bZoom\b/],
  ["Gmail", /\bGmail\b/i], ["YouTube", /\bYouTube\b/i], ["Instagram", /\bInstagram\b/i], ["TikTok", /\bTikTok\b/i],
  ["LeetCode", /\bleet ?code\b/i], ["Whoop", /\bWhoop\b/], ["Sentient OS", /\bSentient OS\b/i], ["Finder", /\bFinder\b/],
];

export const appMentions = (line) => APPS.filter(([, re]) => re.test(line)).map(([name]) => name);

/** The canonical app name for a raw frontmost-app name, or the raw name. */
export const appName = (raw) => APPS.find(([name, re]) => name.toLowerCase() === String(raw).toLowerCase() || re.test(String(raw)))?.[0] ?? String(raw);

const NOT_A_PERSON = new Set([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "today", "tomorrow", "tonight",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "orion", "claude", "chatgpt", "codex", "openclaw", "apple", "google", "calendar", "reminders", "london", "new", "jersey",
  "university", "northeastern", "whoop", "discord", "gym", "class", "classes", "lab", "the", "a", "an", "my", "his", "her",
  "it", "this", "that", "me", "you", "him", "them", "us", "i", "ollama", "macbook", "mac", "iphone", "phone", "focus",
  "deepgram", "elevenlabs", "anthropic", "openai", "gpt", "lecture", "seminar", "midterm", "exam", "quiz",
]);

/** Capitalised names after with/meet/call/text/see: "Studying with Priya", "coffee with Priya". */
export function personNames(line, known = new Set()) {
  const out = [];
  for (const m of line.matchAll(/\b(?:with|meet|meeting|met|call|called|text|texted|see|seeing|visit|visiting)\s+([A-Z][a-z]{2,})\b/g)) {
    const name = m[1];
    const lower = name.toLowerCase();
    if (NOT_A_PERSON.has(lower) || known.has(lower) || APPS.some(([app]) => app.toLowerCase() === lower)) continue;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** Words too common to identify a goal or a course by ("finish resume" is found by "resume", not "finish"). */
export const STOPWORDS = new Set([
  "finish", "start", "review", "practice", "practise", "submit", "about", "thing", "things", "today", "tomorrow",
  "introduction", "principles", "lecture", "seminar", "program", "design", "implementation", "fundamentals", "with",
  "from", "into", "this", "that", "your", "have", "make", "work", "study", "the", "and", "for", "time", "week",
  "class", "write", "read", "prep", "plan", "call", "email", "book", "check", "orion", "learning",
]);

export const significantWords = (text, min = 4) =>
  String(text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= min && !STOPWORDS.has(w) && !/^\d+$/.test(w));
