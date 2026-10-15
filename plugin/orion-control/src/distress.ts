// Distress handling, decided by code before any flow, tool or model.
// 2026-10-16 live sweep: "i literally cant do this anymore" got the front desk's canned "Want to take a
// break?" (never asked if he was safe, no resources), and "im so overwhelmed i dont even know where to
// start" sent the worker to search his brain and read two agendas, then read him a quiz schedule (16 s).

// Words that may mean he is not safe. Narrow on purpose: "I can't do this task", "end it at 5" or
// "kill the lights" are ordinary requests, so every phrase here needs its "anymore"/"all"/"myself".
const CRISIS = /\b(can['’]?t|cannot) (do|take|handle) (this|it) (any ?more|no more)\b|\bcan['’]?t go on( like this| any ?more)?\s*[.!]*$|\b(want|wanna|going) to die\b|\bkill(ing)? myself\b|\bend (it all|my life)\b|\b(hurt|harm)(ing)? myself\b|\bsuicid\w*|\bself[- ]harm\w*|\bno (reason|point) (to live|in living|going on)\b|\bhopeless\b|\bbetter off (dead|without me)\b/i;

// Heavy but not a crisis: he needs warmth and one small step, not a lookup.
const OVERWHELMED = /\b(overwhelm\w*|stressed out|so stressed|burn(t|ed) out|freaking out|panick?ing|so anxious|can['’]?t cope|falling apart|(don['’]?t|do not) (even )?know where to (start|begin))\b/i;

// Nick lives in London: UK numbers. Fixed text, spoken in three short sentences.
export const CRISIS_REPLY = "I'm really sorry it feels this heavy, Nick, and I'm glad you told me. Are you safe right now? If you might be in danger call 999, and you can call Samaritans free any time on 116 123 or NHS on 111 — I'm here too if you want to talk.";

export const OVERWHELMED_NOTE = "Nick is feeling overwhelmed. Answer with warmth in two short spoken sentences: say you hear him, then suggest ONE small first step he could take in the next few minutes (a breath, water, writing down the one thing due first). Do not call any tools, do not look anything up, and do not read out his schedule.";

export const isCrisis = (message: string): boolean => CRISIS.test(message);
export const isOverwhelmed = (message: string): boolean => !isCrisis(message) && OVERWHELMED.test(message);
