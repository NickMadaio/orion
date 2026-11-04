import { readMeal } from "./health-log.js";
const UNDO_MS = 10 * 60_000;
const NUTRIENT = String.raw `(?:cal(?:or|ar)\w*|cals?|kcals?|prot\w*|carbs?|carbohydrates?|fats?|macros?)`;
/** "how much", with the typos he makes. */
const HOWM = String.raw `h(?:ow|wo|w) (?:many|much|mch|muh|mny)`;
/** "is a chipotle bowl high protein", "is this high in protein": a question about a food's nutrient, answered like a how-much. */
const HIGH = new RegExp(String.raw `^(?:is|are|does|do) (.{1,80}?) (?:high|low|good|a lot)(?: in)? ${NUTRIENT}\??$`, "i");
/** His day totals, budget or goals are another question (code-answers / the worker), not a meal to estimate. */
const DAY_TOTAL = /\b(?:today|so far|this week|yesterday|left|remaining|goal|target|budget|should i|do i need|my calorie|my protein|my macros)\b/i;
const THAT = new RegExp(String.raw `^(?:and |so |ok |okay )?(?:${HOWM} ${NUTRIENT}(?: (?:was|is|are|were|in))?(?: in)? (?:that|it|this|those)|(?:what(?:'s|s| is| are|re)? )?(?:the )?${NUTRIENT} (?:on|in|for|of) (?:that|it|this|those)|(?:the )?${NUTRIENT})\??[.!]*$`, "i");
const ASK = new RegExp(String.raw `\b(?:${HOWM} ${NUTRIENT}(?: (?:is|are|was|were|does|do|would))?(?: (?:there|it|that|this))?(?: (?:in|for|of|on|have|be))?|${NUTRIENT} (?:in|for|of|on)|estimate (?:the |my )?${NUTRIENT}(?: (?:in|for|of|on))?(?: my [a-z]+)?|macro (?:check|estimate)(?: (?:on|for))?)\b`, "i");
const LOG = /^(?:please |pls |can you |could you )?(?:log|track)\s+(?:(?:this|that|these)\s*(?:meal|food)?\s*:\s*|(?:food|meal)\s*:\s*|(?=(?:a|an|some|two|three|four|half|\d+)\s))(.+)$/i;
const NOT_FOOD = /\b(?:workout|gym|lift(?:s|ed|ing)?|run|ran|water|bottles?|sleep|slept|weight|mood|hours?|minutes?|mins?|steps|study|period|expense|spent|[£$€]|meds?|medication|supplements?)\b/i;
const YES = /^(?:y|ya|yah|yes|yeah|yea|yep|yup|sure|ok|okay|k|please|please do|pls|do it|go ahead|go for it|sounds good|perfect|correct|right|that's right|thats right|log it|log that|add it|add that|save it|yes please|yeah please|yes log it|yeah log it|yep log it|sure log it|ok log it|yes add it)(?:\s+(?:please|pls|thanks|thank you|thx|ty))?$/i;
const NO = /^(?:n|no|nah|nope|no thanks|no thank you|nah thanks|don'?t|dont|don'?t log it|dont log it|don'?t bother|skip it|skip|never ?mind|forget it|leave it|not now|no need)$/i;
const CORRECTION = /\b(?:it was|was (?:a|an|just|only|more|less|about|like)|actually|only|just|half|small(?:er)?|large|big(?:ger)?|tiny|huge|didn'?t (?:have|eat|finish)|without|no (?:cheese|sauce|oil|mayo|dressing|rice|fries|chips|sugar|milk|bread|bun)|there was no|plus|also had|and (?:a|an|some)|with (?:a|an|some|extra)|extra|diet|zero|grams?|\d+\s?(?:g|ml|oz)\b|two|three|double|single)\b/i;
const NOT_A_CORRECTION = /\b(?:remind|move|schedule|book|cancel|calendar|gym|class|alarm|timer|lights?|text|call|email|weather|focus|session|tomorrow|tonight|at \d)\b|\?$/i;
const UNDO = /^(?:undo|undo (?:that|it)|remove (?:it|that)|delete (?:it|that)|take (?:it|that) (?:off|out)|scratch that|un-?log (?:it|that))$/i;
const PHOTO_WORDS = /^(?:|log (?:this|that|it)|(?:i )?(?:just )?(?:had|ate) this(?: for (?:breakfast|lunch|dinner|a snack|snack))?(?: lol)?|track (?:this|that)|this|that|food|meal|breakfast|lunch|dinner|snack|how many (?:calories|cals) (?:is|in|was) (?:this|that)|macros\??|calories\??|estimate (?:this|that|it)|what about this)$/i;
/** Replies to "Logged … Fix anything?" (a photo already in his log): the entry is edited in place, so almost any short food-ish reply is a fix. */
const LOGGED_OK = /^(?:(?:ya|yeah|yep|yes|ok|okay|nah|nope|no)[, ]+)?(?:that'?s |thats |it'?s |its )?(?:fine|good|right|correct|perfect|all good|looks good|about right|close enough)$/;
const LOGGED_UNDO = /^(?:(?:nvm|nevermind|never mind|ok|okay|actually|pls|please)[, ]+)*(?:undo|remove|delete|take|scratch|un-?log|get rid of)(?: (?:it|that|this|that one|that entry|the entry))?(?: (?:off|out))?(?: (?:pls|please))?$/;
/** A correction to the item that was logged: a count or amount, a removal, "more like 800", "that was X instead", a missing item. Not a new food, not chatter. */
const FIX_ONLY = new RegExp([
    String.raw `\b\d+(?:\.\d+)?\s*(?:slices?|pieces?|bites?|cups?|bowls?|plates?|servings?|portions?|g|grams?|ml|oz|cal|cals|kcal|calories)\b`,
    String.raw `\b(?:more|less|closer|around|about|like)\s+(?:like\s+)?\d+`,
    String.raw `^(?:(?:nah|nope|no)[, ]+)?(?:no|without|minus|hold the|skip the) [a-z]+`,
    String.raw `\b(?:instead|(?:it|that) was (?:a|an|\d|only|just|more|less|about|like|half|small|large|big|veggie|vegan|diet|the|actually)|was (?:a|an|only|just|more|less|about|like|half|small|large|big)|only (?:ate|had)|just (?:the|a|an|half|one|two)|half|double|small(?:er)?|bigger|large|tiny|huge|extra|veggie|vegan|diet|zero|forgot|missing|wrong|make it \d+)\b`,
].join("|"), "i");
/** "also had a coffee", "then i had a bagel": more food, so a new log (never an overwrite of the logged photo). */
const MORE_FOOD = /^(?:i )?(?:also|then|and)(?: i)? (?:had|ate|drank|got) (.{2,80})$/;
/** Replies to "Logged … Fix anything?" (a photo already in his log). `open`: older offers still wait on a yes (they own yes, no and the picks). */
function readLogged(said, m, id, open) {
    if (LOGGED_UNDO.test(said))
        return { kind: "undo", id };
    if (!open) {
        if (LOGGED_OK.test(said))
            return /^(?:nah|nope|no)\b/.test(said) ? { kind: "no" } : { kind: "yes" };
        if (YES.test(said))
            return { kind: "yes" };
        if (NO.test(said))
            return { kind: "no" };
    }
    const more = MORE_FOOD.exec(said);
    if (more)
        return { kind: "log", text: tidy(more[1]) };
    if (said.length <= 140 && !NOT_A_CORRECTION.test(said) && FIX_ONLY.test(said) && !(open && NO.test(said)))
        return { kind: "revise", correction: m };
    return null;
}
const PICK_ALL = /^(?:both|all(?: of (?:them|em|those))?|all (?:three|3|two|2)|every one|everything|(?:the )?(?:first|second|third|last|1st|2nd|3rd)(?: one)?)$/;
const PICK_STOP = new Set(["the", "one", "ones", "log", "add", "just", "only", "please", "pls", "that", "this"]);
/** Which of several waiting offers he named, or null. Names come from food-pending.json ("cheeseburger and fries"). */
function picked(said, names) {
    const rest = said.replace(/^(?:(?:yes|yeah|yea|yep|ok|okay|sure)[, ]+)/, "").replace(/^(?:(?:log|add|just|only)\s+)+/, "").replace(/\s+(?:please|pls)$/, "").trim();
    if (rest.length > 40)
        return false;
    if (PICK_ALL.test(rest))
        return true;
    const want = rest.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !PICK_STOP.has(w));
    if (!want.length || want.length > 4)
        return false;
    const have = names.flatMap((n) => n.toLowerCase().split(/[^a-z0-9]+/)).filter((w) => w.length >= 3);
    const stem = (w) => w.replace(/(?:es|s)$/, "");
    return want.every((w) => have.some((h) => stem(h) === stem(w) || (stem(w).length >= 4 && h.includes(stem(w)))));
}
/** "nah not the salad", "no dont log the pasta", "skip the fries": a no, with whatever follows it (the thing it is about). Null when it is not a no. */
const NO_LEAD = /^(?:(?:n|no|nah|nope|naw)\b[, ]*)?(?:(?:not|dont|don'?t|do not)(?: (?:log|add|save|track))?\b|skip\b|forget\b|never ?mind\b|cancel\b|drop\b|ignore\b|scrap\b)?[, ]*(.*)$/;
const NO_START = /^(?:n|no|nah|nope|naw|not|dont|don'?t|do not|skip|forget|never ?mind|cancel|drop|ignore|scrap)\b/;
const NO_FILLER = new Set(["the", "a", "an", "one", "ones", "that", "this", "it", "log", "add", "save", "track", "please", "pls", "thanks", "thank", "you", "thx", "ty", "lol", "for", "now", "of", "bother", "with", "just", "meal", "food"]);
const stemOf = (w) => w.replace(/(?:es|s)$/, "");
/** Whether any of what he said names one of the waiting offers (by a word of its name). */
function mentions(said, names) {
    const want = said.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !PICK_STOP.has(w) && !NO_FILLER.has(w));
    const have = names.flatMap((n) => n.toLowerCase().split(/[^a-z0-9]+/)).filter((w) => w.length >= 3);
    return want.some((w) => have.some((h) => stemOf(h) === stemOf(w) || (stemOf(w).length >= 4 && h.includes(stemOf(w)))));
}
/** A no that names one offer, or a bare no with several waiting; null when the words are something else (a correction, a pick). */
function readNo(said, m, names, count) {
    if (!NO_START.test(said) || CORRECTION.test(said))
        return null;
    const rest = (NO_LEAD.exec(said)?.[1] ?? "").split(/[^a-z0-9]+/).filter((w) => w && !NO_FILLER.has(w));
    if (!rest.length)
        return count >= 2 || NO.test(said) ? { kind: "no" } : null;
    return mentions(rest.join(" "), names) ? { kind: "no", ...(count >= 2 ? { which: m } : {}) } : null;
}
const tidy = (s) => s.trim().replace(/\s+/g, " ").replace(/^[,.:;\-–—\s]+|[?.!,\s]+$/g, "");
const flat = (s) => s.toLowerCase().replace(/[’]/g, "'").replace(/[.!?…,]+$/g, "").replace(/\s+/g, " ").trim();
/** The food in a calorie question: what follows the ask, else what came before it ("i had X, how many calories is that"). "" when neither. */
function askedFood(message) {
    const m = ASK.exec(message);
    const after = tidy(message.slice(m.index + m[0].length));
    const food = !after || /^(?:that|it|this|those|there)$/i.test(after) ? tidy(message.slice(0, m.index)) : after;
    return food.replace(/^(?:a|an|the) (?=\S)/i, "").replace(/\s+(?:lol|lmao|pls|please|thanks)$/i, "");
}
/** A nutrition question about a food ("how much protein is in this", "is a bowl high protein"), not his day's totals. The food named, "" when it is this/that. */
function nutritionQuestion(message) {
    if (DAY_TOTAL.test(message))
        return null;
    const high = HIGH.exec(flat(message));
    if (high) {
        const f = tidy(high[1]).replace(/^(?:a|an|the) (?=\S)/i, "");
        return { food: /^(?:that|it|this|those)$/i.test(f) ? "" : f };
    }
    return ASK.test(message) ? { food: askedFood(message) } : null;
}
/** The food turn in his message, or null. */
export function readFoodTurn(message, c) {
    const m = message.trim().replace(/\s+/g, " ");
    const said = flat(m);
    const hasImage = !!c.attachments?.some((a) => a.kind === "image");
    // A photo that comes with a question is the question flow (answer, then offer to log); alone or with "log this" / "had this" it is logged at once.
    if (hasImage && nutritionQuestion(m))
        return { kind: "photo", question: m };
    if (hasImage && PHOTO_WORDS.test(said))
        return { kind: "photo" };
    if (m.length > 200)
        return null;
    const open = c.pending ? (c.pending.loggedId ? (c.pending.count ?? 0) : (c.pending.count ?? 1)) : 0;
    if (c.pending?.loggedId && c.bound) {
        const t = readLogged(said, m, c.pending.loggedId, open > 0);
        if (t)
            return t;
    }
    if (c.pending && c.bound && open > 0) {
        const count = open, names = c.pending.names ?? [];
        const no = readNo(said, m, names, count);
        if (no)
            return no;
        if (count >= 2 && !NO_START.test(said) && picked(said, names))
            return { kind: "pick", which: m };
        if (YES.test(said))
            return { kind: "yes" };
        if (THAT.test(said))
            return { kind: "that" };
        if (CORRECTION.test(said) && !NOT_A_CORRECTION.test(said) && said.length <= 140 && !c.pending.loggedId)
            return { kind: "revise", correction: m, ...(count >= 2 && mentions(said, names) ? { which: m } : {}) };
        if (NO.test(said))
            return { kind: "no" };
    }
    if (c.lastLogged && c.now.getTime() - c.lastLogged.at <= UNDO_MS && UNDO.test(said))
        return { kind: "undo", id: c.lastLogged.id, ...((c.lastLogged.ids?.length ?? 0) > 1 ? { ids: [...c.lastLogged.ids] } : {}) };
    if (THAT.test(said))
        return { kind: "that" };
    const asked = nutritionQuestion(m);
    if (asked)
        return asked.food.length >= 2 ? { kind: "ask", text: asked.food, question: m } : { kind: "that" };
    const log = LOG.exec(m);
    if (log && !NOT_FOOD.test(m))
        return { kind: "log", text: tidy(log[1]) };
    if (c.mealsOn) {
        const meal = readMeal(m, c.now);
        if (meal && meal.title.toLowerCase() !== meal.meal.toLowerCase() && !NOT_FOOD.test(meal.title))
            return { kind: "meal", read: meal };
    }
    return null;
}
