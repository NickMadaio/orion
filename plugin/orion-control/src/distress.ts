// Distress handling, decided by code before any flow, tool or model.
// 2026-10-16 live sweep: "i literally cant do this anymore" got the front desk's canned "Want to take a
// break?" (never asked if he was safe, no resources), and "im so overwhelmed i dont even know where to
// start" sent the worker to search his brain and read two agendas, then read him a quiz schedule (16 s).

// Words that may mean he is not safe. Narrow on purpose: "I can't do this task", "end it at 5" or
// "kill the lights" are ordinary requests, so every phrase here needs its "anymore"/"all"/"myself".
// "hopeless" counts only about himself or his life — "this code is hopeless" is a bug report.
const CRISIS = new RegExp([
  String.raw`\b(can['’]?t|cannot) (do|take|handle) (this|it) (any ?more|no more)\b`,
  String.raw`\bcan['’]?t go on( like this| any ?more)?\s*[.!]*$`,
  // About himself only: "my laptop is going to die" and "I'm going to die if I miss this bus" are not (review, 2026-10-16).
  String.raw`\b(i|i['’]?m|im|i am)\s+(\w+\s+)?(want|wanna|going|gonna) to die\b(?!\s+(if|of|from|when|laughing))`,
  String.raw`\bkill(ing)? myself\b|\bkms\b|\bunalive\b`,
  String.raw`\bend (it all|my life)\b`,
  // Ongoing or intended, not "i hurt myself at the gym".
  String.raw`\b(keep|kept) (hurting|harming) myself\b|\b(want to|wanna|going to|gonna|thinking (about|of)) (hurt|harm)(ing)? myself\b`,
  // 2026-10-16 (review HIGH 5): "suicide squad" is a film. \b after \w* stops backtracking from dodging the lookahead.
  String.raw`\bsuicid\w*\b(?!\s+squad)|\bself[- ]harm\w*`,
  String.raw`\bno (reason|point) (to live|in living|going on)\b|\bbetter off (dead|without me)\b`,
  // 2026-10-16 (review HIGH 5): "dont want to wake up at 6" / "be here for the standup" / "live in london" are plans.
  // "be alive" always counts; live / wake up / be here count only when they end the message or carry "anymore" /
  // "tomorrow" / "at all" with nothing after. A false alarm is cheaper than a miss, so the tail is kept loose.
  String.raw`\b(don['’]?t|do not) want to be alive\b|\b(don['’]?t|do not) want to (live|wake up|be here)(\s+(any ?more|at all)\b|(\s+(tomorrow|today|tonight|like this))?\s*[.!]*$)`,
  String.raw`\bwhat['’]?s the point( of (anything|living|it all|life|trying))?\s*[.?!]*$`,
  // "hopeless" counts only about himself or his life — not "this code is hopeless" or "hopeless at cooking".
  // 2026-10-16: "i'm a hopeless romantic" is an idiom, so an article before "hopeless" no longer counts.
  // "want to die laughing" stays excluded above: the explicit "laughing" makes the idiom unambiguous.
  String.raw`\b(i|i['’]?m|im|i am|feel\w*|everything(?:['’]s| is)?|it all(?: is)?|life(?: is)?)\s+(?:(?!an?\b)\w+\s+)?hopeless\b(?!\s+(at|with|romantic))`,
].join("|"), "i");

// Heavy but not a crisis: he needs warmth and one small step, not a lookup.
const OVERWHELMED = /\b(overwhelm\w*|stressed out|so stressed|burn(t|ed) out|freaking out|panick?ing|so anxious|can['’]?t cope|falling apart|(don['’]?t|do not) (even )?know where to (start|begin))\b/i;

// Nick lives in London: UK numbers. Fixed text, spoken in three short sentences.
export const CRISIS_REPLY = "I'm really sorry it feels this heavy, Nick, and I'm glad you told me. Are you safe right now? If you might be in danger call 999, and you can call Samaritans free any time on 116 123 or NHS on 111 — I'm here too if you want to talk.";

export const OVERWHELMED_NOTE = "Nick is feeling overwhelmed. Answer with warmth in two short spoken sentences: say you hear him, then suggest ONE small first step he could take in the next few minutes (a breath, water, writing down the one thing due first). Do not call any tools, do not look anything up, and do not read out his schedule.";

export const isCrisis = (message: string): boolean => CRISIS.test(message);
export const isOverwhelmed = (message: string): boolean => !isCrisis(message) && OVERWHELMED.test(message);
