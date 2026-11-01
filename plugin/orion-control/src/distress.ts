// Distress handling, decided by code before any flow, tool or model.
// 2026-10-16 live sweep: "i literally cant do this anymore" got the front desk's canned "Want to take a
// break?" (never asked if he was safe, no resources), and "im so overwhelmed i dont even know where to
// start" sent the worker to search his brain and read two agendas, then read him a quiz schedule (16 s).

// Words that may mean he is not safe. Narrow on purpose: "I can't do this task", "end it at 5" or
// "kill the lights" are ordinary requests, so every phrase here needs its "anymore"/"all"/"myself".
// "hopeless" counts only about himself or his life — "this code is hopeless" is a bug report.
// REV5 MUST 3 (2026-10-31): "i hate being alive", "i dont like living", "i dont mind dying", "i like the idea of not waking up" and
// "remember i hate my life" were none of them distress, so the preference saver kept them ("Nick doesn't like being alive"). Covered
// now by category, not by sentence: being against living or life; being drawn to dying, death, not waking up, sleeping forever,
// disappearing or not existing; wishing to disappear; no point / not worth living; rather be dead. The same rule as above for idioms:
// where a following word tells (living IN london, dying TO see, dying MY hair, death OF a salesman, rather die THAN), it stays clear.
const AGAINST = String.raw`(?:hate|hating|can['’]?t stand|cant stand|sick of|tired of|done with|(?:don['’]?t|dont|do not) (?:like|enjoy|love))`;
const LIVING = String.raw`(?:being alive|living|(?:my |this )?life|existing|my existence|being me)`;
const PLACE_OR_THING = String.raw`(?!\s+(?:in|with|out|at|near|on|off|by|alone|here|there|together|next|so far|admin|hacks?|insurance|lessons?|coach|drawing|of the party|style|choices?|story|update)\b)`;
const TOWARD = String.raw`(?:(?:don['’]?t|dont|do not|wouldn['’]?t|wouldnt|would not) mind|(?:like|love) the (?:idea|thought) of|(?:ok|okay|fine|at peace|cool) with|look(?:ing)? forward to|wish(?:ing)? for|long(?:ing)? for|ready (?:for|to)|welcome|think(?:ing)? (?:a lot |so much )?about|fantasi[sz]e about|dream(?:ing)? (?:about|of)|prefer|(?:like|love|want|wanna|would like|['’]?d like) to)`;
const GONE = String.raw`(?:dying|death|being dead|not existing|not being alive|not being here|(?:not|never) waking up|disappearing|vanishing|sleeping forever|sleep forever|disappear|vanish|stop existing|not exist|cease to exist|die)`;
const NOT_IDIOM = String.raw`(?!\s+(?:to|of|for|from|laughing|inside|my|his|her|the|it|them|into|under|behind|stranding|metal|note|row)\b)`;
const LIFE_AND_DEATH = [
  String.raw`\b${AGAINST}\s+${LIVING}\b${PLACE_OR_THING}`,
  String.raw`\b${TOWARD}\s+${GONE}\b${NOT_IDIOM}`,
  String.raw`\b(?:don['’]?t|dont|wouldn['’]?t|wouldnt) (?:mind|care) if i (?:die|died|didn['’]?t wake up|didnt wake up|don['’]?t wake up|dont wake up|never woke up|disappeared|wasn['’]?t here|wasnt here)\b${NOT_IDIOM}`,
  String.raw`\b(?:hope|wish|pray)(?:\s+that)?\s+i\s+(?:don['’]?t|dont|do not|never|won['’]?t|wont)\s+wake up\b(?!\s+(?:late|early|before|at|in time|tired|sick|with|to|until|till|for|on|hungover|groggy|and|in a|in the)\b)`,
  String.raw`\b(?:go|went|fall|falling|going) to sleep and (?:not|never) wake up\b|\bsleep and not wake up\b|\bnever wake up again\b`,
  String.raw`\bwish (?:i could|i['’]?d|i would|i) (?:just )?(?:disappear|vanish|stop existing|not exist|cease to exist|die)\b(?!\s+(?:into|under|behind|for|from|of|laughing)\b)|\bwish i (?:didn['’]?t|didnt|did not) exist\b`,
  String.raw`\bno point (?:in |to )?(?:anything|life|living|being alive|being here|existing|going on|carrying on|any of (?:this|it)|me being here|trying any ?more)\b`,
  String.raw`\blife (?:is|feels|seems|['’]s)(?: so| completely| totally| just)? (?:pointless|meaningless|worthless|not worth (?:it|living))\b|\blife (?:isn['’]?t|isnt|is not|ain['’]?t) worth\b|\bnot worth living\b|\bnothing (?:left )?to live for\b`,
  String.raw`\bwhat['’]?s the point (?:of|in) (?:living|life|being alive|existing|going on)\b`,
  String.raw`\b(?:i['’]?d|id|i would) rather (?:be dead|not be alive|not exist|die)\b(?!\s+than\b)`,
];

