/*
 Reading "undo" and "remove the X" against the ledger of things ORION made (w20 round 3). Pure text: no state, no tools.

 Two sorts of ask. A STRONG one can only mean something ORION made ("undo", "undo that last move", "delete that note i just made",
 "scrap the gym block i just added", "put the learning plan back where it was", "take the big mac back off, i didnt have it", anything
 that says reminder / note / water): the turn is the ledger's, whether or not it finds the thing. A WEAK one ("cancel the stretch one and
 the careers one", "take the call with mum off my day") is only the ledger's when it finds exactly what he named; otherwise the turn goes
 on to the ordinary flows ("drop gym tomorrow" is the scheduler's).
*/
import { contentWords, type MadeKind } from "./made-ledger.js";

export type LedgerAsk = {
  verb: "undo" | "remove";
  strong: boolean;
  /** Kinds he named outright (note, reminder, water, food, block); empty means any. */
  kinds: MadeKind[];
  /** One group of naming words per thing: "the stretch one and the careers one" is two. Empty for "that" / "undo". */
  targets: string[][];
  /** He pointed rather than named: "that", "the last one", "i just made". */
  pointing: boolean;
  /** "undo" and nothing else (or "undo that last move"): the newest change in this chat, whatever it was. */
  bare: boolean;
  /** His "yes" to a candidate ORION asked about: carry it out. */
  confirmed?: boolean;
  /** "i dont need the stretch reminder": a remark, not an order, so a reminder found only in the store is asked about first. */
  soft?: boolean;
  /** "revert that and the one before it": how many changes to take back (default 1). */
  count?: number;
  /** "get rid of every call with dad": every matching block ORION made, never his own. */
  all?: boolean;
};

const FILLER = String.raw`(?:(?:actually|ok|okay|hey|orion|pls|please|wait|no|nah|yeah|yep|sorry|oh|and|then|just|can you|could you|can u)[,\s]+)*`;
const UNDO_WORD = String.raw`(?:undo|revert|reverse|roll\s?back|take back)`;
const REMOVE = String.raw`(?:cancel|scrap|delete|remove|drop|ditch|nuke|forget|erase|bin|scratch|zap|kill|get rid of|take off|clear)`;
const UNDO_BARE = new RegExp(String.raw`^${FILLER}${UNDO_WORD}(?:\s+(?:that|it|this|all of that|the last (?:one|change|thing|move|edit)|my last (?:change|move)|that last (?:one|change|thing|move|edit)))?(?:\s+(?:please|pls|thanks))?$`);
const PUT_BACK = new RegExp(String.raw`^${FILLER}(?:put|set|move|change)\s+(.+?)\s+back\s+(?:to\s+|in\s+|at\s+)?(?:where it was|where they were|where it (?:normally |usually )?(?:goes|is|belongs|lives)|how it was|how they were|as it was|like it was|to normal|normal|to how it (?:was|is supposed to be)|(?:to |in |at )?its (?:old|original|normal|usual|regular|proper|default|right|own|previous|earlier) (?:time|spot|place|slot|position))(?:\s+(?:before|please|pls))?$`);
// "stop the pasta timer", "turn off the stretch alarm": only with a timer / alarm / reminder noun (a bare "stop" is the music's).
const STOP_TIMER = new RegExp(String.raw`^${FILLER}(?:stop|turn off|switch off|end)\s+((?:(?:the|my|that|this)\s+)?(?:[a-z0-9']+\s+){0,2}(?:timers?|alarms?|reminders?))$`);
const REMOVE_AT_START = new RegExp(String.raw`^${FILLER}${REMOVE}\s+(.+)$`);
const UNDO_OBJECT = new RegExp(String.raw`^${FILLER}${UNDO_WORD}\s+(?:the\s+)?(.+)$`);
const TAKE_OFF = new RegExp(String.raw`^${FILLER}take\s+(.+?)\s+(?:back\s+)?off(?:\s+(?:my|the)\s+(?:day|list|plan|calendar|log|schedule|today|food log))?$`);
const NO_NEED = new RegExp(String.raw`^${FILLER}(?:i\s+)?(?:don'?t|do not|dont|no longer)\s+need\s+(.+?)(?:\s+(?:any\s?more|anymore|now))?$`);
const DIDNT_HAVE = /(?:,|\.|\s)\s*(?:i\s+)?(?:didn'?t|did not|never|haven'?t|havent)\s+(?:actually\s+|even\s+)?(?:have|had|eat|ate|drink|drank)\b.*$/;
const POINTING = /^(?:that|it|this|those|them|the last (?:one|thing)|that last \w+|the one i (?:just )?\w+)(?:\s|$)|\b(?:i|you) (?:just\s+)?(?:added|made|saved|logged|set|booked|created|put in)\b|\bjust (?:added|made|saved|logged|set|booked|created)\b/;
// "undo that move", "undo what you just did", "undo the last thing you did": the newest change, whatever it was (never a thing called "move").
const GENERIC_OBJECT = /^(?:(?:that|the|my|this|your)\s+)?(?:(?:last|latest|previous)\s+)?(?:one|change|changes|thing|move|moves|edit|edits)(?:\s+(?:you|i)\s+(?:just\s+)?(?:did|made|changed))?$|^(?:what|whatever|everything|anything)\s+(?:you|i)\s+(?:just\s+)?(?:did|made|changed)$/;
// "revert that and the one before it as well", "undo the last two changes": two steps back.
const TWO_BACK = /^(?:(?:that|it|this)\s+)?(?:and|&|plus)\s+(?:the\s+)?(?:one|thing|change|move)\s+(?:before|previous|prior)(?:\s+(?:it|that|this))?(?:\s+(?:as well|too|also))?$|^(?:the\s+)?(?:last|latest|previous)\s+(?:two|2|both)(?:\s+(?:changes|things|moves|edits|ones))?$|^(?:both|both of them)$/;
const EVERY = /^(?:every|each|all(?:\s+of)?(?:\s+(?:the|my))?)\s+/;
const NAMED_CHANGE = /^(.+?)\s+(?:move|change|edit)$/;
const NOUN: Array<[RegExp, MadeKind]> = [
  [/\b(?:notes?)\b/, "note"], [/\b(?:reminders?|alarms?|timers?)\b/, "reminder"],
  [/\b(?:water|bottles?)\b/, "water"], [/\b(?:calories|food|meal)\b/, "food"],
  [/\b(?:blocks?|sessions?|slots?|events?)\b/, "block"],
];

