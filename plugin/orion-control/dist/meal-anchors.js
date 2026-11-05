/*
 "after lunch" when no lunch block is on the day (w20 round 3, gate #53): the usual end of the meal, so a plan with someone ("a 40 min call
 with mum after lunch") gets a real time instead of the scheduler's "a fixed plan needs --at". Pure.
*/
export const ANCHOR_END = [[/lunch/, 13 * 60 + 30], [/dinner|supper/, 19 * 60 + 30], [/breakfast/, 9 * 60]];
/** A plan with someone, or a place and a time: the scheduler books these at an exact time only (scripts/lib/life/live-day.mjs isSocial). */
export const SOCIAL_TITLE = /\bwith\b|\bfriends?\b|\bclub|party|bar\b|pub\b|date\b|meet(ing)?\b|appointment|doctor|dentist|interview|shift\b|flight|train\b|concert|gig\b|\bcall\b|\bcalling\b/i;
/** The usual end of the meal he said "after", in minutes since midnight. */
export function mealEnd(message) {
    const m = /\bafter\s+(?:my\s+|the\s+)?(lunch|dinner|supper|breakfast)\b/i.exec(message);
    return m ? ANCHOR_END.find(([re]) => re.test(m[1].toLowerCase()))?.[1] : undefined;
}
