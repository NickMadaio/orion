// What may reach Nick's chat. The chat is a conversation, so a line is a sentence for a person and nothing else:
//   - the output of an internal job ("[daily-memory] 2026-11-03: 4 requests -> /Users/…") is never a message;
//   - a notify event ("Orion | MILESTONE REACHED | standing-check\nHeads up …\nNo action needed.") is its sentence only,
//     and a digest ("Orion | HELD UPDATES | 1 update(s)\n- [MILESTONE REACHED] standing-check: …") is its sentences;
//   - clock times are 12-hour ("10:18 PM"), never "22:18".
// 2026-11-04 audit of phone-history.json: 40+ raw headers, one daily-memory dump with file paths, and bedtime lines in 24-hour time.

const INTERNAL_JOB = /^\s*\[[a-z][a-z0-9-]*\]\s/;
const EVENT_HEADER = /^\s*Orion \| (?!HELD UPDATES|\d+ UPDATES)[A-Z][A-Z -]*[A-Z] \| [^\n]*\n/;
const HELD_HEADER = /^\s*Orion \| HELD UPDATES \| [^\n]*\n/;
const RETRY_HEADER = /^\s*Orion \| \d+ UPDATES THAT DID NOT GO OUT\n/;
const NO_ACTION = /\n?No action needed\.\s*$/;
const HELD_LINE = /^- \[[A-Z][A-Z -]*[A-Z]\] [a-z0-9-]+: (.*)$/;
const RETRY_LINE = /^- [a-z0-9-]+: (.*)$/;

/**
 * Hours 13-23 and 00-09 written with two digits can only be a 24-hour clock; 10-12 are ambiguous without context
 * ("what was 12:30 to 3:30?" is Nick's own words) so they are left alone. Times already followed by AM/PM, and
 * seconds ("1:30:00"), are never touched.
 */
export function to12Hour(text) {
  return String(text ?? "").replace(/(?<![\w:])(\d{2}):([0-5]\d)(?![\w:]|\s?[AaPp]\.?[Mm])/g, (whole, hh, mm) => {
    const h = Number(hh);
    if (h > 23 || (h >= 10 && h <= 12)) return whole;
    const suffix = h >= 12 ? "PM" : "AM";
    return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${suffix}`;
  });
}

function unwrap(raw) {
  if (HELD_HEADER.test(raw)) {
    return raw.replace(HELD_HEADER, "").split("\n").map((l) => HELD_LINE.exec(l.trim())?.[1] ?? l.trim()).filter(Boolean).join("\n");
  }
  if (RETRY_HEADER.test(raw)) {
    return raw.replace(RETRY_HEADER, "").split("\n").map((l) => RETRY_LINE.exec(l.trim())?.[1] ?? l.trim()).filter(Boolean).join("\n");
  }
  if (EVENT_HEADER.test(raw)) return raw.replace(EVENT_HEADER, "").replace(NO_ACTION, "").trim();
  return raw.trim();
}

/** The text for the chat, or null when the message is internal plumbing and must not be shown at all. */
export function chatText(text) {
  const raw = String(text ?? "");
  if (!raw.trim() || INTERNAL_JOB.test(raw)) return null;
  const clean = to12Hour(unwrap(raw)).trim();
  return clean || null;
}
