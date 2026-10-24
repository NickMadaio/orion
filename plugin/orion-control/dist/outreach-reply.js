/*
 His reply to something ORION said first (2026-10-23 audit: "if i respond he doesnt have context of him talking to me
 proactively so my response makes no sense").

 The label was on the prompt every time, but userText() strips it and the front desk was called with his words alone, so:
   10-20 "It's been 30 min. Gym, now." → "I'm meal prepping. That's why. Sorry." → "What time or how long do you mean?"
   10-19 "It's 12:02 AM, bedtime."     → "im doing work shush up"                 → "Since when — what time did you start work?"
   10-16 "past bedtime; sleep now"     → "Yea yea yea I know, just wrapping up…"   → an alarm labelled "push my alarm"
 Here: read what ORION said from either prefix (the Mac's "[ORION context: …]", the phone's "- N min ago you …"), give it to the
 front desk as ORION's last turn, and read the short answers ("yeah", "not yet", "in 10", "already did", "shush") against it
 in code. Pure: no I/O.
*/
const BEDTIME = /\b(?:bedtime|past bedtime|bed at \d|still up at|sleep now|go to (?:bed|sleep))\b/i;
const START = /^(?:time to start: |.+ — still not started|it'?s been \d+ min\. .+, now\.|you'?ve been avoiding .+ for \d+ min)/i;
export function kindOf(text, hint) {
    if (hint === "bedtime" || hint === "start" || hint === "question" || hint === "info")
        return hint;
    if (BEDTIME.test(text))
        return "bedtime";
    if (START.test(text) || hint === "mismatch")
        return "start";
    return /\?\s*$/.test(text.trim()) ? "question" : "info";
}
/** The planned block a "start" line is about: "Time to start: Gym." / "Gym — still not started" / "It's been 30 min. Gym, now." */
export function titleOf(text, label = "") {
    const fromLabel = label.match(/\(([^()]+?), planned \d{1,2}:\d{2}/)?.[1];
    if (fromLabel)
        return fromLabel.trim();
    const m = text.match(/^time to start: (.+?)\.?$/i) ?? text.match(/^(.+?) — still not started/i)
        ?? text.match(/^it'?s been \d+ min\. (.+?), now\./i) ?? text.match(/avoiding (.+?) for \d+ min/i);
    return m?.[1]?.trim();
}
/** What ORION said first, from the Mac label or the phone's context line; undefined when the prompt carries neither. */
export function parseOutreach(prompt) {
    const mac = prompt.match(/\[ORION context:([^\]]*)\]/)?.[1];
    if (mac) {
        const text = mac.match(/"([^"]+)"/)?.[1];
        if (!text)
            return undefined;
        const minutes = Number(mac.match(/(\d+) min ago/)?.[1] ?? 0);
        const hint = mac.match(/min ago \((bedtime|start|question|info)\)/)?.[1] ?? (/\(mismatch|not started\)/.test(mac) ? "mismatch" : undefined);
        const title = titleOf(text, mac);
        return { text, minutes, kind: kindOf(text, hint), ...(title ? { title } : {}) };
    }
    const phone = prompt.match(/^- (\d+) min ago you (?:messaged him first(?: \((\w+)\))?: |asked him )"([^"]+)"(.*)$/m)
        ?? prompt.match(/^- You messaged him first[^"]*?"([^"]+)"()()(.*)$/m);
    if (!phone)
        return undefined;
    const [, a, b, c, rest = ""] = phone;
    const text = c || a || "";
    if (!text)
        return undefined;
    const minutes = c ? Number(a) : 0;
    const title = titleOf(text, rest);
    return { text, minutes, kind: kindOf(text, c ? b : undefined), ...(title ? { title } : {}) };
}
const NUM = { "a few": 5, "a couple": 2, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30 };
const num = (n) => (/^\d+$/.test(n) ? Number(n) : (NUM[n] ?? NaN));
/** At most this many words: a short answer is the WHOLE reply (review 2026-10-23: "set an alarm for 8 am" read "am" as a+m). */
export const SHORT_MAX_WORDS = 6;
const N = "(\\d{1,3}|a few|a couple|five|ten|fifteen|twenty|thirty)";
const MINS = "(?:min|mins|minute|minutes)";
const LATER = [
    new RegExp(`^(?:ok(?:ay)? )?(?:in|give me|another|maybe|about) ${N}(?: more)?(?: ${MINS})?(?: more)?$`),
    new RegExp(`^${N} (?:more )?${MINS}(?: more)?$`),
];
const HOUR = /^(?:ok(?:ay)? )?(?:in |give me |another )?(an|one|half an) (?:hour|hr)(?: more)?$/;
const YES = /^(?:ya|yea|yeah|yes|yep|yup|ok|okay|k|sure|on it|going|going now|omw|alright|will do|aight|night|goodnight|good night|gn|heading to bed|going to bed)(?: (?:orion|now|ok|okay|nick))?$/;
const DONE = /^(?:already (?:did(?: it)?|done|in bed|asleep|there|finished)|i already did(?: it)?|did it|done|done already|finished|just finished|i'?m (?:already )?(?:in bed|at the gym|there))$/;
const NOT_YET = /^(?:not yet|nah not yet|no not yet|in a (?:bit|sec|minute|min)|soon|later|one sec)$/;
const STOP = /^(?:shush|shush up|shut up|leave me alone|i know|go away|not now|enough|stop nagging|stop it|stop)$|^(?:i'?m|im|i am) (?:doing|finishing|working on) [a-z]+(?: [a-z]+)? (?:shush|shush up|shut up)$/;
const NO = /^(?:no|nope|nah|not today)$/;
const OTHER = /^(?:i'?m|im|i am) (?:just |still )?((?:[a-z]+ )?[a-z]+ing)(?: (?:rn|right now|now))?(?: that'?s why)?(?: sorry)?$/;
/** A short answer, only when it is the WHOLE reply (anchored, six words or fewer, nothing else in it); undefined otherwise. */
export function readShortReply(message) {
    const m = message.trim().toLowerCase().replace(/[‘’]/g, "'").replace(/[.!,…]+/g, " ").replace(/\s+/g, " ").trim();
    if (!m || m.split(" ").length > SHORT_MAX_WORDS || /\?/.test(message))
        return undefined;
    for (const re of LATER) {
        const x = m.match(re);
        if (x) {
            const v = num(x[1]);
            if (v > 0 && v <= 240)
                return { kind: "later", minutes: v };
        }
    }
    const hour = m.match(HOUR);
    if (hour)
        return { kind: "later", minutes: hour[1] === "half an" ? 30 : 60 };
    if (YES.test(m))
        return { kind: "yes" };
    if (DONE.test(m))
        return { kind: "done" };
    if (NOT_YET.test(m))
        return { kind: "not-yet" };
    if (STOP.test(m))
        return { kind: "stop" };
    if (NO.test(m))
        return { kind: "no" };
    const other = m.match(OTHER);
    if (other && !/^(?:going|doing|nothing)$/.test(other[1]))
        return { kind: "other", activity: other[1] };
    return undefined;
}
const q = (s) => `"${s.replace(/["\\$`]/g, "").slice(0, 80)}"`;
/**
 * Code's whole answer to a short reply to a bedtime or start line; undefined → the normal turn, which has the context.
 * A start line's loop is acted on by its id only (the caller finds it); a "no" or "stop" to a start line is never acted on by
 * code (it cancelled the newest check-in and removed a calendar block, review 2026-10-23).
 */
export function planOutreachReply(o, message) {
    const r = readShortReply(message);
    if (!r)
        return undefined;
    if (o.kind === "bedtime") {
        switch (r.kind) {
            case "yes": return { text: "Night, Nick." };
            case "done": return { text: "Good. Night, Nick." };
            case "later": return { text: `Okay, ${r.minutes} more minutes, then sleep. That was my last bedtime reminder tonight.` };
            case "not-yet": return { text: "Okay. That was my last bedtime reminder tonight." };
            default: return { text: "Got it, I'll leave you to it. No more bedtime reminders tonight." };
        }
    }
    if (o.kind === "start" && o.title) {
        const t = o.title, find = { what: t };
        switch (r.kind) {
            case "later": return { text: `Okay, ${t} in ${r.minutes} min. I'll check in then.`, act: { verb: "defer", minutes: r.minutes, because: message.slice(0, 120) }, find };
            case "not-yet": return { text: `Okay, not yet. I'll check on ${t} in 15 min.`, act: { verb: "defer", minutes: 15, because: message.slice(0, 120) }, find };
            case "other": return { text: `Okay, ${r.activity} first. I'll check back about ${t} in 25 min.`, act: { verb: "defer", minutes: 25, because: message.slice(0, 120) }, find };
            case "done": return { text: `Nice, ${t} done. I'll stop pinging about it.`, act: { verb: "done" }, find };
            case "yes": return { text: `Good. Go, I'll check in later that ${t}'s still going.`, act: { verb: "started" }, find };
            default: return undefined;
        }
    }
    return undefined;
}
/** argv for orion-checkin acting on loop `id`. */
export const loopArgs = (act, id) => act.verb === "defer" ? ["defer", String(act.minutes), id, "--because", act.because] : [act.verb, id];
/** For the worker when code does not answer: ORION's own message, as the conversation it is, and how to read his answer. */
export function outreachNote(o) {
    const meaning = o.kind === "bedtime" ? "it was a bedtime reminder: whatever he says, no more bedtime reminders tonight; never ask when he started something"
        : o.kind === "start" ? `it was about starting ${o.title ? q(o.title) : "a planned block"}: "not yet"/"in 10" means later (defer the open check-in about it, with his reason), "already did" means done, something else he is doing means it waits; never a calendar change and never a cancel unless he asks for one`
            : o.kind === "question" ? "\"yeah\" accepts what you offered, \"no\" declines it" : "read his message as an answer to it";
    return `[Conversation so far: ${o.minutes} min ago YOU (ORION) messaged him first: "${o.text.slice(0, 300)}". His message below is his reply to that; ${meaning}.]`;
}
/** The front desk's "Earlier:" turn. */
export const outreachHistory = (o) => [{ role: "assistant", content: o.text.slice(0, 300) }];
