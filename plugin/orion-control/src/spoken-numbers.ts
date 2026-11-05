/*
 One spoken-number normaliser, run ahead of every parser (w20 routegate, 2026-11-04).

 Voice and fast typing give words where the parsers expect digits: "button six", "f thirteen", "at eleven forty five", "for twenty minutes".
 Each route used to cope in its own way and most did not (the mouse route turned "button six ... f thirteen" into a status dump).
 This is the one place that turns them into digits, conservatively: a number word only becomes a digit where the words around it make it
 a button, a key, a clock time or a count ("one more thing", "two of them", "for one" are left alone). Pure; the message is otherwise untouched.
*/
const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const VALUE = new Map<string, number>([...UNITS.map((w, i) => [w, i] as const), ...TEENS.map((w, i) => [w, 10 + i] as const), ...TENS.map((w, i) => [w, i * 10] as const).filter(([w]) => w)]);
const TENS_RE = TENS.filter(Boolean).join("|");
const UNIT_RE = UNITS.slice(1).join("|");
/** 1-99 as words: "six", "fifteen", "forty five", "forty-five". */
const NUM = String.raw`(?:(?:${TENS_RE})(?:[\s-]+(?:${UNIT_RE}))?|${TEENS.join("|")}|${UNITS.join("|")})`;
/** Hours on a clock face. */
const HOUR = String.raw`(?:twelve|eleven|ten|nine|eight|seven|six|five|four|three|two|one)`;
/** Minutes past the hour: "oh five", "fifteen", "forty five". */
const MINUTES = String.raw`(?:(?:oh|o)\s+(?:${UNIT_RE})|(?:${TENS_RE})(?:[\s-]+(?:${UNIT_RE}))?|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)`;
const MERIDIEM = String.raw`(?:a\.?\s?m\.?|p\.?\s?m\.?)(?![a-z])`;
const PREP = String.raw`(?:at|to|for|from|until|till|by|around|after|before|bedtime|wake me up at|alarm for|alarm to)`;
// What a bare hour word followed by these is NOT a time ("for two hours", "to three people", "at six of them").
const NOT_CLOCK_AFTER = String.raw`(?!\s+(?:minutes?|mins?|hours?|hrs?|seconds?|secs?|times?|days?|weeks?|months?|years?|more|other|another|things?|of|people|guys|sets?|reps?|miles?|km|percent|dollars?|bucks|items?|\w+s\b))`;

const num = (words: string): number | undefined => {
  const parts = words.toLowerCase().trim().split(/[\s-]+/).filter(Boolean);
  if (!parts.length) return undefined;
  const values = parts.map((p) => VALUE.get(p));
  if (values.some((v) => v === undefined)) return undefined;
  return values.length === 2 && (values[0] as number) >= 20 && (values[0] as number) % 10 === 0 && (values[1] as number) < 10 ? (values[0] as number) + (values[1] as number) : values.length === 1 ? (values[0] as number) : undefined;
};
const minutesOf = (words: string): number | undefined => {
  const m = /^(?:oh|o)\s+(.+)$/i.exec(words.trim());
  if (m) { const n = num(m[1]!); return n !== undefined && n < 10 ? n : undefined; }
  const n = num(words);
  return n !== undefined && n >= 10 && n <= 59 ? n : undefined;
};
const clock = (hour: number, minute: number | undefined, suffix = ""): string => `${hour}${minute === undefined ? "" : `:${String(minute).padStart(2, "0")}`}${suffix}`;
const meridiem = (s: string): string => (/^p/i.test(s.replace(/\s/g, "")) ? "pm" : "am");

