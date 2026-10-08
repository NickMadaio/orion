// Sort Nick's requests into the jobs the V3 campaign tests, so test weights and
// the battery-per-hour estimate follow real use (ORION V3 handoff §5.2 step 5).
// Keyword rules, first match wins; "other" when nothing fits — counts are read
// alongside a hand-checked sample, never trusted alone.
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)

const RULES = [
  ["phone-lock", /unblock|\bunlock|phone (use|time|apps?)|more minutes|\bmy apps\b|screen time/i],
  ["focus", /focus session|\bsession\b|lock ?down|\bpomodoro/i],
  ["reminder", /\bremind|\balarm|wake me/i],
  ["lights", /\blights?\b|\blamp\b|led strip/i],
  ["weather", /weather|\brain\b|umbrella|temperature|forecast|\bcold\b|\bhot\b|high today|fahrenheit|celsius/i],
  ["health", /supplement|vitamin|magnesium|zinc|calcium|creatine|\bsleep\b|\bslept\b|recovery|whoop|\bwater\b|\bate\b|\bdrank\b|workout|\bgym\b(?!.* to \d)/i],
  ["media", /\bmusic\b|\bsong\b|\bplay\b|\bpause\b|\bvolume\b|playlist|spotify/i],
  ["app", /^(can you )?(open|show|go to)\b|\bopen (up )?(orion|the app|the file)/i],
  ["brain", /\bnotes?\b|obsidian|\bbrain\b|remember (that|I)|what did I say|\bsave (that|this|it) for later/i],
  ["todo", /to-?dos?\b|task list|\badd .* to my (list|tasks)/i],
  ["schedule", /schedule|re-?plan|\bresched|\bmove\b|\bswap\b|\bbook\b|\bfit\b|my day\b|calendar|\bblock\b|\bpush\b.*\b(to|back)\b/i],
  ["agenda", /what'?s next|what do I have|what'?s on|\bagenda\b|\bplan for today\b/i],
  ["time", /what time|what'?s the time|what day is/i],
  ["chat", /how'?s it going|how are you|\bthanks?\b|thank you|good (morning|night)|\bhello\b|\bhi\b|\bhey\b/i],
];

const CONTINUATION = /^\(Continuing\b/i;
const FOLLOW_UP_MAX_WORDS = 6;

/** `previous`: the job of Nick's turn just before, when it was moments ago in the same thread. */
export function jobOf(text = "", previous = null) {
  const t = text.trim();
  if (previous && CONTINUATION.test(t)) return previous;
  const words = t.split(/\s+/).filter(Boolean).length;
  const matched = RULES.find(([, re]) => re.test(t))?.[0];
  if (matched && (words >= 2 || /^(thanks|hi|hey|hello)\b/i.test(t))) return matched;
  return previous && words <= FOLLOW_UP_MAX_WORDS ? previous : "other";
}
