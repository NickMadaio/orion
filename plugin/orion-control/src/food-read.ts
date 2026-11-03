/*
 Which chat turns are food estimates (w14 g-food, 2026-11-02). Pure: food-chat.ts carries them out through orion-food-estimate.

 Nick: "when tracking calories i can give a description or pictures of my food and Local AIs can try to come up with a somewhat
 accurate assessment of the macros."

   ask     "how many calories in a chicken burrito", "macros for 200g chicken and rice": estimate, offer "Log it?"
   that    "how many calories was that": the offer again, or the last meal logged without calories
   log     "log this: two eggs and toast", "track 2 bananas": estimate and log at once (he said log)
   meal    "had a chicken burrito and a coke for lunch" (health-log.ts readMeal, with a real food): logged at once, then sized
   photo   an image attached in chat: the plugin is given only that an image exists, never its bytes, so the food inbox it is
   yes / no / revise   a short reply to a live offer ("yeah log it", "nah", "it was a small one"), only while it is bound
   pick    with several offers waiting, the one he names ("the burger", "both", "the first one"); a bare yes asks which
   undo    "undo" within ten minutes of a food log in this chat
*/
import type { MealRead } from "./health-log.js";
import { readMeal } from "./health-log.js";

export type FoodTurn =
  | { kind: "ask"; text: string }
  | { kind: "that" }
  | { kind: "log"; text: string }
  | { kind: "meal"; read: MealRead }
  | { kind: "photo" }
  | { kind: "yes" }
  | { kind: "pick"; which: string }
  | { kind: "no"; which?: string }
  | { kind: "revise"; correction: string; which?: string }
  | { kind: "undo"; id: string; ids?: string[] };

/** The offer waiting in food-pending.json, as the plugin sees it. */
export type FoodPendingView = { at: number; via: "chat" | "inbox"; offerText: string; count?: number; names?: string[]; loggedId?: string };

export type FoodContext = {
  now: Date;
  /** Whether a meal statement may be sized (the runner is wired). */
  mealsOn: boolean;
  pending?: FoodPendingView;
  /** The offer is still the last thing in this chat (FoodMemory.bound). */
  bound?: boolean;
  attachments?: ReadonlyArray<{ kind?: string }>;
  lastLogged?: { id: string; ids?: string[]; at: number };
};

