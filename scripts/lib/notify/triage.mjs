import { strict as assert } from "node:assert";

const URGENT_WORDS = [
  "urgent", "emergency", "asap", "call me", "are you ok", "hospital",
  "cancelled", "canceled", "moved to", "room change", "deadline extended",
  "due in 1 hour", "fraud", "suspicious", "verification code", "2FA"
];

const PROMO_KEYWORDS = [
  "sale", "% off", "deal", "limited time", "unsubscribe",
  "new episode", "trending", "you might like", "recommended", "streak"
];

const PROMO_APPS = ["Temu", "Shein", "TikTok", "Instagram", "YouTube", "Reddit", "Duolingo"];

function isWithin30Min(a, b) {
  // a and b are { date, minute }
  const diffMs = Math.abs(dateToMs(a) - dateToMs(b));
  return diffMs <= 30 * 60 * 1000;
}

function dateToMs({ date, minute }) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, minute)).getTime();
}

function collapseWhitespace(s) {
  return s.replace(/\s+/g, " ").trim();
}

function makeSummary(note) {
  const sender = note.sender || note.app;
  const body = collapseWhitespace(note.body).slice(0, 80);
  return `${sender}: ${body}`;
}

function isQuietHour(minute, quiet) {
  const { start, end } = quiet;
  if (start <= end) {
    return minute >= start && minute < end;
  } else {
    // wraps midnight: e.g. 2250 to 0600
    return minute >= start || minute < end;
  }
}

function containsUrgentWord(text) {
  const lower = text.toLowerCase();
  return URGENT_WORDS.some(word => lower.includes(word));
}

function containsPromoKeyword(text) {
  const lower = text.toLowerCase();
  return PROMO_KEYWORDS.some(kw => lower.includes(kw));
}

function isMoneyAmount(body) {
  // £/$/€ followed by digits (possibly with decimals and commas)
  return /[\£$€]\s*[\d,]+\.?\d*/.test(body);
}

export function triage(note, opts = {}) {
  if (typeof note !== "object" || note === null) throw new TypeError("note must be an object");
  if (typeof note.app !== "string") throw new TypeError("note.app must be a string");
  if (typeof note.title !== "string") throw new TypeError("note.title must be a string");
  if (typeof note.body !== "string") throw new TypeError("note.body must be a string");
  if (typeof note.at !== "object" || note.at === null) throw new TypeError("note.at must be an object");
  if (typeof note.at.date !== "string") throw new TypeError("note.at.date must be a string");
  if (typeof note.at.minute !== "number") throw new TypeError("note.at.minute must be a number");

  const { now, vips = [], quiet = { start: 1410, end: 450 }, busy = false, seen = [] } = opts;

  const summary = makeSummary(note);
  const combinedText = (note.title + " " + note.body).toLowerCase();

  // Rule 1: duplicate check
  for (const s of seen) {
    if (s.app === note.app && s.sender === note.sender && s.body === note.body) {
      if (isWithin30Min(s.at, note.at)) {
        return { action: "drop", reason: "duplicate", summary };
      }
    }
  }

  // Rule 2: VIP check
  const senderLower = (note.sender || "").toLowerCase();
  for (const vip of vips) {
    const vipLower = vip.toLowerCase();
    if (senderLower.includes(vipLower) || vipLower.includes(senderLower)) {
      return { action: "now", reason: "vip", summary };
    }
  }

  // Rule 3: urgent words
  if (containsUrgentWord(note.title + " " + note.body)) {
    return { action: "now", reason: "urgent", summary };
  }

  // Rule 4: university and money
  const appLower = note.app.toLowerCase();
  const senderStr = note.sender || "";
  const bodyLower = note.body.toLowerCase();

  // Canvas or Outlook with Northeastern/nulondon
  if (appLower.includes("canvas") ||
      (appLower.includes("outlook") && (bodyLower.includes("northeastern") || bodyLower.includes("nulondon")))) {
    return { action: "now", reason: "school", summary };
  }

  // Monzo, Revolut, bank with currency amount
  if ((appLower.includes("monzo") || appLower.includes("revolut") || appLower.includes("bank")) && isMoneyAmount(note.body)) {
    return { action: "now", reason: "money", summary };
  }

  // Rule 5: marketing/promo
  const hasPromoKeyword = containsPromoKeyword(note.title + " " + note.body);

  // Check if it's a DM from IG/TikTok/Snapchat — those are NOT dropped
  const isDm = combinedText.includes("sent you a message") || combinedText.includes("messaged you");
  const socialDmApps = ["instagram", "tiktok", "snapchat"];
  const isSocialApp = socialDmApps.some(sa => sa === appLower);

  // Pure promo apps (always dropped)
  const purePromoApps = ["temu", "shein", "youtube", "reddit", "duolingo"];
  if (purePromoApps.includes(appLower)) {
    return { action: "drop", reason: "promo", summary };
  }

  // Social apps: dropped only if NOT a DM
  if (isSocialApp && !isDm) {
    return { action: "drop", reason: "promo", summary };
  }

  // Keyword-based promo drop (unless it's a social DM)
  if (hasPromoKeyword && !(isSocialApp && isDm)) {
    return { action: "drop", reason: "promo", summary };
  }

  // Rule 6: digest or drop based on quiet/busy
  const inQuiet = now ? isQuietHour(now.minute, quiet) : false;
  if (inQuiet || busy) {
    return { action: "digest", reason: "later", summary };
  }

  return { action: "digest", reason: "later", summary };
}

export function digest(items, { now }) {
  if (!Array.isArray(items)) throw new TypeError("items must be an array");
  if (typeof now !== "object" || now === null) throw new TypeError("now must be an object");

  if (items.length === 0) {
    return { text: "", count: 0 };
  }

  // Group by sender or app
  const groups = new Map();
  for (const item of items) {
    const key = item.note.sender || item.note.app;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
  }

  // Sort: by count desc, then name asc
  const sorted = [...groups.entries()].sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return a[0].localeCompare(b[0]);
  });

  let lines = [];
  const header = `While you were busy: ${items.length} messages.`;
  lines.push(header);

  const maxLines = 8; // max group lines
  let capped = false;
  for (const [name, groupItems] of sorted) {
    if (lines.length > maxLines) {
      capped = true;
      break;
    }
    // Latest summary body: take the last item in the group (most recent)
    const latest = groupItems[groupItems.length - 1];
    const bodySummary = collapseWhitespace(latest.note.body).slice(0, 80);
    lines.push(`${name} (${groupItems.length}): ${bodySummary}`);
  }

  if (capped) {
    const remaining = sorted.length - (lines.length - 1); // subtract header
    lines.push(`+${remaining} more`);
  }

  return { text: lines.join("\n"), count: items.length };
}
