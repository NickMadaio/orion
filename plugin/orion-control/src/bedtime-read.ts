/*
 Reading a request to change his bedtime (w20 routegate, 2026-11-04). Nick: "make sure he can change my bed time and wake time".
 Pure; bedtime-change.ts carries it out through orion-sleepplan, the one writer.

   "push my bedtime to, um, eleven forty five"   set 23:45 (tonight)         "bed at quarter to 12"          set 23:45 (every night)
   "push bedtime back 30 min"                     tonight 30 min later        "move bedtime up half an hour"   tonight 30 min earlier
   "i want to sleep at 11 tonight"                set 23:00 tonight           "from now on bedtime 11"        set 23:00 every night
   "make my bedtime 11:30 pm"                     set 23:30 every night       "bedtime later pls"             tonight 30 min later

 Scope (w20 fix-sleep): "tonight / just / this once" = tonight only; "from now on / every night / always / usually" = every night; a bedtime
 NOUN with set/make/change or "is" ("change my bedtime to 11", "my bedtime is 11 now") is every night; EVERYTHING else is tonight, so "ill sleep
 at 1" and "going to bed at 11" never rewrite the standing bedtime or switch the sleep-need cap off. "go back to normal bedtime" / "reset my
 bedtime" clears the exact standing bedtime. The reply says which, and how to switch. A bedtime hour has to be 8 PM to 4 AM: a bare
 8-11 is PM, 12 is midnight, 1-4 is AM; 5-7 with no am/pm is unclear, so nothing is read and the model asks.
 Not a request: a question ("what's my bedtime"), a statement of going ("im going to bed at 11"), a wake time, a negation.
*/
import { normalizeSpoken } from "./spoken-numbers.js";
import { relativeClock } from "./clock-relative.js";

export type BedChange =
  | { time: string; scope: "tonight" | "always" }
  | { shift: number; scope: "tonight" | "always" }
  /** "go back to normal bedtime": the exact standing bedtime (bedFixed) and any tonight override are cleared. */
  | { reset: true; scope: "always" };

