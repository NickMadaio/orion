/*
 Spoken clock times told from the next hour, as digits (w20 round 4, 2026-11-05). Pure.
 Nick: "im heading to bed at ten to twelve" was read as 22:00, because "at ten" became 10 before "to twelve" was seen.

   "ten to twelve" 11:50     "quarter to midnight" 11:45     "twenty past 11" 11:20     "five past midnight" 12:05
   "twenty five to one" 12:35     "ten to 12 am" 11:50pm     "half past 11" 11:30     "half 11" 11:30 (bare half only when asked for)

 "N to H" is H minus N minutes (the hour before), "N past H" is H plus N. No meridiem in, none out: the caller decides AM or PM.
 Digit minute counts ("10 to 12") are only read when the caller knows the whole message is about a clock (a bedtime); words
 are read after a time preposition, so "from ten to twelve" (a range) is left alone.
*/
const HOURS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, midnight: 12 };
const MINUTE_WORDS: Record<string, number> = { five: 5, ten: 10, quarter: 15, twenty: 20, "twenty five": 25 };
const HOUR_RE = `(?:${Object.keys(HOURS).join("|")}|\\d{1,2})`;
const MER = String.raw`(?:\s*(a\.?\s?m\.?|p\.?\s?m\.?)(?![a-z]))?`;
// Only words that put a time on a clock: "for five to six minutes" and "about ten to twelve people" are amounts.
const PREP = String.raw`(?:at|by|till|until|around|bedtime|bed|sleep|alarm\s+(?:for|to)|wake(?:\s+me)?(?:\s+up)?\s+(?:at|for|to)|=)`;
const NOT_AMOUNT = String.raw`(?!\s+(?:minutes?|mins?|hours?|hrs?|seconds?|secs?|days?|weeks?|months?|years?|times?|people|guys|items?|things?|bottles|pages|sets|reps|miles|dollars|bucks))`;
const WORDS = "twenty[\\s-]five|twenty|quarter|ten|five";

const hourOf = (s: string): number | undefined => (/^\d+$/.test(s) ? Number(s) : HOURS[s]);
const flip = (mer: string): string => (/^p/i.test(mer) ? "am" : "pm");
const keep = (mer: string): string => (/^p/i.test(mer) ? "pm" : "am");

function build(minutes: number, dir: string, hourWord: string, mer: string | undefined): string | undefined {
  const h = hourOf(hourWord.toLowerCase());
  if (h === undefined || h < 1 || h > 12) return undefined;
  if (/^(?:past|after)$/.test(dir)) return `${h}:${String(minutes).padStart(2, "0")}${mer ? keep(mer) : ""}`;
  const before = h === 1 ? 12 : h - 1;
  return `${before}:${String(60 - minutes).padStart(2, "0")}${mer ? (h === 12 ? flip(mer) : keep(mer)) : ""}`;
}

/** Words ("ten to twelve") after a time preposition; with `digits`, also "10 to 12", anywhere. */
export function relativeClock(text: string, { digits = false }: { digits?: boolean } = {}): string {
  const word = new RegExp(String.raw`(?<=\b${PREP}\s)(${WORDS})\s+(to|past|after)\s+(${HOUR_RE})\b${MER}${NOT_AMOUNT}`, "gi");
  let out = text.replace(word, (whole, n: string, dir: string, hour: string, mer?: string) => {
    const minutes = MINUTE_WORDS[n.toLowerCase().replace(/[\s-]+/g, " ")];
    return (minutes === undefined ? undefined : build(minutes, dir.toLowerCase(), hour, mer)) ?? whole;
  });
  if (!digits) return out;
  // The whole message is a bedtime: no preposition needed ("bedtime ten to twelve"), digit counts allowed, "half 11" is 11:30.
  const loose = new RegExp(String.raw`\b(${WORDS}|5|10|15|20|25)\s+(to|past|after)\s+(${HOUR_RE})\b${MER}${NOT_AMOUNT}`, "gi");
  out = out.replace(loose, (whole, n: string, dir: string, hour: string, mer?: string) => {
    const minutes = /^\d+$/.test(n) ? Number(n) : MINUTE_WORDS[n.toLowerCase().replace(/[\s-]+/g, " ")];
    return (minutes === undefined ? undefined : build(minutes, dir.toLowerCase(), hour, mer)) ?? whole;
  });
  return out;
}
