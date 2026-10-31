/*
 "ok lets work on econ" (gate run-1031224700, foc-start-v): no start verb and no session word, so the session flow never saw a start.
 The desk guessed app_open "Econ", the worker then called a TOOL named orion-session (a script, not a tool), and Nick read "I can't use
 the tool orion-session here because it isn't available". Saying he is about to work on something, now, is a focus start like
 "start a focus session on econ": code starts it. Pure; session-flow.ts uses it next to its own START and MODE_ON readers.
*/
const LEAD = String.raw `^\W*(?:(?:ok(?:ay)?|ok so|alright|aight|right|cool|yeah|ya|yep|k|so|and|now|anyway)\b[\s,.!]*)*`;
const WHO = String.raw `(?:let'?s|lets|lemme|let me|i'?m gonna|im gonna|i'?m going to|im going to|gonna|time to|i'?ll|ill|i'?m about to|im about to)`;
const DOING = String.raw `(?:get (?:to work on|going on|on with|on|into|started on)|start(?:ing)? (?:on|with)|work(?:ing)? on|crack on with|knock out|grind(?: out)?|do|study|tackle|hit|focus on|lock in on|smash out|bang out)`;
const START_NOW = new RegExp(String.raw `${LEAD}${WHO}\s+${DOING}\s+(.+)$`, "i");
// Not now (the calendar's), or not something to start: when he says a time, a later part of the day, or it is a question.
const NOT_NOW = /\?|\b(?:later|tomorrow|tmrw|tonight|this (?:afternoon|evening|weekend)|after|before|at \d|in \d+|in an? (?:bit|hour|sec|min)|soon|eventually|at some point|next|someday|once|when)\b/i;
// What is not a piece of work to focus on.
const NOT_WORK = /^(?:it|this|that|something|anything|stuff|things|smth|some|nothing|lunch|dinner|breakfast|brunch|food|a snack|snack|a nap|nap|the gym|gym|a run|a walk|a workout|laundry|groceries|the dishes|dishes|a shower|chores|errands|my hair|a call|the call)\b/i;
const TAIL = /\s+(?:rn|right now|now|asap|pls|please|lol|lmao|haha|then|real quick|for a bit|for a while)\b.*$|[.,!]+.*$/i;
const LEAD_ARTICLE = /^(?:some|a bit of|a little|more)\s+/i;
/** The task when his words say he is starting work on it now ("econ", "the essay"), else undefined. */
export function workStartTask(message) {
    const m = START_NOW.exec(message.trim().replace(/[’`]/g, "'"));
    if (!m || NOT_NOW.test(message))
        return undefined;
    const task = m[1].replace(TAIL, "").replace(LEAD_ARTICLE, "").trim();
    if (!task || task.split(/\s+/).length > 6 || NOT_WORK.test(task))
        return undefined;
    return task;
}