/** "half past seven" / "quarter to eight" / "quarter after six". */
const RELATIVE = new RegExp(String.raw`\b(half|quarter)\s+(past|after|to)\s+(${HOUR}|\d{1,2})\b(?:\s*(${MERIDIEM}))?`, "gi");
/** British "half six", "half 6": half past, after a time preposition only ("at half 6"). */
const HALF = new RegExp(String.raw`\b(${PREP})\s+half\s+(${HOUR}|\d{1,2})\b(?!\s+(?:an?|hour|the|of|past|to)\b)`, "gi");
/** "eleven forty five pm", "ten pm", "seven thirty am": a meridiem makes any hour word a time. */
const WITH_MERIDIEM = new RegExp(String.raw`\b(${HOUR})(?:\s+(${MINUTES}))?\s*(${MERIDIEM})`, "gi");
/** "six o'clock". */
const OCLOCK = new RegExp(String.raw`\b(${HOUR})\s+o'?\s?clock\b`, "gi");
/** "at eleven forty five", "from ten", "to eleven": a time preposition, then an hour word that is not "one" on its own. */
const AFTER_PREP = new RegExp(String.raw`\b(${PREP})\s+(${HOUR})(?:\s+(${MINUTES}))?\b${NOT_CLOCK_AFTER}`, "gi");
/** "f thirteen", "function 13", "f-13". */
const FKEY = new RegExp(String.raw`\b(?:f|function)[\s-]*(${NUM}|\d{1,2})\b(?![\s-]*(?:minutes?|mins?|hours?|hrs?))`, "gi");
/** "button six", "button number six". */
const BUTTON = new RegExp(String.raw`\b(button|btn)\s+(?:number\s+|no\.?\s+|#)?(${NUM})\b`, "gi");
/** "twenty minutes", "three sets": a count before a unit. */
const COUNT = new RegExp(String.raw`\b(${NUM})\s+(min|mins|minutes?|hours?|hrs?|seconds?|sets?|reps?|miles?|km|times|days)\b`, "gi");

export function normalizeSpoken(text: string): string {
  if (!text) return text;
  let out = text.replace(RELATIVE, (whole, kind: string, dir: string, hour: string, mer?: string) => {
    const h = /^\d+$/.test(hour) ? Number(hour) : num(hour);
    if (h === undefined || h < 1 || h > 12) return whole;
    const suffix = mer ? meridiem(mer) : "";
    const k = kind.toLowerCase(), d = dir.toLowerCase();
    if (d === "to") return k === "quarter" ? clock(h === 1 ? 12 : h - 1, 45, suffix) : whole;
    return clock(h, k === "half" ? 30 : 15, suffix);
  });
  out = out.replace(HALF, (whole, prep: string, hour: string) => { const h = /^\d+$/.test(hour) ? Number(hour) : num(hour); return h === undefined || h < 1 || h > 12 ? whole : `${prep} ${clock(h, 30)}`; });
  out = out.replace(WITH_MERIDIEM, (whole, hour: string, mins: string | undefined, mer: string) => {
    const h = num(hour); const m = mins === undefined ? undefined : minutesOf(mins);
    if (h === undefined || (mins !== undefined && m === undefined)) return whole;
    return clock(h, m, meridiem(mer));
  });
  out = out.replace(OCLOCK, (whole, hour: string) => { const h = num(hour); return h === undefined ? whole : String(h); });
  out = out.replace(AFTER_PREP, (whole, prep: string, hour: string, mins?: string) => {
    const h = num(hour); const m = mins === undefined ? undefined : minutesOf(mins);
    if (h === undefined) return whole;
    if (mins !== undefined && m === undefined) return `${prep} ${h} ${mins}`; // "at six forty" is not a time we can read, keep his words for the rest
    if (h === 1 && m === undefined) return whole; // "to one" / "for one" is a word, not a clock
    return `${prep} ${clock(h, m)}`;
  });
  out = out.replace(FKEY, (whole, n: string) => {
    const v = /^\d+$/.test(n) ? Number(n) : num(n);
    return v !== undefined && v >= 1 && v <= 24 ? `f${v}` : whole;
  });
  out = out.replace(BUTTON, (whole, word: string, n: string) => { const v = num(n); return v === undefined ? whole : `${word} ${v}`; });
  out = out.replace(COUNT, (whole, n: string, unit: string) => { const v = num(n); return v === undefined ? whole : `${v} ${unit}`; });
  return out;
}