const UNDO_MS = 10 * 60_000;
const NUTRIENT = String.raw`(?:calories|calorie|cals|kcal|protein|carbs|carbohydrates|fat|macros)`;
/** His day totals, budget or goals are another question (code-answers / the worker), not a meal to estimate. */
const DAY_TOTAL = /\b(?:today|so far|this week|yesterday|left|remaining|goal|target|budget|should i|do i need|my calorie|my protein|my macros)\b/i;
const THAT = new RegExp(String.raw`^(?:and |so |ok |okay )?(?:how (?:many|much) ${NUTRIENT}(?: (?:was|is|are|were|in))? (?:that|it|this|those)|(?:what(?:'s|s| is| are|re)? )?(?:the )?${NUTRIENT} (?:on|in|for|of) (?:that|it|this|those)|(?:the )?${NUTRIENT})\??[.!]*$`, "i");
const ASK = new RegExp(String.raw`\b(?:how (?:many|much) ${NUTRIENT}(?: (?:is|are|was|were|does|do|would))?(?: (?:there|it|that|this))?(?: (?:in|for|of|on|have|be))?|${NUTRIENT} (?:in|for|of|on)|estimate (?:the |my )?${NUTRIENT}(?: (?:in|for|of|on))?(?: my [a-z]+)?|macro (?:check|estimate)(?: (?:on|for))?)\b`, "i");
const LOG = /^(?:please |pls |can you |could you )?(?:log|track)\s+(?:(?:this|that|these)\s*(?:meal|food)?\s*:\s*|(?:food|meal)\s*:\s*|(?=(?:a|an|some|two|three|four|half|\d+)\s))(.+)$/i;
const NOT_FOOD = /\b(?:workout|gym|lift(?:s|ed|ing)?|run|ran|water|bottles?|sleep|slept|weight|mood|hours?|minutes?|mins?|steps|study|period|expense|spent|[£$€]|meds?|medication|supplements?)\b/i;
const YES = /^(?:y|ya|yah|yes|yeah|yea|yep|yup|sure|ok|okay|k|please|please do|pls|do it|go ahead|go for it|sounds good|perfect|correct|right|that's right|thats right|log it|log that|add it|add that|save it|yes please|yeah please|yes log it|yeah log it|yep log it|sure log it|ok log it|yes add it)(?:\s+(?:please|pls|thanks|thank you|thx|ty))?$/i;
const NO = /^(?:n|no|nah|nope|no thanks|no thank you|nah thanks|don'?t|dont|don'?t log it|dont log it|don'?t bother|skip it|skip|never ?mind|forget it|leave it|not now|no need)$/i;
const CORRECTION = /\b(?:it was|was (?:a|an|just|only|more|less|about|like)|actually|only|just|half|small(?:er)?|large|big(?:ger)?|tiny|huge|didn'?t (?:have|eat|finish)|without|no (?:cheese|sauce|oil|mayo|dressing|rice|fries|chips|sugar|milk|bread|bun)|there was no|plus|also had|and (?:a|an|some)|with (?:a|an|some|extra)|extra|diet|zero|grams?|\d+\s?(?:g|ml|oz)\b|two|three|double|single)\b/i;
const NOT_A_CORRECTION = /\b(?:remind|move|schedule|book|cancel|calendar|gym|class|alarm|timer|lights?|text|call|email|weather|focus|session|tomorrow|tonight|at \d)\b|\?$/i;
const UNDO = /^(?:undo|undo (?:that|it)|remove (?:it|that)|delete (?:it|that)|take (?:it|that) (?:off|out)|scratch that|un-?log (?:it|that))$/i;
const PHOTO_WORDS = /^(?:|log (?:this|that|it)|track (?:this|that)|this|that|food|meal|breakfast|lunch|dinner|snack|how many (?:calories|cals) (?:is|in|was) (?:this|that)|macros\??|calories\??|estimate (?:this|that|it)|what about this)$/i;

/** Replies to "Logged … Fix anything?" (a photo already in his log): the entry is edited in place, so almost any short food-ish reply is a fix. */
const LOGGED_OK = /^(?:(?:ya|yeah|yep|yes|ok|okay|nah|nope|no)[, ]+)?(?:that'?s |thats |it'?s |its )?(?:fine|good|right|correct|perfect|all good|looks good|about right|close enough)$/;
const LOGGED_UNDO = /^(?:(?:nvm|nevermind|never mind|ok|okay|actually|pls|please)[, ]+)*(?:undo|remove|delete|take|scratch|un-?log|get rid of)(?: (?:it|that|this|that one|that entry|the entry))?(?: (?:off|out))?(?: (?:pls|please))?$/;
const FIX_HINT = /\b(?:\d+|no|not|without|more|less|like|about|around|instead|slices?|pieces?|bites?|cups?|bowls?|plates?|portion|serving|extra|add|plus|forgot|missing|wrong|half|quarter|whole|veggie|vegan|diet|zero|ate|had|was|were|only|just|too|bigger|smaller)\b/;
function readLogged(said: string, m: string, id: string): FoodTurn | null {
  if (LOGGED_UNDO.test(said)) return { kind: "undo", id };
  if (LOGGED_OK.test(said)) return /^(?:nah|nope|no)\b/.test(said) ? { kind: "no" } : { kind: "yes" };
  if (YES.test(said)) return { kind: "yes" };
  if (NO.test(said)) return { kind: "no" };
  if (said.length <= 140 && !NOT_A_CORRECTION.test(said) && (CORRECTION.test(said) || FIX_HINT.test(said))) return { kind: "revise", correction: m };
  return null;
}

const PICK_ALL = /^(?:both|all(?: of (?:them|em|those))?|all (?:three|3|two|2)|every one|everything|(?:the )?(?:first|second|third|last|1st|2nd|3rd)(?: one)?)$/;
const PICK_STOP = new Set(["the", "one", "ones", "log", "add", "just", "only", "please", "pls", "that", "this"]);
/** Which of several waiting offers he named, or null. Names come from food-pending.json ("cheeseburger and fries"). */
function picked(said: string, names: readonly string[]): boolean {
  const rest = said.replace(/^(?:(?:yes|yeah|yea|yep|ok|okay|sure)[, ]+)/, "").replace(/^(?:(?:log|add|just|only)\s+)+/, "").replace(/\s+(?:please|pls)$/, "").trim();
  if (rest.length > 40) return false;
  if (PICK_ALL.test(rest)) return true;
  const want = rest.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !PICK_STOP.has(w));
  if (!want.length || want.length > 4) return false;
  const have = names.flatMap((n) => n.toLowerCase().split(/[^a-z0-9]+/)).filter((w) => w.length >= 3);
  const stem = (w: string) => w.replace(/(?:es|s)$/, "");
  return want.every((w) => have.some((h) => stem(h) === stem(w) || (stem(w).length >= 4 && h.includes(stem(w)))));
}

/** "nah not the salad", "no dont log the pasta", "skip the fries": a no, with whatever follows it (the thing it is about). Null when it is not a no. */
const NO_LEAD = /^(?:(?:n|no|nah|nope|naw)\b[, ]*)?(?:(?:not|dont|don'?t|do not)(?: (?:log|add|save|track))?\b|skip\b|forget\b|never ?mind\b|cancel\b|drop\b|ignore\b|scrap\b)?[, ]*(.*)$/;
const NO_START = /^(?:n|no|nah|nope|naw|not|dont|don'?t|do not|skip|forget|never ?mind|cancel|drop|ignore|scrap)\b/;
const NO_FILLER = new Set(["the", "a", "an", "one", "ones", "that", "this", "it", "log", "add", "save", "track", "please", "pls", "thanks", "thank", "you", "thx", "ty", "lol", "for", "now", "of", "bother", "with", "just", "meal", "food"]);
const stemOf = (w: string) => w.replace(/(?:es|s)$/, "");
/** Whether any of what he said names one of the waiting offers (by a word of its name). */
function mentions(said: string, names: readonly string[]): boolean {
  const want = said.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !PICK_STOP.has(w) && !NO_FILLER.has(w));
  const have = names.flatMap((n) => n.toLowerCase().split(/[^a-z0-9]+/)).filter((w) => w.length >= 3);
  return want.some((w) => have.some((h) => stemOf(h) === stemOf(w) || (stemOf(w).length >= 4 && h.includes(stemOf(w)))));
}
/** A no that names one offer, or a bare no with several waiting; null when the words are something else (a correction, a pick). */
function readNo(said: string, m: string, names: readonly string[], count: number): FoodTurn | null {
  if (!NO_START.test(said) || CORRECTION.test(said)) return null;
  const rest = (NO_LEAD.exec(said)?.[1] ?? "").split(/[^a-z0-9]+/).filter((w) => w && !NO_FILLER.has(w));
  if (!rest.length) return count >= 2 || NO.test(said) ? { kind: "no" } : null;
  return mentions(rest.join(" "), names) ? { kind: "no", ...(count >= 2 ? { which: m } : {}) } : null;
}

const tidy = (s: string) => s.trim().replace(/\s+/g, " ").replace(/^[,.:;\-–—\s]+|[?.!,\s]+$/g, "");
const flat = (s: string) => s.toLowerCase().replace(/[’]/g, "'").replace(/[.!?…,]+$/g, "").replace(/\s+/g, " ").trim();

/** The food in a calorie question: what follows the ask, else what came before it ("i had X, how many calories is that"). "" when neither. */
function askedFood(message: string): string {
  const m = ASK.exec(message)!;
  const after = tidy(message.slice(m.index + m[0].length));
  const food = !after || /^(?:that|it|this|those|there)$/i.test(after) ? tidy(message.slice(0, m.index)) : after;
  return food.replace(/^(?:a|an|the) (?=\S)/i, "");
}

/** The food turn in his message, or null. */
export function readFoodTurn(message: string, c: FoodContext): FoodTurn | null {
  const m = message.trim().replace(/\s+/g, " ");
  const said = flat(m);
  if (c.attachments?.some((a) => a.kind === "image") && PHOTO_WORDS.test(said)) return { kind: "photo" };
  if (m.length > 200) return null;
  if (c.pending?.loggedId && c.bound) { const t = readLogged(said, m, c.pending.loggedId); if (t) return t; }
  if (c.pending && c.bound) {
    const count = c.pending.count ?? 1, names = c.pending.names ?? [];
    const no = readNo(said, m, names, count);
    if (no) return no;
    if (count >= 2 && !NO_START.test(said) && picked(said, names)) return { kind: "pick", which: m };
    if (YES.test(said)) return { kind: "yes" };
    if (THAT.test(said)) return { kind: "that" };
    if (CORRECTION.test(said) && !NOT_A_CORRECTION.test(said) && said.length <= 140) return { kind: "revise", correction: m, ...(count >= 2 && mentions(said, names) ? { which: m } : {}) };
    if (NO.test(said)) return { kind: "no" };
  }
  if (c.lastLogged && c.now.getTime() - c.lastLogged.at <= UNDO_MS && UNDO.test(said)) return { kind: "undo", id: c.lastLogged.id, ...((c.lastLogged.ids?.length ?? 0) > 1 ? { ids: [...c.lastLogged.ids!] } : {}) };
  if (THAT.test(said)) return { kind: "that" };
  if (ASK.test(m) && !DAY_TOTAL.test(m)) {
    const food = askedFood(m);
    return food.length >= 2 ? { kind: "ask", text: food } : { kind: "that" };
  }
  const log = LOG.exec(m);
  if (log && !NOT_FOOD.test(m)) return { kind: "log", text: tidy(log[1]!) };
  if (c.mealsOn) {
    const meal = readMeal(m, c.now);
    if (meal && meal.title.toLowerCase() !== meal.meal.toLowerCase() && !NOT_FOOD.test(meal.title)) return { kind: "meal", read: meal };
  }
  return null;
}
