/*
 Water he drank and calories he has had, by code (w20 R3, live gate #27 and #68).

 "had a big bottle of water" logged 3 bottles (the worker read "big" as a count), and "how many calories have i had today" got "I don't have
 access to your calorie tracking data" while health-log.json held them. A bottle is the unit the goal and the count are in (nutritionGoals.water,
 "x of 9"); there is no bottle size in his config, so "a bottle" / "a big bottle" / "another bottle" is ONE bottle, a number is that many, and
 glasses, cups, litres or "some water" are asked about rather than guessed. The write is scripts/orion-log (the one lock-aware writer);
 the calorie answer is read from the same health-log.json, never recalled.
*/
import { execFile } from "node:child_process";
import { join } from "node:path";
import { readHealthLog, today as dayOf } from "./health.js";
import { scriptPath } from "./tool-guards.js";
const WORDS = { a: 1, an: 1, one: 1, another: 1, two: 2, couple: 2, three: 3 };
const WATER = /\b(?:water|bottles?|hydrat\w*)\b/i;
const NOT_A_LOG = /\?\s*$|\b(?:goal|target|aim|remind|alarm|timer|calendar|schedule|how many|how much|what|whats|did i|have i|do i|am i|should|need to|want to|wanna|going to|gonna|will|tomorrow|tonight|later|not|haven'?t|didn'?t|never|without|forgot|no water)\b/i;
const DRANK = /\b(?:had|drank|drunk|finished|downed|chugged|sank|polished off|knocked back|just had|im on|i'?m on|log(?:ged)?|add(?:ed)?|\+\s*\d)\b/i;
const OTHER_UNITS = /\b(?:glass(?:es)?|cups?|mugs?|litres?|liters?|oz|ounces?|ml|pints?|sips?|some|bit of|little)\b/i;
const COUNT = /\b(\d{1,2}|one|two|three|a couple(?: of)?|couple|an?|another)\s+(?:(?:big|large|full|huge|small|whole|half|tall|more|extra|other|quick|\w+ing)\s+)*bottles?\b/i;
/** "had a big bottle of water" = 1 bottle; "drank 2 bottles" = 2; glasses / litres / "some water" ask; null when it is not a report of drinking. */
export function readWaterLog(message) {
    const m = message.trim().replace(/\s+/g, " ");
    if (m.length > 120 || !WATER.test(m) || NOT_A_LOG.test(m) || !DRANK.test(m))
        return null;
    if (OTHER_UNITS.test(m) && !COUNT.test(m))
        return { kind: "waterlog", amountWord: (OTHER_UNITS.exec(m)?.[0] ?? "water").toLowerCase() };
    const c = COUNT.exec(m)?.[1]?.toLowerCase().replace(/\s+of$/, "");
    if (!c)
        return /\b(?:water|hydrat\w*)\b/i.test(m) ? { kind: "waterlog", amountWord: "water" } : null;
    const n = /^\d+$/.test(c) ? Number(c) : WORDS[c.replace(/^a couple$/, "couple")] ?? undefined;
    return n === undefined ? null : { kind: "waterlog", bottles: n };
}
const CAL_WORD = String.raw `(?:calories|calorie|cals?|kcals?)`;
const ASK_CAL = new RegExp(String.raw `\b(?:how many|how much|what(?:'s|s| is| are)?|whats|tell me|check|show me)\b[^.?!]{0,30}\b${CAL_WORD}\b|\b${CAL_WORD}\b[^.?!]{0,20}\b(?:have i|did i|i(?:'ve| have)|so far|today|ive|eaten|left|total)\b`, "i");
const ASK_PROTEIN = /\bhow much protein\b[^.?!]{0,30}\b(?:have i|did i|i(?:'ve| have)|ive|so far|today|eaten)\b|\bprotein\b[^.?!]{0,20}\b(?:so far|today)\b/i;
// "how many calories in a big mac", "calories in rice": the food's, not his day's.
const OF_A_FOOD = /\b(?:in|of|does|do|is|are|per)\s+(?:a|an|the|one|my|some|\d+)\b|\bcalories? (?:in|for|of)\b|\bburn(?:ed|t|s)?\b|\bgoal\b|\bshould\b|\bcut\b|\bneed\b/i;
export function readIntakeQuestion(message) {
    const m = message.trim().replace(/\s+/g, " ");
    if (m.length > 120 || OF_A_FOOD.test(m))
        return null;
    const yesterday = /\byesterday\b/i.test(m);
    if (/\b(?:this week|last week|last night|average|each day|per day|a day)\b/i.test(m))
        return null;
    if (ASK_PROTEIN.test(m))
        return { kind: "intake", what: "protein", yesterday };
    if (ASK_CAL.test(m))
        return { kind: "intake", what: "calories", yesterday };
    return null;
}
/** The real orion-log, pointed at this state dir's health-log.json. */
export const liveOrionLog = (args, healthLog) => new Promise((resolve) => execFile(scriptPath("orion-log"), args, { timeout: 15000, env: { ...process.env, ORION_HEALTH_LOG: healthLog } }, (e, stdout, stderr) => resolve({ stdout: e ? `${String(stdout ?? "")}${String(stderr ?? "")}` : String(stdout ?? ""), code: e ? (typeof e.code === "number" ? e.code : 1) : 0 })));
const DAY_RULE_MS = 4 * 3_600_000; // the app's day: before 4 AM is still yesterday
export async function runIntake(read, deps) {
    const file = join(deps.stateDir, "health-log.json");
    if (read.kind === "waterlog") {
        if (read.bottles === undefined) {
            return { outcome: "say", kind: "ask", text: `How many bottles was that? I count in bottles, and ${read.amountWord === "water" || read.amountWord === "some" ? "I wasn't sure how much you meant" : `I can't turn ${read.amountWord} into bottles`}.` };
        }
        if (read.bottles < 1 || read.bottles > 3)
            return { outcome: "say", kind: "plain", text: "I can log 1 to 3 bottles at a time. Tell me how many and I'll add them." };
        const args = ["water", String(read.bottles)];
        const r = await (deps.log ?? liveOrionLog)(args, file).catch(() => ({ stdout: "", code: 1 }));
        const text = r.stdout.trim().split("\n")[0] ?? "";
        if (r.code !== 0 || !/^Logged\b/.test(text))
            return { outcome: "say", kind: "plain", text: "I couldn't log that water just now, so your count is unchanged.", calls: [`exec orion-log ${args.join(" ")}`], outputs: [r.stdout] };
        return { outcome: "done", calls: [`exec orion-log ${args.join(" ")}`], outputs: [r.stdout], reply: text };
    }
    const log = await readHealthLog(file).catch(() => undefined);
    if (!log)
        return { outcome: "say", kind: "plain", text: "I couldn't read your health log just now." };
    return answerIntake(read, log, deps.now);
}
const sumOf = (rows, key) => (rows ?? []).reduce((a, r) => a + (typeof r?.[key] === "number" ? (r[key] ?? 0) : 0), 0);
/** Calories / protein for the day, from the meals logged (and the day record's calorie total), in his words. */
export function answerIntake(read, log, now) {
    const base = new Date(now.getTime() - DAY_RULE_MS - (read.yesterday ? 86_400_000 : 0));
    const day = dayOf(base);
    const rows = (log.nutritionLog ?? {})[day];
    const meals = (rows ?? []).filter((r) => r && typeof r === "object");
    const record = log.days?.[day];
    const when = read.yesterday ? "yesterday" : "today";
    let value = read.what === "calories" ? Math.max(sumOf(meals, "calories"), typeof record?.calories === "number" ? record.calories : 0) : sumOf(meals, "protein");
    value = Math.round(value);
    const unit = read.what === "calories" ? "kcal" : "g of protein";
    const calls = [`read health-log.json nutritionLog ${day}`];
    const outputs = [JSON.stringify({ day, value, meals: meals.length })];
    if (!meals.length && !value)
        return { outcome: "say", kind: "plain", text: `Nothing's logged for food ${when}, so that's 0 ${unit}.`, calls, outputs };
    const goal = read.what === "calories" && typeof log.nutritionGoals?.calories === "number" ? ` of ${Math.round(log.nutritionGoals.calories)}` : "";
    const names = meals.map((r) => String(r.title ?? "")).filter(Boolean).slice(0, 4);
    const from = names.length ? `, from ${names.join(", ")}` : "";
    return { outcome: "say", kind: "plain", text: `You've had ${value}${goal} ${unit} ${when}${from}.`, calls, outputs };
}