const clean = (message: string): string => message.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim().replace(/[.!?…]+$/, "");

/** The groups of naming words in "the stretch one and the careers one": split on "and" and commas, drop groups with no name. */
function groupsOf(object: string): string[][] {
  return object.split(/\s*(?:,|\band\b|&)\s*/).map((part) => contentWords(part.replace(/\b(?:i|you)\s+(?:just\s+)?\w+$/, ""))).filter((g) => g.length);
}

function kindsOf(object: string): MadeKind[] {
  return NOUN.filter(([re]) => re.test(object)).map(([, kind]) => kind);
}

/** The ledger's reading of his message, or null when it is not about undoing or removing something. */
export function readLedgerAsk(message: string): LedgerAsk | null {
  const text = clean(message);
  if (!text || text.length > 160) return null;
  if (UNDO_BARE.test(text)) {
    const blockish = /\b(?:move|change|edit)\b/.test(text);
    return { verb: "undo", strong: true, kinds: blockish ? ["block"] : [], targets: [], pointing: true, bare: true };
  }
  const undoObject = UNDO_OBJECT.exec(text)?.[1]?.trim();
  if (undoObject && TWO_BACK.test(undoObject)) return { verb: "undo", strong: true, kinds: ["block"], targets: [], pointing: true, bare: true, count: 2 };
  if (undoObject && GENERIC_OBJECT.test(undoObject)) return { verb: "undo", strong: true, kinds: ["block"], targets: [], pointing: true, bare: true };
  const named = undoObject ? NAMED_CHANGE.exec(undoObject.replace(/^(?:the|my|that)\s+/, ""))?.[1] : undefined;
  if (named && contentWords(named).length) return { verb: "undo", strong: true, kinds: ["block"], targets: [contentWords(named)], pointing: false, bare: false };
  const back = PUT_BACK.exec(text);
  if (back) {
    const object = back[1]!;
    const pointing = /^(?:it|that|this|them)$/.test(object);
    return { verb: "undo", strong: true, kinds: ["block"], targets: pointing ? [] : groupsOf(object), pointing, bare: false };
  }
  const tail = DIDNT_HAVE.test(text);
  const stripped = text.replace(DIDNT_HAVE, "").trim();
  const noNeed = NO_NEED.exec(stripped);
  // "nah i didnt eat that, take it off": the removal is the clause after the aside.
  const afterAside = tail ? text.split(/\s*(?:,|;|\bso\b|\band\b)\s*/).reverse().map((c) => TAKE_OFF.exec(c) ?? REMOVE_AT_START.exec(c)).find((m) => m) ?? null : null;
  const match = noNeed ?? TAKE_OFF.exec(stripped) ?? REMOVE_AT_START.exec(stripped) ?? STOP_TIMER.exec(stripped) ?? UNDO_OBJECT.exec(stripped) ?? afterAside;
  if (!match) return null;
  const object = match[match.length - 1]!.replace(/\s+(?:as well|aswell|too|also|either|as well pls|please|pls)$/, "").replace(/\s+(?:off|from)\s+(?:my|the)\s+(?:day|list|plan|calendar|log|schedule|today)$/, "").trim();
  const verb = UNDO_OBJECT.test(stripped) && !REMOVE_AT_START.test(stripped) ? "undo" : "remove";
  const everyOne = EVERY.test(object);
  const pointing = POINTING.test(object);
  const kinds = kindsOf(object);
  if (tail && !kinds.includes("food")) kinds.push("food");
  const targets = groupsOf(object).filter((g) => !(pointing && g.length === 0));
  // "delete that" / "cancel it" with nothing to say what: pointing only.
  if (!targets.length && !pointing && !kinds.length) return null;
  const strong = pointing || kinds.some((k) => k !== "block") || (verb === "undo" && !noNeed);
  return { verb, strong: strong || everyOne, kinds, targets: everyOne ? groupsOf(object.replace(EVERY, "")) : targets, pointing, bare: false, ...(noNeed ? { soft: true } : {}), ...(everyOne ? { all: true } : {}) };
}

/** "and the dentist one too": a new target for the removal he just made. Null when it is not that shape. */
export function readFollowUp(message: string): string[][] | null {
  const text = clean(message);
  const m = /^(?:oh\s+)?(?:and|also)\s+(?:also\s+)?(?:the\s+|my\s+)?(.+?)(?:\s+one)?(?:\s+(?:too|as well|also|aswell))?$/.exec(text);
  if (!m || !/\b(?:one|too|as well|also|aswell)\b/.test(text.replace(/^(?:oh\s+)?(?:and|also)\s+/, ""))) return null;
  const groups = groupsOf(m[1]!);
  return groups.length && groups.length <= 3 ? groups : null;
}
