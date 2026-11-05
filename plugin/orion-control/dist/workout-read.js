/*
 Which chat turns are about a workout he did (w17 g-workout, 2026-11-03). Pure: workout-chat.ts carries them out through orion-workout-log.

 Nick: "make it so that I can just explain or tell orion about my workout and then he can log it for me. if I forget a part he can
 ask me about it."

   describe  "just did legs, squats 4x6 at 185…", "log my workout: …", "went for a 3 mile run", "worked out today": parse, then log or ask ONE question
   answer    his reply to that question ("55 min and 185 on squats"), only while the question is still the last thing in this chat
   skip      "skip" / "idk" / "no": log what is known and say what was skipped
   cancel    "never mind" / "dont log it": drop the waiting workout
   undo      "undo" within half an hour of a workout log in this chat

 A question, a plan ("gonna do legs later"), a miss ("skipped the gym"), a schedule edit and anything else is not a workout statement, and
 a reply about something else never binds to the follow-up (the precedence food-read.ts and plan-check-story.ts keep for their own replies).
*/
import { PAST_TENSE, schedulingAsk } from "./route-gate.js";
import { normalizeSpoken } from "./spoken-numbers.js";
const UNDO_MS = 30 * 60_000;
const flat = (s) => s.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
const LOG = /^(?:please |pls |can you |could you )?(?:log|track|record|add)\s+(?:my |a |the |today'?s |this |that )?(?:workout|work ?out|session|gym session|gym|training|lift(?:ing)?(?: session)?|run|cardio|swim|ride)\b[\s:,-]*(.*)$/i;
// "add" is a logging verb only when he says where it goes ("add it to my workout log") or that it happened; "add gym" alone is the calendar's.
const ADD_TO_LOG = /\bto (?:my |the )?(?:workout|gym|training|exercise|fitness)(?: log| journal| history)\b|\bto (?:my )?log\b/;
const LIFT_PARTS = String.raw `(?:push|pull|legs?|chest|back|arms?|upper|lower|full body|shoulders?|core|abs?|cardio|hiit|biceps|triceps|glutes|quads)`;
const SPORTS = String.raw `(?:basketball|soccer|tennis|football|squash|badminton|pickleball|volleyball|padel|rugby|climbing|bouldering|boxing|bjj|yoga|pilates|swimming|hockey)`;
const DONE = new RegExp([
    String.raw `\bworked out\b`, String.raw `\bwork ?out (?:was|today)\b`, String.raw `\bgym (?:was|session|today)\b`,
    String.raw `\b(?:just |now |finally )?(?:did|finished|done with|completed|crushed|smashed|hit|trained)\s+(?:a |my |some |an |the )?(?:${LIFT_PARTS}|workout|session|lift|gym|run|swim|ride|hike|walk)\b`,
    String.raw `\bwent (?:to the gym|to gym|(?:for|on) an? (?:\w+ ){0,2}(?:run|jog|swim|walk|bike ride|ride|hike|spin)|running|swimming|lifting|climbing)\b`,
    String.raw `\b(?:hit|been to|back from|home from|got back from|just left) (?:the )?gym\b`,
    String.raw `\b(?:ran|jogged|swam|cycled|biked|rowed|hiked)\s+(?:\d|a |an |for |around |about )`,
    String.raw `\b(?:lifted|just lifted)\b`, String.raw `\bplayed (?:${SPORTS}|pickup)\b`, String.raw `\b(?:did|had) (?:${LIFT_PARTS})\s+(?:day|today|this (?:morning|afternoon|evening))\b`,
].join("|"), "i");
const NOT_STATEMENT = /^(?:how|what|when|why|where|who|which|can|could|should|would|do|does|did i|am i|is|are|have i|was)\b|\?\s*$/i;
const PLAN_OR_MISS = /\b(?:gonna|going to|will|tomorrow|tonight|later|after (?:class|work|lunch)|need to|have to|should|want to|wanna|plan(?:ning)? to|about to|supposed to|if i|when i|before i|didn'?t|did not|haven'?t|couldn'?t|skipped|missed|no gym|can'?t|won'?t|not going)\b/i;
const SCHEDULING = /\b(?:remind|move|schedule|reschedule|book|cancel|calendar|alarm|timer|reminder|block|class|lecture|meeting)\b/i;
const DETAIL = /\d|\b(?:bench|squat|deadlift|press|curl|row|pull ?-?ups?|push ?-?ups?|dips?|miles?|km|mins?|minutes?|hours?|sets?|reps?|stairmaster|treadmill)\b|\b(?:legs?|push|pull|chest|arms?|back|upper|lower)\b/i;
const UNDO = /^(?:undo|undo (?:that|it)|remove (?:it|that)|delete (?:it|that)|take (?:it|that) (?:off|out)|scratch that|un-?log (?:it|that))$/i;
const SKIP = /^(?:skip(?: it)?|idk|(?:i )?(?:dont|don'?t) (?:know|remember)|dunno|no idea|not sure|(?:i )?forgot|no|nah|nope|nothing|nothing else|that'?s all|thats all|that'?s it|thats it|just log it|log it anyway|log it|none|n\/a)(?: lol| lmao| tbh| honestly| sorry| man| haha)*[.!]*$/i;
const CANCEL = /^(?:cancel|never ?mind|nvm|forget it|forget that|scratch that|dont log it|don'?t log it|dont log|don'?t log|leave it|dont bother|don'?t bother)[.!]*$/i;
const OTHER_TOPIC = /\b(?:remind|move|schedule|book|calendar|weather|alarm|timer|lights?|text|call|email|focus|tomorrow|calories|macros|class|meeting|deadline|due)\b/i;
const NUMBER_WORD = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty|sixty|half|hour|hrs?|couple|few|same|all|bodyweight|body weight|no weight|bar|plates?)\b/i;
const ANSWER_SHAPE = /\d|\b(?:min(?:ute)?s?|lbs?|kg|pounds?|sets?|reps?|bench|squats?|deadlift|press|curl|row|run|bike|walk|stair\w*|treadmill)\b/i;
/** His reply as an answer to the follow-up: short, not a question, not another topic, and it carries a number or a workout word. */
const looksLikeAnswer = (said) => said.length <= 300 && !/\?/.test(said) && !OTHER_TOPIC.test(said) && (ANSWER_SHAPE.test(said) || NUMBER_WORD.test(said));
/** A workout statement of his own: past tense, about him, not a question, plan, miss or schedule edit. */
function isStatement(said) {
    return DONE.test(said) && !NOT_STATEMENT.test(said) && !PLAN_OR_MISS.test(said) && !SCHEDULING.test(said);
}
/** The workout turn in his message, or null. */
export function readWorkoutTurn(message, c) {
    const m = normalizeSpoken(message).trim().replace(/\s+/g, " ");
    const said = flat(m);
    if (!said || m.length > 800)
        return null;
    // w20 routegate (E4 / E10 / E17): "put gym at 10-11", "add marketing from 7-9:30pm. Then gym ..." is a calendar ask, never a workout and
    // never the answer to the follow-up question. Past tense ("i did gym from 10 to 11") is what makes a time a workout he had.
    if (schedulingAsk(said))
        return null;
    const log = LOG.exec(m);
    if (log && !NOT_STATEMENT.test(said) && !SCHEDULING.test(said) && (!/^(?:please |pls |can you |could you )?add\b/i.test(m) || ADD_TO_LOG.test(said) || PAST_TENSE.test(said)))
        return { kind: "describe", text: log[1].trim() ? log[1].trim() : "workout" };
    if (c.pending && c.bound) {
        if (CANCEL.test(said))
            return { kind: "cancel" };
        if (SKIP.test(said))
            return { kind: "skip" };
        if (!isStatement(said) && looksLikeAnswer(said))
            return { kind: "answer", text: m };
    }
    if (c.lastLogged && c.now.getTime() - c.lastLogged.at <= UNDO_MS && UNDO.test(said))
        return { kind: "undo", id: c.lastLogged.id };
    if (isStatement(said) && !(c.outreach && !DETAIL.test(said.replace(/\bgym\b/g, ""))))
        return { kind: "describe", text: m };
    return null;
}
