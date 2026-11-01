/*
 "ok lets work on econ" (gate run-1031224700, foc-start-v): no start verb and no session word, so the session flow never saw a start.
 The desk guessed app_open "Econ", the worker then called a TOOL named orion-session (a script, not a tool), and Nick read "I can't use
 the tool orion-session here because it isn't available". Saying he is about to work on something, now, is a focus start like
 "start a focus session on econ": code starts it. Pure; session-flow.ts uses it next to its own START and MODE_ON readers.
*/
import { blocksNamedBy, courseAliases, isClassBlock } from "./block-names.js";
const LEAD = String.raw `^\W*(?:(?:hey|orion|ok(?:ay)?|ok so|alright|aight|right|cool|yeah|ya|yep|k|so|and|now|anyway)\b[\s,.!]*)*`;
const WHO = String.raw `(?:let'?s|lets|lemme|let me|i'?m gonna|im gonna|i'?m going to|im going to|gonna|time to|i'?ll|ill|i'?m about to|im about to)`;
// REV5 MUST 4 (2026-10-31): "do" and "hit" made "i'll hit you up", "let's do karaoke" and "i'll do the talking" focus sessions, with
// DND and app blocking. Work verbs only; and the task must be work (WORK_NOUN) or a name on his day or in his deadlines (KnownName).
const DOING = String.raw `(?:get (?:to work on|going on|on with|on|started on)|start(?:ing)? (?:on|with)|work(?:ing)? on|crack on with|knock out|grind(?: out)?|study(?: for)?|revis(?:e|ing)(?: for)?|tackle|focus on|lock in on|smash out|bang out)`;
const START_NOW = new RegExp(String.raw `${LEAD}(?:${WHO}\s+${DOING}|(?:i'?m |im |i am )?starting(?: on| with)?)\s+(.+)$`, "i");
const WORK_NOUN = /\b(?:study(?:ing)?|homework|hw|problem sets?|psets?|essays?|labs?|lab reports?|coding|revision|projects?|assignments?|coursework|readings?|midterms?|exams?|finals?|quiz(?:zes)?|reports?|thesis|dissertation|slides|presentation|brief|notes|lecture notes)\b/i;
// Not now (the calendar's), or not something to start: when he says a time, a later part of the day, or it is a question.
const NOT_NOW = /\?|\b(?:later|tomorrow|tmrw|tonight|this (?:afternoon|evening|weekend)|after|before|at \d|in \d+|in an? (?:bit|hour|sec|min)|soon|eventually|at some point|next|someday|once|when)\b/i;
// What is not a piece of work to focus on.
const NOT_WORK = /^(?:it|this|that|something|anything|stuff|things|smth|some|nothing|lunch|dinner|breakfast|brunch|food|a snack|snack|a nap|nap|the gym|gym|a run|a walk|a workout|laundry|groceries|the dishes|dishes|a shower|chores|errands|my hair|a call|the call)\b/i;
const TAIL = /\s+(?:rn|right now|now|asap|pls|please|lol|lmao|haha|then|real quick|for a bit|for a while)\b.*$|[.,!]+.*$/i;
const LEAD_ARTICLE = /^(?:some|a bit of|a little|more)\s+/i;
/** The task his words name as started now, before asking whether it is work. Pure; undefined when the shape is not there. */
export function casualStartTask(message) {
    const m = START_NOW.exec(message.trim().replace(/[’`]/g, "'"));
    if (!m || NOT_NOW.test(message))
        return undefined;
    const task = m[1].replace(TAIL, "").replace(LEAD_ARTICLE, "").replace(/^for\s+/i, "").trim();
    if (!task || task.split(/\s+/).length > 6 || NOT_WORK.test(task))
        return undefined;
    return task;
}
const asBlock = (k) => ({ title: k.title, start: k.start ?? "00:00", end: k.end ?? "00:00", ...(k.kind ? { kind: k.kind } : {}), ...(k.fixed !== undefined ? { fixed: k.fixed } : {}) });
// Wave 4 review 5 (2026-11-01): "lets get started on sam" started a focus session named "sam" from "Dinner with Sam". A name worth a
// focus session is a class, a study or work block, or a deadline: never a plan with people, another fixed event, or the gym.
const WITH_PEOPLE = /\b(?:with|meet(?:ing|up)?|date|party|birthday|drinks)\b|\bw\//i;
const GYM = /\b(?:gym|workout|lifting|training|run|yoga|swim)\b/i;
const workable = (k) => k.kind !== "gym" && !GYM.test(k.title) && !WITH_PEOPLE.test(k.title)
    && (!k.fixed || isClassBlock({ title: k.title, ...(k.kind ? { kind: k.kind } : {}), fixed: true }));
/** The task when his words say he is starting work on it now ("econ", "the essay"), else undefined. Work means a work noun in it, or a
 *  name that resolves (blocksNamedBy) to a block on his day or a deadline in `known`. Pure. */
export function workStartTask(message, known = []) {
    const task = casualStartTask(message);
    if (!task)
        return undefined;
    if (WORK_NOUN.test(task))
        return task;
    // Wave 6 B (gate run-1101003318, foc-start-v): "ok lets work on econ" on a day with no econ block missed. A course he takes (his
    // course aliases, from his data) is work on any day, whether or not it meets today.
    const courses = [...courseAliases().keys()].map((code) => ({ title: code.toUpperCase(), kind: "class" }));
    const names = [...known, ...courses].filter(workable);
    return names.length && blocksNamedBy(task, names.map(asBlock), { intent: "study" }).length ? task : undefined;
}