const FILLER = /\b(?:um+|uh+|erm|hmm+|like|just|literally|basically|actually|please|pls|plz|orion|hey|ok(?:ay)?|so|really|for me|real quick|lol|ish|ya know|you know)\b[,]?/g;
const BED = String.raw`(?:bed\s?times?|bed\s?tims?|bedtimes?|sleep\s?times?|lights?\s?out|asleep[- ]by|go(?:ing)? to (?:bed|sleep))`;
const VERB = /\b(?:push|move|shift|set|change|make|put|bump|adjust|reschedule|update|have|let)\b/;
const WANT = /\b(?:i\s+(?:want|wanna|need|would like|'?d like|'?d rather)|can we|can you|could you|lets|let'?s|gonna|going to)\b/;
const PAST_SLEEP = /\b(?:went|got|was|fell|passed out|crashed|slept|woke|been)\b.{0,20}\b(?:bed|sleep|asleep)\b|\b(?:slept|fell asleep|went to bed|got to bed|got into bed)\b/;
const QUESTION_START = /^(?:what|whats|when|why|how|is|are|does|do you|did|was|which)\b/;
const NEGATED = /\b(?:don'?t|dont|do not|never|stop|cancel|forget|not)\b.{0,12}\b(?:bed\s?time|sleep|bed)\b/;
const TONIGHT = /\b(?:tonight|tn|just (?:for )?(?:tonight|today|now)|this once|for now|only tonight|today)\b/;
const STANDING = /\b(?:from now on|every night|each night|always|usually|permanently|normally|every day|nightly|by default|standing|going forward|in general)\b/;
const BEDN = String.raw`(?:bed\s?times?|sleep\s?times?)`;
const RESET = new RegExp([
  String.raw`\b(?:reset|clear|undo|remove|unfix|unlock|revert|drop|ditch|scrap)\b.{0,20}\b${BEDN}\b`,
  String.raw`\b(?:back to|return to|revert to|go back to|going back to)\b.{0,16}\b(?:normal|usual|regular|default|automatic|auto|old)\b.{0,12}\b${BEDN}\b`,
  String.raw`\b${BEDN}\b.{0,16}\b(?:back to|to) (?:normal|usual|regular|default|automatic|auto)\b`,
  String.raw`\b(?:stop|quit|no more|enough)\b.{0,8}\b(?:using|with|having)\b.{0,8}\b(?:a |an |the )?(?:fixed|set|exact|specific|manual)\b.{0,8}\b${BEDN}\b`,
  String.raw`\b(?:go|going) back to the (?:computed|calculated|worked out|automatic) ${BEDN}\b`,
  // "work it out from my alarm again": the bedtime is computed from the alarm; it never touches the alarm itself.
  String.raw`\b(?:work|working|figure|figuring|calculate|calculating|compute|computing)\b(?: my| the)?(?: ${BEDN})?(?: it)?(?: ${BEDN})? out\b.{0,16}\b(?:from|off|based on|by) (?:my |the )?(?:alarm|wake)`,
].join("|"));
const NOUN = /\b(?:bed\s?times?|sleep\s?times?)\b/;
const SET_VERB = /\b(?:set|make|change|update|adjust|switch|put)\b/;
const MER = String.raw`(a\.?m\.?|p\.?m\.?)`;
const TIME_AT = new RegExp(String.raw`(?:\b(?:to|at|by|for|around|about|is|be|=|till|until)\s+|${BED}\s+|\b(?:bed|sleep)\s+)(\d{1,2})(?::(\d{2}))?\s*${MER}?(?![\d:])(?!\s*(?:min|mins|minutes|hours?|hrs?|h\b|%|times))`);
const SHIFT_AMT = /\b(?:by\s+)?(\d{1,3})\s*(h(?:ours?|rs?)?|m(?:in(?:ute)?s?)?)\b|\b(an? hour|half an? hour|half hour|hour and a half|quarter of an hour|an? quarter)\b/;
const BACK = /\b(?:back|later|forward|out|further|off|up later)\b/;
const EARLIER = /\b(?:earlier|up|sooner|ahead|before)\b/;

const pad = (n: number): string => String(n).padStart(2, "0");

/** A bedtime clock, 20:00 to 04:00: undefined when it cannot be one. */
function bedClock(h: number, m: number, mer?: string): string | undefined {
  if (m > 59 || h < 0 || h > 24) return undefined;
  let hour: number;
  if (mer) { if (h < 1 || h > 12) return undefined; hour = h === 12 ? 0 : h + (/^p/i.test(mer) ? 12 : 0); }   // "12" with either meridiem is midnight: nobody sleeps at noon
  else if (h >= 13) hour = h;
  else if (h >= 8 && h <= 11) hour = h + 12;
  else if (h === 12) hour = 0;
  else if (h >= 1 && h <= 4) hour = h;
  else return undefined;
  hour %= 24;
  const total = hour < 12 ? hour * 60 + m + 1440 : hour * 60 + m;
  return total >= 20 * 60 && total <= 1440 + 4 * 60 ? `${pad(hour)}:${pad(m)}` : undefined;
}

function shiftMinutes(m: string): number | undefined {
  if (/\bhalf an? hour\b|\bhalf hour\b/.test(m)) return 30;
  if (/\bhour and a half\b/.test(m)) return 90;
  if (/\bquarter of an hour\b|\ban? quarter\b/.test(m)) return 15;
  if (/\ban? hour\b/.test(m)) return 60;
  const a = SHIFT_AMT.exec(m);
  if (!a?.[1]) return undefined;
  const n = Number(a[1]);
  return /^h/i.test(a[2] ?? "") ? n * 60 : n;
}

/** "ten to 12", "quarter to midnight", "11 45", "11.45", "midnight", "bedtime is eleven fifteen": every clock as H:MM digits, for a message that is about a bedtime. */
function clockWords(text: string): string {
  let t = text.replace(/\b(?:is|be|=)\s+(?=(?:twelve|eleven|ten|nine|midnight)\b)/g, "at ");
  t = relativeClock(t, { digits: true });
  t = t.replace(/\bmidnight\b/g, "12:00");
  t = t.replace(/\b(0?\d|1\d|2[0-3])[ .]([0-5]\d)(?![\d:]|\s*(?:min|mins|minutes|hours?|hrs?|h\b|%|times))/g, "$1:$2");
  return normalizeSpoken(t);
}

/** The bedtime change in his message, or undefined. */
export function readBedtimeChange(message: string): BedChange | undefined {
  // Fillers and commas go first so "to, um, eleven forty five" reads as "to eleven forty five" before the numbers are normalised.
  const m = clockWords(normalizeSpoken(message.toLowerCase().replace(/[’`]/g, "'").replace(FILLER, " ").replace(/[,;]/g, " ").replace(/\s+/g, " ").trim()));
  if (!m || m.length > 200) return undefined;
  if (QUESTION_START.test(m)) return undefined;
  if (RESET.test(m) && !/\d/.test(m)) return { reset: true, scope: "always" };
  if (/\b(?:wake|alarm|get up)\b/.test(m)) return undefined;
  if (NEGATED.test(m)) return undefined;
  if (!new RegExp(BED).test(m) && !/\bsleep(?:ing)? at\b|\bbed at\b|\bto sleep\b|\bheading to bed\b|\boff to bed\b/.test(m)) return undefined;
  // Past tense ("went to bed at 1", "slept at 3") is a sleep log, not a change. "going to bed at 11" / "sleeping at 11:45" is tonight's bedtime.
  if (PAST_SLEEP.test(m)) return undefined;
  const standing = STANDING.test(m);
  const tonight = TONIGHT.test(m);
  const t = TIME_AT.exec(m);
  if (t?.[1]) {
    const time = bedClock(Number(t[1]), Number(t[2] ?? 0), t[3]);
    if (!time) return undefined;
    if (!VERB.test(m) && !WANT.test(m) && !standing && !/\b(?:bed\s?time|sleep\s?time)\b/.test(m) && !/\b(?:sleep(?:ing)?|bed|going to (?:bed|sleep)|heading to bed|off to (?:bed|sleep)|gonna sleep|gonna go to bed) at\b/.test(m)) return undefined;
    const pushed = /\b(?:push|move|shift|bump)\b/.test(m);
    const named = NOUN.test(m) && (SET_VERB.test(m) || WANT.test(m) || /\b(?:bed\s?times?|sleep\s?times?) (?:is|=)\b/.test(m));
    return { time, scope: tonight ? "tonight" : standing || named && !pushed ? "always" : "tonight" };
  }
  if (!/\bbed\s?time\b|\bsleep\s?time\b/.test(m)) return undefined;
  const dir = BACK.test(m) ? 1 : EARLIER.test(m) ? -1 : 0;
  if (!dir) return undefined;
  const amount = shiftMinutes(m);
  if (amount === undefined && dir < 0) return undefined;   // "sleep earlier" with no amount is the habit reader's (sleep-plan-read.ts)
  return { shift: dir * (amount ?? 30), scope: standing ? "always" : "tonight" };
}

// "going to bed at 11:30, set an alarm for 7": the bedtime is the first clause and the alarm time belongs to the alarm clause (w20 fix-sleep).
const ALARM_CLAUSE = /(?:[,;.]\s*|\s+(?:and|then|also|plus|&)\s+)(?=(?:(?:and|also|then)\s+)?(?:(?:set|put|make|add)\b[^,;.]{0,25}\b(?:alarm|wake)|wake\s+me|(?:an? )?alarm\b|get me up))/i;

/** A bedtime clause followed by an alarm clause: the bedtime change and the alarm clause's own text, or undefined. */
export function readBedtimeWithAlarm(message: string): { change: BedChange; alarmText: string } | undefined {
  const hit = ALARM_CLAUSE.exec(message);
  if (!hit) return undefined;
  const change = readBedtimeChange(message.slice(0, hit.index));
  const alarmText = message.slice(hit.index + hit[0].length).replace(/^(?:and|also|then)\s+/i, "").trim();
  return change && !("reset" in change) && alarmText ? { change, alarmText } : undefined;
}
