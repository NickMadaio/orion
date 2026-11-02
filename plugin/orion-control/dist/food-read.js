import { readMeal } from "./health-log.js";
const UNDO_MS = 10 * 60_000;
const NUTRIENT = String.raw `(?:calories|calorie|cals|kcal|protein|carbs|carbohydrates|fat|macros)`;
/** His day totals, budget or goals are another question (code-answers / the worker), not a meal to estimate. */
const DAY_TOTAL = /\b(?:today|so far|this week|yesterday|left|remaining|goal|target|budget|should i|do i need|my calorie|my protein|my macros)\b/i;
const THAT = new RegExp(String.raw `^(?:and |so |ok |okay )?(?:how (?:many|much) ${NUTRIENT}(?: (?:was|is|are|were|in))? (?:that|it|this|those)|(?:what(?:'s|s| is| are|re)? )?(?:the )?${NUTRIENT} (?:on|in|for|of) (?:that|it|this|those)|(?:the )?${NUTRIENT})\??[.!]*$`, "i");
const ASK = new RegExp(String.raw `\b(?:how (?:many|much) ${NUTRIENT}(?: (?:is|are|was|were|does|do|would))?(?: (?:there|it|that|this))?(?: (?:in|for|of|on|have|be))?|${NUTRIENT} (?:in|for|of|on)|estimate (?:the |my )?${NUTRIENT}(?: (?:in|for|of|on))?(?: my [a-z]+)?|macro (?:check|estimate)(?: (?:on|for))?)\b`, "i");
const LOG = /^(?:please |pls |can you |could you )?(?:log|track)\s+(?:(?:this|that|these)\s*(?:meal|food)?\s*:\s*|(?:food|meal)\s*:\s*|(?=(?:a|an|some|two|three|four|half|\d+)\s))(.+)$/i;
const NOT_FOOD = /\b(?:workout|gym|lift(?:s|ed|ing)?|run|ran|water|bottles?|sleep|slept|weight|mood|hours?|minutes?|mins?|steps|study|period|expense|spent|[£$€]|meds?|medication|supplements?)\b/i;
const YES = /^(?:y|ya|yah|yes|yeah|yea|yep|yup|sure|ok|okay|k|please|please do|pls|do it|go ahead|go for it|sounds good|perfect|correct|right|that's right|thats right|log it|log that|add it|add that|save it|yes please|yeah please|yes log it|yeah log it|yep log it|sure log it|ok log it|yes add it)(?:\s+(?:please|pls|thanks|thank you|thx|ty))?$/i;
const NO = /^(?:n|no|nah|nope|no thanks|no thank you|nah thanks|don'?t|dont|don'?t log it|dont log it|don'?t bother|skip it|skip|never ?mind|forget it|leave it|not now|no need)$/i;
const CORRECTION = /\b(?:it was|was (?:a|an|just|only|more|less|about|like)|actually|only|just|half|small(?:er)?|large|big(?:ger)?|tiny|huge|didn'?t (?:have|eat|finish)|without|no (?:cheese|sauce|oil|mayo|dressing|rice|fries|chips|sugar|milk|bread|bun)|there was no|plus|also had|and (?:a|an|some)|with (?:a|an|some|extra)|extra|diet|zero|grams?|\d+\s?(?:g|ml|oz)\b|two|three|double|single)\b/i;
const NOT_A_CORRECTION = /\b(?:remind|move|schedule|book|cancel|calendar|gym|class|alarm|timer|lights?|text|call|email|weather|focus|session|tomorrow|tonight|at \d)\b|\?$/i;
const UNDO = /^(?:undo|undo (?:that|it)|remove (?:it|that)|delete (?:it|that)|take (?:it|that) (?:off|out)|scratch that|un-?log (?:it|that))$/i;
const PHOTO_WORDS = /^(?:|log (?:this|that|it)|track (?:this|that)|this|that|food|meal|breakfast|lunch|dinner|snack|how many (?:calories|cals) (?:is|in|was) (?:this|that)|macros\??|calories\??|estimate (?:this|that|it)|what about this)$/i;
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
const tidy = (s) => s.trim().replace(/\s+/g, " ").replace(/^[,.:;\-–—\s]+|[?.!,\s]+$/g, "");
const flat = (s) => s.toLowerCase().replace(/[’]/g, "'").replace(/[.!?…,]+$/g, "").replace(/\s+/g, " ").trim();
/** The food in a calorie question: what follows the ask, else what came before it ("i had X, how many calories is that"). "" when neither. */
function askedFood(message) {
    const m = ASK.exec(message);
    const after = tidy(message.slice(m.index + m[0].length));
    const food = !after || /^(?:that|it|this|those|there)$/i.test(after) ? tidy(message.slice(0, m.index)) : after;
    return food.replace(/^(?:a|an|the) (?=\S)/i, "");
}
/** The food turn in his message, or null. */
export function readFoodTurn(message, c) {
    const m = message.trim().replace(/\s+/g, " ");
    const said = flat(m);
    if (c.attachments?.some((a) => a.kind === "image") && PHOTO_WORDS.test(said))
        return { kind: "photo" };
    if (m.length > 200)
        return null;
    if (c.pending && c.bound) {
        if ((c.pending.count ?? 1) >= 2 && picked(said, c.pending.names ?? []))
            return { kind: "pick", which: m };
        if (YES.test(said))
            return { kind: "yes" };
        if (THAT.test(said))
            return { kind: "that" };
        if (CORRECTION.test(said) && !NOT_A_CORRECTION.test(said) && said.length <= 140)
            return { kind: "revise", correction: m };
        if (NO.test(said))
            return { kind: "no" };
    }
    if (c.lastLogged && c.now.getTime() - c.lastLogged.at <= UNDO_MS && UNDO.test(said))
        return { kind: "undo", id: c.lastLogged.id };
    if (THAT.test(said))
        return { kind: "that" };
    if (ASK.test(m) && !DAY_TOTAL.test(m)) {
        const food = askedFood(m);
        return food.length >= 2 ? { kind: "ask", text: food } : { kind: "that" };
    }
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
