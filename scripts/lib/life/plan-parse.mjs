import { strict as assert } from "node:assert";

export const DEFAULT_MINUTES = {
  class: 90,
  social: 120,
  meal: 45,
  gym: 60,
  study: 60,
  errand: 45,
  side_project: 60,
  rest: 30,
  other: 60,
};

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function splitClauses(text) {
  // Split on ", then", "then", " and then ", ";", and ", " before a clause with its own time/activity
  let parts = text.split(/,\s*then\b|\bthen\b|\band\s+then\b|;/);
  // Also split on ", " but only if the next part has a time or activity word
  let result = [];
  for (const part of parts) {
    const subParts = part.split(/,\s+/);
    for (let i = 0; i < subParts.length; i++) {
      const sub = subParts[i].trim();
      if (!sub) continue;
      if (i === 0 || hasTimeOrActivity(sub)) {
        result.push(sub);
      } else {
        // append to previous clause
        if (result.length > 0) {
          result[result.length - 1] += ", " + sub;
        } else {
          result.push(sub);
        }
      }
    }
  }
  return result;
}

function hasTimeOrActivity(s) {
  const lower = s.toLowerCase();
  // time indicators
  if (/\b\d{1,2}(?::\d{2})?\s*(am|pm)?\b/.test(lower)) return true;
  if (/\b(noon|midnight)\b/.test(lower)) return true;
  if (/\bat\s+\d/.test(lower)) return true;
  // activity indicators
  const activities = [
    "gym", "run", "workout", "lift", "study", "revise", "homework", "reading",
    "groceries", "laundry", "clean", "errand", "haircut", "dinner", "lunch",
    "breakfast", "meal", "party", "club", "drinks", "date", "meet", "friends",
    "side project", "vlog", "video", "youtube", "editing", "nap", "rest", "break",
    "lecture", "seminar", "lab", "class", "meal prep", "clean",
    "soccer practice", "football practice", "team practice"
  ];
  for (const a of activities) {
    if (lower.includes(a)) return true;
  }
  return false;
}