/** The life-and-death space by itself (REV5): what must never be read as a preference, a plan or a setting, even where isCrisis's
 *  narrower idiom rules would let a line through. Broad on purpose: a false hold costs only the worker answering instead. */
export const touchesLifeOrDeath = (message: string): boolean =>
  CRISIS.test(message) || /\b(?:alive|living|life|lives|dying|die|died|death|dead|suicid\w*|kill\w*|existing|exist|existence|disappear\w*|vanish\w*|(?:not|never|don'?t|dont) wak(?:e|ing) up|sleep(?:ing)? forever|forever asleep)\b/i.test(message);

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
  // 2026-10-16 (re-review): the first narrowing missed "live like this anymore", "be here, i'm done", "wake up ever again".
  // Now: any of anymore / at all / ever again / like this (in any order) counts with anything after; otherwise an optional
  // tomorrow/today/tonight must end the clause (comma, full stop or end of message). Loose on purpose: a miss costs more.
  String.raw`\b(don['’]?t|do not) (?:want to|wanna) be alive\b|\b(don['’]?t|do not) (?:want to|wanna) (live|exist|wake up|be here)(?:(?:\s+(?:any ?more|at all|ever again|like this))+\b|(?:\s+(?:tomorrow|today|tonight))?(?=\s*(?:[,.;!?]|$)))`,
  // 2026-10-16 round 6 (final round tightened "never wake up", "end it here/early/if", "miss me if"): common phrasings that were never covered. Idioms stay clear where a lookahead can tell:
  // "end it at 5" / "ending it with a bang" / "disappear into my bed for a nap" are not crises. Where it cannot
  // (e.g. "i want to disappear for a while" without an article), it matches: a false alarm is cheaper than a miss.
  String.raw`\bwish (?:i|he|she) (?:was|were) (?:dead|never born)\b|\bwish i (?:wasn['’]?t|weren['’]?t) (?:alive|born)\b`,
  String.raw`\b(?:sleep and|sleep &|want to|wanna) never (?:to )?wake up\b|\b(?:no ?one|nobody) (?:would|will|['’]?d) (?:even )?miss me\b(?!\s+if i (?:skip|miss|don['’]?t go|leave early)\b)`,
  String.raw`\b(?:thinking (?:about|of)|going to|gonna|want to|wanna|planning to) end(?:ing)? it\b(?!\s+(?:at|with|on|by|before|after|for|here|early))`,
  String.raw`\b(?:want|wanna) (?:it all|everything|all of it|this all) (?:to end|to be over|over)\b`,
  String.raw`\b(?:want to|wanna) (?:disappear|vanish)\b(?!\s+(?:into|under|behind|for (?:a|an|the|some|my)\b))`,
  String.raw`\bwhat['’]?s the point( of (anything|living|it all|life|trying))?\s*[.?!]*$`,
  // "hopeless" counts only about himself or his life — not "this code is hopeless" or "hopeless at cooking".
  // 2026-10-16: "i'm a hopeless romantic" is an idiom, so an article before "hopeless" no longer counts.
  // "want to die laughing" stays excluded above: the explicit "laughing" makes the idiom unambiguous.
  String.raw`\b(i|i['’]?m|im|i am|feel\w*|everything(?:['’]s| is)?|it all(?: is)?|life(?: is)?)\s+(?:(?!an?\b)\w+\s+)?hopeless\b(?!\s+(at|with|romantic))`,
  ...LIFE_AND_DEATH,
].join("|"), "i");

// Heavy but not a crisis: he needs warmth and one small step, not a lookup.
const OVERWHELMED = /\b(overwhelm\w*|stressed out|so stressed|burn(t|ed) out|freaking out|panick?ing|so anxious|can['’]?t cope|falling apart|(don['’]?t|do not) (even )?know where to (start|begin))\b/i;

// Nick lives in London: UK numbers. Fixed text, spoken in three short sentences.
export const CRISIS_REPLY = "I'm really sorry it feels this heavy, Nick, and I'm glad you told me. Are you safe right now? If you might be in danger call 999, and you can call Samaritans free any time on 116 123 or NHS on 111 — I'm here too if you want to talk.";

// 2026-10-19: when the rest of a cut-off message (a continuation) is a concrete request that code then actually ran ("put CS lab until
// ten thirty"), the first half has already had CRISIS_REPLY and he is not sent the same paragraph again: the request's own reply stays and
// this check-in line follows it. Anything else in a continuation (more about how he feels, "i've got the pills here") keeps CRISIS_REPLY.
export const SUPPORT_LINE = "Are you safe right now? If not, call 999, or Samaritans free on 116 123.";

export const OVERWHELMED_NOTE = "Nick is feeling overwhelmed. Answer with warmth in two short spoken sentences: say you hear him, then suggest ONE small first step he could take in the next few minutes (a breath, a stretch, writing down the one thing due first). Do not call any tools, do not look anything up, and do not read out his schedule.";

export const isCrisis = (message: string): boolean => CRISIS.test(message);
export const isOverwhelmed = (message: string): boolean => !isCrisis(message) && OVERWHELMED.test(message);
