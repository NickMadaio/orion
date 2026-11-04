/*
 The water goal, by chat (2026-11-04).

 Nick: "make it so if I right click the water I can change the 'out of' number." The number is `water` inside the health log's
 `nutritionGoals` (default 9, 1 to 30), the one place the Mac app, ORION Link, the phone, the widgets and these scripts read it.

   set    "set my water goal to 10", "i want to drink 8 bottles a day", "bump my water goal up to 11": written, and the reply says it
   ask    "change my water goal" (no number): asks which
   read   "whats my water goal", "how many bottles am i aiming for"
 A number outside 1 to 30 is said no to, never clamped. Logging water ("i drank 2 bottles") and questions about today's count are not this.
*/
import { join } from "node:path";
import { mutate, readHealthLog, today as dayOf } from "./health.js";
export const WATER_GOAL_DEFAULT = 9;
const MIN = 1;
const MAX = 30;
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30 };
const NUM = String.raw `(\d{1,3}|${Object.keys(WORDS).join("|")})`;
const toNumber = (s) => (s === undefined ? undefined : /^\d+$/.test(s) ? Number(s) : WORDS[s.toLowerCase()]);
const GOAL = String.raw `(?:goal|target|aim)`;
/** "water goal", "water target", "daily water goal". */
const WATER_GOAL = new RegExp(String.raw `\bwater\s+${GOAL}s?\b|\b${GOAL}s?\s+(?:for|of)\s+(?:my\s+)?(?:daily\s+)?water\b|\bdaily\s+water\b`, "i");
const SET_VERB = /\b(?:set|change|make|update|bump|up|raise|lower|put|switch|adjust|move|push|drop|cut|make it|let'?s do|lets do)\b/i;
// "i want to drink 8 bottles a day", "id like to be drinking 11 bottles daily", "lets do twelve bottles a day".
const WANT = new RegExp(String.raw `\b(?:i\s+(?:want|wanna|would like|need|should|gotta|have to)|i'?d like|id like|lets|let'?s|from now on)\b[^.?!]{0,30}?\b${NUM}\s+(?:big\s+|full\s+)?bottles?\b[^.?!]{0,20}\b(?:a|per|each|every)\s+day\b|\b${NUM}\s+bottles?\s+(?:a|per|each|every)\s+day\b[^.?!]{0,30}\b(?:from now on|going forward|is my goal|as my goal)\b|\b(?:i\s+(?:want|wanna|would like)|i'?d like|id like)\b[^.?!]{0,30}?\b(?:drink|drinking|have|having|do)\b[^.?!]{0,12}\b${NUM}\s+bottles?\s+(?:of\s+water\s+)?(?:daily)\b|\blets do ${NUM} bottles? daily\b`, "i");
const NOT_A_GOAL = /\b(?:remind|alarm|timer|calendar|schedule|log|logged|drank|had|finished|calories?|bedtime|gym|essay|liters?|litres?|glasses|cups|oz|ounces|ml)\b/i;
const ASK_GOAL = new RegExp(String.raw `\b(?:what(?:'s|s| is| was)?|wats|whats|tell me|show me|remind me what)\b[^.?!]{0,25}\b(?:water\s+${GOAL}|${GOAL}\s+for\s+(?:my\s+)?water|out of number for (?:my )?water)|\bhow many bottles\b[^.?!]{0,25}\b(?:is|am i|are we)\b[^.?!]{0,20}\b(?:goal|target|aiming|supposed to|meant to)\b|\bhow many bottles a day\b[^.?!]{0,25}\b(?:aiming|goal|target|supposed)`, "i");
/** What he said about the goal, or null. Pure. */
export function readWaterGoal(message) {
    const m = message.trim().replace(/\s+/g, " ");
    if (m.length > 140)
        return null;
    if (ASK_GOAL.test(m))
        return { kind: "water", read: true };
    const wants = WANT.exec(m);
    if (wants && !/\b(?:remind|alarm|timer|calendar|schedule|liters?|litres?|glasses|calories?)\b/i.test(m)) {
        const bottles = toNumber(wants.slice(1).find((g) => g !== undefined));
        if (bottles !== undefined)
            return { kind: "water", read: false, bottles };
    }
    if (!WATER_GOAL.test(m) || NOT_A_GOAL.test(m) || /\?\s*$/.test(m))
        return null;
    const bottles = toNumber(new RegExp(String.raw `\b${NUM}\b(?!\s*(?:am|pm|:))`, "i").exec(m)?.[1]);
    if (bottles !== undefined)
        return { kind: "water", read: false, bottles };
    return SET_VERB.test(m) || /\b(?:different|new|another)\b/i.test(m) ? { kind: "water", read: false } : null;
}
const noun = (n) => `${n} bottle${n === 1 ? "" : "s"}`;
const validGoal = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.min(MAX, Math.max(MIN, Math.round(v))) : WATER_GOAL_DEFAULT);
const DEFAULT_GOALS = { calories: 2200, protein: 150, carbohydrates: 250, fat: 70, fiber: 30 };
/** Today's count by the app's day rule: before 4 AM is still yesterday. */
function bottlesToday(log, now) {
    const record = log?.days?.[dayOf(new Date(now.getTime() - 4 * 3_600_000))];
    return typeof record?.waterBottles === "number" ? record.waterBottles : 0;
}
export async function runWaterGoal(read, deps) {
    const file = join(deps.stateDir, "health-log.json");
    const log = await readHealthLog(file).catch(() => undefined);
    const current = validGoal(log?.nutritionGoals?.water);
    const at = `You're at ${bottlesToday(log, deps.now)} today.`;
    const say = (text, kind = "plain") => ({ outcome: "say", kind, text, calls: ["read health-log.json nutritionGoals.water"], outputs: [String(current)] });
    if (read.read)
        return say(`Your water goal is ${noun(current)} a day. ${at}`);
    if (read.bottles === undefined)
        return say(`How many bottles a day? It's ${current} now.`, "ask");
    const bottles = read.bottles;
    if (!Number.isInteger(bottles) || bottles < MIN || bottles > MAX)
        return say(`I can set it anywhere from ${MIN} to ${MAX} bottles a day, so it's still ${current}.`);
    if (bottles === current && typeof log?.nutritionGoals?.water === "number")
        return say(`Your water goal is already ${noun(current)} a day.`);
    try {
        await mutate(file, (l) => { l.nutritionGoals = { ...DEFAULT_GOALS, ...(l.nutritionGoals ?? {}), water: bottles }; });
    }
    catch {
        return { outcome: "say", kind: "plain", text: `I couldn't write to your health log just now, so your water goal is still ${current}.` };
    }
    return { outcome: "done", calls: [`write health-log.json nutritionGoals.water ${bottles}`], outputs: [JSON.stringify({ water: bottles, was: current })],
        reply: `Water goal is now ${noun(bottles)} a day (was ${current}). ${at}` };
}