function parseDate(token, now) {
  const lower = token.toLowerCase();
  let targetWeekday = null;
  let offsetDays = 0;

  if (lower === "today" || lower === "tonight") {
    return now.date;
  }
  if (lower === "tomorrow" || lower === "tmrw") {
    offsetDays = 1;
  } else if (lower.startsWith("next ")) {
    const wdName = lower.slice(5);
    const wdIdx = WEEKDAYS.indexOf(wdName);
    if (wdIdx >= 0) {
      targetWeekday = wdIdx;
      offsetDays = 7; // "next <weekday>" means the one after this week's
    }
  } else {
    const wdIdx = WEEKDAYS.indexOf(lower);
    if (wdIdx >= 0) {
      targetWeekday = wdIdx;
      offsetDays = 0; // will be adjusted below
    }
  }

  if (targetWeekday !== null) {
    // weekday name: next such day (today if time is still ahead, else next week)
    const diff = targetWeekday - now.weekday;
    if (diff <= 0) {
      offsetDays = diff + 7;
    } else {
      offsetDays = diff;
    }
    // If today and the time has already passed, push to next week
    // This is handled by the caller checking start vs now.minute
  }

  if (offsetDays === 0 && targetWeekday === null) {
    return now.date;
  }

  const d = new Date(now.date + "T12:00:00");
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function parseTime(token) {
  const lower = token.toLowerCase();

  // "from X till Y" / "X-Y" / "X to Y"
  let m = lower.match(/\b(from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+(till|to)\s+|\s*(-)\s*)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (m) {
    const startH = parseInt(m[2], 10);
    const startM = m[3] ? parseInt(m[3], 10) : 0;
    const startAmPm = m[4] ? m[4].toLowerCase() : null;
    const endH = parseInt(m[7], 10);
    const endM = m[8] ? parseInt(m[8], 10) : 0;
    const endAmPm = m[9] ? m[9].toLowerCase() : null;

    const startMin = toMinutes(startH, startM, startAmPm);
    const endMin = toMinutes(endH, endM, endAmPm);

    let duration = endMin - startMin;
    if (duration <= 0) duration += 1440; // crossing midnight

    return { start: startMin, minutes: duration };
  }

  // "at N", "Npm", "N:MM", "19:00", "noon", "midnight"
  m = lower.match(/\b(at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (m) {
    const h = parseInt(m[2], 10);
    const min = m[3] ? parseInt(m[3], 10) : 0;
    const amPm = m[4] ? m[4].toLowerCase() : null;
    return { start: toMinutes(h, min, amPm), minutes: null };
  }

  if (lower.includes("noon")) return { start: 720, minutes: null };
  if (lower.includes("midnight")) return { start: 0, minutes: null };

  // "after class", "after lunch", "this afternoon", "this evening"
  if (lower.includes("after") || lower.includes("afternoon") || lower.includes("evening")) {
    return { start: null, minutes: null, assumed: lower.includes("afternoon") ? "afternoon" : lower.includes("evening") ? "evening" : null };
  }

  return null;
}

function toMinutes(h, m, amPm) {
  if (amPm) {
    if (amPm === "am") {
      if (h === 12) h = 0;
    } else {
      if (h !== 12) h += 12;
    }
    return h * 60 + m;
  }
  // 24-hour or bare hour — caller handles bare-hour ambiguity
  return h * 60 + m;
}

function resolveBareHour(h, kind, clauseLower, now) {
  // 1-6 are PM
  if (h >= 1 && h <= 6) return h + 12;
  // 7-11 are AM unless social/dinner/tonight/evening or passed today
  if (h >= 7 && h <= 11) {
    const isSocialOrDinner = kind === "social" || clauseLower.includes("dinner");
    const isTonightEvening = clauseLower.includes("tonight") || clauseLower.includes("evening");
    const passedToday = now.date && h * 60 <= now.minute;
    if (isSocialOrDinner || isTonightEvening || passedToday) {
      return h + 12;
    }
    return h;
  }
  // 12 is noon
  if (h === 12) return 12;
  // 0 or >=13: 24-hour, use as-is
  return h;
}

function parseDuration(token) {
  const lower = token.toLowerCase();

  // "for an hour", "for 2 hours", "45 minutes", "like 45 min", "an hour and a half"
  let m = lower.match(/\b(?:for\s+)?(?:like\s+)?(\d+)\s*(?:minutes?|mins?|m)\b/i);
  if (m) return parseInt(m[1], 10);

  m = lower.match(/\ban\s+hour\b/);
  if (m) return 60;

  m = lower.match(/\b(\d+)\s+hours?\b/);
  if (m) return parseInt(m[1], 10) * 60;

  // "an hour and a half"
  if (lower.includes("hour and a half") || lower.includes("hour and half")) return 90;

  return null;
}

function detectKind(clauseLower) {
  // Check in priority order as specified
  const socialWords = ["with", "friends", "party", "club", "drinks", "date", "meet", "soccer practice", "football practice", "team practice"];
  const mealWords = ["dinner", "lunch", "breakfast", "meal prep", "meal"];
  const gymWords = ["gym", "run", "workout", "lift"];
  const studyWords = ["study", "revise", "homework", "problem set", "reading"];
  const errandWords = ["groceries", "laundry", "clean", "errand", "haircut"];
  const sideProjectWords = ["side project", "vlog", "video", "youtube", "editing"];
  const restWords = ["nap", "rest", "break"];
  const classWords = ["lecture", "seminar", "lab", "class"];

  // "with <someone>" makes it social even if meal words present
  const hasWith = /\bwith\b/.test(clauseLower);
  const hasMealWord = mealWords.some(w => clauseLower.includes(w));
  const hasSocialWord = socialWords.some(w => clauseLower.includes(w));

  if (hasMealWord && hasWith) return "social";
  if (hasSocialWord || (hasMealWord && hasWith)) return "social";
  if (hasMealWord) return "meal";
  if (gymWords.some(w => clauseLower.includes(w))) return "gym";
  if (studyWords.some(w => clauseLower.includes(w))) return "study";
  if (errandWords.some(w => clauseLower.includes(w))) return "errand";
  if (sideProjectWords.some(w => clauseLower.includes(w))) return "side_project";
  if (restWords.some(w => clauseLower.includes(w))) return "rest";
  if (classWords.some(w => clauseLower.includes(w))) return "class";

  // Unrecognized activity: default to "social" if evening/night context, else "other"
  const isEvening = clauseLower.includes("tonight") || clauseLower.includes("evening");
  if (isEvening) return "social";

  return "other";
}

function extractTitle(clause) {
  // Joining words and sequencing ("and before that", "then after class") are not
  // part of what he is doing (Claude, 2026-09-30).
  let title = clause.replace(/^\s*(?:(?:and|then|also|but|so|plus)\s+)*(?:(?:before|after)\s+(?:that|this|class|lunch|dinner)\s*,?\s*)?/i, "");

  // Remove time expressions — "from X till Y" range first, then individual times
  title = title.replace(/\b(?:from\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?(?:\s+(?:till|to)\s+|\s*-\s*)\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, "");
  title = title.replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, "");
  title = title.replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, "");
  title = title.replace(/\b(noon|midnight)\b/gi, "");
  // Remove date expressions
  title = title.replace(/\b(?:today|tonight|tomorrow|tmrw)\b/gi, "");
  title = title.replace(/\bnext\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, "");
  title = title.replace(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, "");

  // Remove duration expressions — order matters: longest first
  title = title.replace(/\ban?\s+hour\s+(?:and\s+(?:a\s+)?)?half\b/gi, "");
  title = title.replace(/\b(?:for\s+)?(?:like\s+)?\d+\s*(?:minutes?|mins?)\b/gi, "");
  title = title.replace(/\bfor\s+an?\s+hour\b/gi, "");
  title = title.replace(/\b\d+\s+hours?\b/gi, "");

  // Any number left after time ranges and durations were removed is a bare hour.
  title = title.replace(/\b\d{1,2}\b/g, "");

  // Remove "after X", "this afternoon/evening" (anywhere in string)
  title = title.replace(/\bafter\s+(?:class|lunch|work|school|breakfast|dinner|noon)\b/gi, "");
  title = title.replace(/\bthis\s+(?:afternoon|evening|morning)\b/gi, "");

  // Remove leading filler phrases — try longest matches first
  // Handle all common apostrophe variants: ', ', '
  const apos = /['\u2019\u2018']/;
  title = title.replace(new RegExp(`^\\s*i${apos.source}\\s*m\\s+going\\s+to`, "i"), "");
  title = title.replace(new RegExp(`^\\s*i${apos.source}\\s*m\\s+having`, "i"), "");
  title = title.replace(/^\s*i\s+have\s+/i, "");
  title = title.replace(/^\s*going\s+(?:home\s+)?(?:to\s+)?/i, "");
  title = title.replace(/^\s*add\s+/i, "");
  title = title.replace(/^\s*the\s+/i, "");

  // Remove leading "to " that may remain after other strips
  title = title.replace(/^\s*to\s+/i, "");

  // Trim whitespace and punctuation artifacts
  title = title.replace(/^[,;\s-]+|[,;\s-]+$/g, "").trim();

  // Collapse multiple spaces
  title = title.replace(/\s{2,}/g, " ").trim();

  // Capitalise first letter (sentence case)
  if (title.length > 0) {
    title = title[0].toUpperCase() + title.slice(1);
  }

  return title;
}

function hasActivityWords(clauseLower) {
  const activityKeywords = [
    "gym", "run", "workout", "lift", "study", "revise", "homework", "reading",
    "groceries", "laundry", "clean", "errand", "haircut", "dinner", "lunch",
    "breakfast", "meal", "party", "club", "drinks", "date", "meet", "friends",
    "side project", "vlog", "video", "youtube", "editing", "nap", "rest", "break",
    "lecture", "seminar", "lab", "class", "meal prep",
    "soccer practice", "football practice", "team practice"
  ];
  for (const kw of activityKeywords) {
    if (clauseLower.includes(kw)) return true;
  }
  // "with friends" etc. counts as social activity
  if (/\bwith\s+\w+\b/.test(clauseLower)) return true;
  // If there's a time expression and the clause would produce a title, treat it as an activity
  // This handles cases like "Ministry of Sound from 10 till 2" where no keyword matches
  if (hasTimePattern(clauseLower)) return true;
  return false;
}

function hasTimePattern(s) {
  if (/\b\d{1,2}(?::\d{2})?\s*(am|pm)?\b/.test(s)) return true;
  if (/\b(noon|midnight)\b/.test(s)) return true;
  if (/\bat\s+\d/.test(s)) return true;
  if (/\b(from\s+\d|\d\s+(till|to|-)\s+\d)/i.test(s)) return true;
  return false;
}

export function parsePlans(text, now) {
  if (now == null) throw new TypeError("now must be provided");
  if (typeof now.date !== "string") throw new TypeError("now.date must be a string");
  if (typeof now.minute !== "number") throw new TypeError("now.minute must be a number");
  if (typeof now.weekday !== "number") throw new TypeError("now.weekday must be a number");

  const clauses = splitClauses(text);
  const items = [];

  for (const clause of clauses) {
    const lower = clause.toLowerCase();

    if (!hasActivityWords(lower)) continue;

    let kind = detectKind(lower);
    const dateToken = extractDateToken(lower, now);
    const timeInfo = extractTimeInfo(lower, kind, now);
    const duration = extractDurationFromClause(lower);
    const title = extractTitle(clause);

    if (!title) continue;

    let minutes;
    const assumed = [];

    if (timeInfo && timeInfo.minutes !== null) {
      minutes = timeInfo.minutes;
    } else if (duration !== null) {
      minutes = duration;
    } else {
      minutes = DEFAULT_MINUTES[kind] || 60;
      assumed.push(`${minutes} min`);
    }

    if (timeInfo && timeInfo.assumed) {
      assumed.push(timeInfo.assumed);
    }

    const fixed = kind === "class" || kind === "social";

    items.push({
      title,
      kind,
      date: dateToken || now.date,
      start: timeInfo ? timeInfo.start : null,
      minutes,
      fixed,
      assumed,
    });
  }

  return items;
}

function extractDateToken(lower, now) {
  // Check for explicit date words
  const dateWords = ["today", "tonight", "tomorrow", "tmrw"];
  for (const w of dateWords) {
    if (lower.includes(w)) return parseDate(w, now);
  }

  // "next <weekday>"
  let m = lower.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (m) {
    const wdName = m[1].toLowerCase();
    const wdIdx = WEEKDAYS.indexOf(wdName);
    // "next <weekday>" → the one after this week's
    const d = new Date(now.date + "T12:00:00");
    let diff = wdIdx - now.weekday;
    if (diff <= 0) diff += 7;
    diff += 7; // next week
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  // weekday name
  m = lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (m) {
    const wdName = m[1].toLowerCase();
    const wdIdx = WEEKDAYS.indexOf(wdName);
    const d = new Date(now.date + "T12:00:00");
    let diff = wdIdx - now.weekday;
    if (diff <= 0) diff += 7;
    // If today and time has passed, push to next week — handled by start check
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  return now.date;
}

function extractTimeInfo(lower, kind, now) {
  // "from X till Y" / "X-Y" / "X to Y"
  let m = lower.match(/\b(from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+(till|to)\s+|\s*(-)\s*)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (m) {
    let startH = parseInt(m[2], 10);
    const startM = m[3] ? parseInt(m[3], 10) : 0;
    const startAmPm = m[4] ? m[4].toLowerCase() : null;
    let endH = parseInt(m[7], 10);
    const endM = m[8] ? parseInt(m[8], 10) : 0;
    const endAmPm = m[9] ? m[9].toLowerCase() : null;

    const rawStart = startH;
    const rawEnd = endH;
    if (!startAmPm) startH = resolveBareHour(startH, kind, lower, now);
    // End time: skip bare-hour resolution when range crosses midnight (raw end < raw start)
    if (!endAmPm && !(rawEnd < rawStart)) {
      endH = resolveBareHour(endH, kind, lower, now);
    }

    const startMin = toMinutes(startH, startM, startAmPm);
    const endMin = toMinutes(endH, endM, endAmPm);

    let duration = endMin - startMin;
    if (duration <= 0) duration += 1440;

    return { start: startMin, minutes: duration };
  }

  // "at N", "Npm", "N:MM"
  m = lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const amPm = m[3] ? m[3].toLowerCase() : null;

    if (!amPm) {
      h = resolveBareHour(h, kind, lower, now);
    }

    return { start: toMinutes(h, min, amPm), minutes: null };
  }

  // bare "Npm" or "N:MM AM/PM" without "at"
  m = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (m) {
    const h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const amPm = m[3].toLowerCase();
    return { start: toMinutes(h, min, amPm), minutes: null };
  }

  // "noon" / "midnight"
  if (lower.includes("noon")) return { start: 720, minutes: null };
  if (lower.includes("midnight")) return { start: 0, minutes: null };

  // bare hour without am/pm and without "at" — e.g. "groceries at 5" already caught above
  // Check for bare number that looks like an hour
  m = lower.match(/\b(\d{1,2})\b/);
  if (m) {
    let h = parseInt(m[1], 10);
    if (h >= 1 && h <= 23) {
      h = resolveBareHour(h, kind, lower, now);
      return { start: h * 60, minutes: null };
    }
  }

  // "after class", "after lunch", "this afternoon", "this evening"
  if (lower.includes("after") || lower.includes("afternoon") || lower.includes("evening")) {
    let assumed = null;
    if (lower.includes("afternoon")) {
      assumed = "afternoon";
    } else if (lower.includes("evening")) {
      assumed = "evening";
    } else if (lower.includes("after")) {
      // "after class", "after lunch" etc. — infer from context
      if (lower.includes("lunch")) {
        assumed = "afternoon";
      } else {
        assumed = "afternoon"; // default for "after class" etc.
      }
    }
    return { start: null, minutes: null, assumed };
  }

  return null;
}

function extractDurationFromClause(lower) {
  // Check "an hour and a half" BEFORE "an hour" to avoid partial match
  if (lower.includes("hour and a half") || lower.includes("hour and half")) return 90;

  // "for an hour", "for 2 hours", "45 minutes", "like 45 min"
  let m = lower.match(/\b(?:for\s+)?(?:like\s+)?(\d+)\s*(?:minutes?|mins?)\b/i);
  if (m) return parseInt(m[1], 10);

  m = lower.match(/\ban\s+hour\b/);
  if (m) return 60;

  m = lower.match(/\b(\d+)\s+hours?\b/);
  if (m) return parseInt(m[1], 10) * 60;

  return null;
}
