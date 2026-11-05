/*
 Words that look like "put X at <time>" but are not a calendar block (w20 fix-dayedit, review H6): switching a device on, putting
 clothes on, adding a food to his meals or a thing to a list. schedulingAsk (route-gate.ts) and the day-edit reader both ask this
 first, so "put the heating on at 6" is never a block called "heating on" and "add chicken at 7pm to my meals" stays the food route's.
 A calendar noun in the message ("put gym on my calendar at 6") still makes it a calendar ask.
*/
const CALENDAR_NOUN = /\b(?:calendar|schedule|planner|plan|agenda)\b/;
const DEVICE = "(?:heating|heater|central heating|oven|hob|stove|kettle|aircon|air ?con|lights?|lamp|dishwasher|washing machine|dryer|thermostat|coffee machine|coffee maker|toaster|microwave)";
/** "put the heating on", "put on gym shorts", "put my coat on": a thing put on, not a thing put on the day. */
const PUT_ON = /\bput\s+(?:on\b|[a-z' ]{1,30}?\s+on\b(?!\s+(?:the |my |your )?(?:calendar|schedule|plan|planner|day|today|tomorrow|tmrw|list)))/;
const DEVICE_ASK = new RegExp(String.raw `\b(?:put|set|turn|switch|have|get|start|leave)\b[^.;]*\b${DEVICE}\b`);
/** "add chicken at 7pm to my meals", "put milk on my list at 5": food and lists have their own routes. */
const TO_LIST = /\b(?:add|put|log|track|count|save)\b.*\b(?:to|in|into|on)\s+(?:my\s+|the\s+)?(?:meals?|food(?:\s+log)?|diet|calories|macros|intake|(?:shopping |grocery |to-?do |todo )?list|groceries|notes?|log)\b/;
/** True when the message only looks like a calendar ask. */
export function notScheduling(message) {
    const m = message.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
    if (CALENDAR_NOUN.test(m))
        return false;
    return TO_LIST.test(m) || PUT_ON.test(m) || DEVICE_ASK.test(m);
}
