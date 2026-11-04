import { openRequest } from "./open-request.js";
const LOCATION = "London";
const TIMER = /\b(?:set|start|put on|run)\s+(?:a|an|the|me a)?\s*(\d+)\s*(?:-|\s)?\s*(min(?:ute)?s?|m|hours?|hrs?|h|sec(?:ond)?s?|s)\b\s*timer\b|\btimer\s+(?:for|of)\s+(\d+)\s*(min(?:ute)?s?|m|hours?|hrs?|h|sec(?:ond)?s?|s)\b/i;
const WEEK = /\b(week|weekend|next few days|coming days|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/i;
const TOMORROW_WORDS = /\b(tomorrow|tmrw|tmr|tmrrw)\b/i;
// "did i take…", "have i had…", "what supplements did i take": a read of today's log, never a new dose.
const SUPPLEMENT_QUESTION = /\b(did|have|has)\s+i\b|\bwhat supplements\b|\?\s*$/i;
const SLEEP_LOG = /\b(log|logged|track|record|note)\b.*\bsleep|\bslept\b/i;
const WORKOUT_BY_TIME = /\b(workout|work out|worked out|gym session|training session|lift(?:ed|ing)?|run|ran)\b.*\b\d+\s*(min(?:ute)?s?|hours?|hrs?|h)\b/i;
const WORKOUT_SETS = /\b\d+\s*(x|reps?|sets?|lbs?|kg)\b/i;
const SLEEP_LINE = "I can't log sleep yet — I only track water, food, supplements and workout sets. Nothing was logged.";
const WORKOUT_LINE = "I can't log a workout by time yet — only exercises with their sets, like \"bench 135 for 8, 8, 6\". Nothing was logged.";
function seconds(amount, unit) {
    const n = Number(amount);
    if (/^h/i.test(unit))
        return n * 3600;
    if (/^s/i.test(unit))
        return n;
    return n * 60;
}
const call = (action, step, note, failLine) => ({ kind: "call", action, args: JSON.stringify({ steps: [{ action, ...step }] }), note, failLine });
/** He asked why ORION sent a weather notice: the forecast is looked up, then the reason is worded from it (never from memory). */
export function weatherDirective(sent) {
    const said = sent.replace(/["\\$`]/g, "").slice(0, 200);
    return call("weather_now", { location: LOCATION }, `He is asking WHY you sent him: "${said}". Answer that from the result only, in one or two short sentences, as the reason ("Because it's 46 degrees Fahrenheit and rain starts around 4"). Say temperatures in Fahrenheit as the words "degrees Fahrenheit" (never F, °F or Celsius). Do not ask whether he is ready and do not change anything.`, "I sent that because of the weather, but I can't check the forecast just now. Ask me again in a moment.");
}
/** "set a timer for 25 min": a timer, whatever the front desk picked (never a focus session, q032). */
// "cancel the timer for 10 min", "is my timer for 20 min still running": about a timer, not a new one
// (review, 2026-10-16).
const NOT_A_NEW_TIMER = /\b(cancel|stop|clear|remove|delete|kill|abort|never ?mind)\b|^\s*(is|are|was|how|what|whats|when|did|does|has|have)\b/i;
export const isTimerRequest = (message) => TIMER.test(message) && !NOT_A_NEW_TIMER.test(message);
/** The app named in an open-an-app request, or null when it is anything else (open-request.ts reads every shape). */
export function appOpenName(message) {
    const req = openRequest(message);
    return req?.kind === "app" ? req.name : null;
}
const hostOf = (url) => (/google\.com\/search/.test(url) ? "a search" : (/^https?:\/\/(?:www\.)?([^/]+)/i.exec(url)?.[1] ?? url));
const FIRST_PERSON = "One short sentence, in first person.";
/** "open safari", "open amazon in safari", "open my downloads folder": the one exact call (w18 opensafari). */
function openDirective(req) {
    if (req.kind === "app")
        return call("app_open", { application: req.name }, `Then say what you did, only if the result shows it, like "I opened ${req.name}." ${FIRST_PERSON}`, `I couldn't open ${req.name} — nothing opened. Is it installed under another name?`);
    if (req.kind === "folder")
        return call("folder_open", { folder: req.folder }, `Then say what you did, only if the result shows it, like "I opened your ${req.folder} folder." ${FIRST_PERSON}`, `I couldn't open your ${req.folder} folder — nothing opened.`);
    const where = req.browser ? ` in ${req.browser}` : "";
    return call("browser_open_url", { url: req.url, ...(req.browser ? { browser: req.browser } : {}) }, `Then say what you did, only if the result shows it, like "I opened ${hostOf(req.url)}${where}." ${FIRST_PERSON}`, `I couldn't open ${hostOf(req.url)}${where} — nothing opened.`);
}
/** The exact job for a front-desk tool move, when code can know it; null leaves the turn to the worker. */
export function toolDirective(decision, message) {
    if (decision?.move === "escalate")
        return null;
    const timer = decision && isTimerRequest(message) ? TIMER.exec(message) : null;
    if (timer) {
        const total = seconds(timer[1] ?? timer[3] ?? "0", timer[2] ?? timer[4] ?? "m");
        if (total >= 1 && total <= 86400)
            return call("timer_set", { seconds: total }, "Then say the timer is set, only if the result shows it.", "I didn't manage to set that timer — nothing is running. Can you say it again?");
    }
    const opening = openRequest(message);
    if (opening)
        return openDirective(opening);
    if (!decision || decision.move !== "tool")
        return null;
    const args = (decision.args ?? {});
    const tool = decision.tool ?? "";
    if (["log_intake", "supplements"].includes(tool) && SLEEP_LOG.test(message))
        return { kind: "say", text: SLEEP_LINE };
    if (["log_intake", "supplements"].includes(tool) && WORKOUT_BY_TIME.test(message) && !WORKOUT_SETS.test(message))
        return { kind: "say", text: WORKOUT_LINE };
    if (tool === "weather") {
        const days = WEEK.test(message) ? 7 : TOMORROW_WORDS.test(message) ? 1 : undefined;
        return call("weather_now", { location: LOCATION, ...(days ? { days } : {}) }, "Then answer his question from the result only (temperature, rain, what to wear). Say temperatures in Fahrenheit as the words \"degrees Fahrenheit\" on the first number in a sentence (\"a high of 55 degrees Fahrenheit and a low of 46\"); never F, °F or Celsius.", "I couldn't check the weather just now — try me again in a moment.");
    }
    if (tool === "supplements") {
        const name = typeof args.name === "string" ? args.name.trim() : "";
        // The supplement must be one he named: a desk-invented name never logs a dose.
        const named = name.toLowerCase().split(/\W+/).some((w) => w.length >= 3 && message.toLowerCase().includes(w));
        if (args.do === "take" && name && named && !SUPPLEMENT_QUESTION.test(message))
            return call("supplement_take", { name }, "Then say it is logged, only if the result shows it.", `I didn't manage to log your ${name} — nothing was recorded. Can you say it again?`);
        if (["search", "read", "status"].includes(String(args.do ?? "")) || SUPPLEMENT_QUESTION.test(message)) {
            return call("supplement_status", {}, "This is a question: do not log a dose. Answer from the result only (yes with the time, or no).", "I couldn't read your supplement log just now.");
        }
    }
    return null;
}
