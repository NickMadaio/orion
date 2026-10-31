/*
 A preference he states is kept, and the reply says what was kept (W5, 2026-10-31, gate run-1031224700 per-preference-remember-v).

 "stop being so formal with me" got "Got it, Nick." and nothing was written; "remember i hate being called buddy" was kept only because
 the episodic journal happened to match "remember". A standing preference is the kind of fact orion-remember --user exists for (USER.md's
 Learned list, loaded into every session; scripts/orion-remember), so code writes it there and the reply is built from the result:
   - how he likes things: "i like gym in the evening", "i'd rather study in the morning", "remember i hate early mornings";
   - how ORION should talk to him: "stop being so formal with me", "dont call me buddy", "no more emojis", "be more chill".
 Not a preference: a reaction ("i love that", "i hate this"), a request with a day or time ("i'd rather do gym at 6 today" is the
 calendar's), a question, or a command to stop something running ("stop the timer").
*/
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { ORION_WAKE } from "./wake-flow.js";
const FILLER = /^(?:(?:hey|yo|ugh|ok(?:ay)?|so|also|and|btw|fyi|orion|oh|just so you know|for the record|heads up)[,\s]+)*/;
const KEEP = /^(?:(?:please|pls)\s+)?(?:remember|note|keep in mind|don'?t forget)(?:\s+(?:that|this))?[,:\s]+/;
const REACTION = /^(?:that|it|this|them|those|these|you|u|him|her|everything|myself|my life|life|this class|today|it here)\b/;
const SCHEDULING = /\b(?:today|tonight|tomorrow|tmrw|this (?:morning|afternoon|evening|week)|at \d|\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b(?:move|add|book|schedule|cancel|put|reschedule|push)\b)/;
const STYLE_NOUN = /\b(?:emojis?|emoticons?|exclamation(?: marks?| points?)?|caps|all caps|slang|bullet points?|long (?:messages?|texts?|replies)|essays?|my full name|nicknames?|pet names?)\b/;
const LIKE = [
    [/^i (?:really |kinda |kind of |honestly |do |much )?prefer\s+/, "prefers", "prefer"],
    [/^i(?:'?d| would) (?:much )?rather\s+/, "would rather", "would rather"],
    [/^i (?:really |kinda |honestly |do )?(?:like|love|enjoy)\s+/, "likes", "like"],
    [/^i (?:really |kinda |honestly |do )?(?:hate|despise|dislike|can'?t stand|cant stand|do not like|don'?t like|dont like)\s+/, "doesn't like", "don't like"],
    [/^i (?:really )?(?:don'?t|dont|do not) mind\s+/, "doesn't mind", "don't mind"],
];
const STYLE = [
    [/^(?:(?:please|pls|can you|could you)\s+)?(?:stop|quit)\s+(being|calling me|saying|using|sending|with)\s+/, (rest) => [`to stop ${rest}`, `to stop ${rest}`]],
    [/^(?:(?:please|pls)\s+)?(?:don'?t|dont|do not|never)\s+(call me|say|use|send|be so|be)\s+/, (rest) => [`not to ${rest}`, `not to ${rest}`]],
    [/^(?:(?:please|pls)\s+)?no more\s+/, (rest) => (STYLE_NOUN.test(rest) ? [`not to use ${rest}`, `not to use ${rest}`] : undefined)],
    [/^(?:(?:please|pls|can you|could you)\s+)?(?:be|talk|keep it|speak|text)\s+(?=(?:more |less |a bit |way |so )?(?:casual|chill|relaxed|formal|short|brief|direct|blunt|straight|normal|nicer|softer|real)\b)/, (rest) => [`to be ${rest}`, `to be ${rest}`]],
];
const swap = (s, to) => s.replace(/\b(?:i'm|im|i am|myself|me|my|mine|i)\b/g, (w) => {
    const third = { "i'm": "he's", im: "he's", "i am": "he is", myself: "himself", me: "him", my: "his", mine: "his", i: "he" };
    const second = { "i'm": "you're", im: "you're", "i am": "you are", myself: "yourself", me: "you", my: "your", mine: "yours", i: "you" };
    return (to === "third" ? third : second)[w] ?? w;
});
const ORION_YOU = (s) => s.replace(/\b(?:you|u)\b/g, "ORION");
/** Trailing filler ("pls", "tbh", "lol") and punctuation off the end. */
const trimEnd = (s) => s.replace(/(?:\s+(?:pls|please|thanks|thx|ty|tbh|lol|lmao|ok|okay|orion))+\s*[.!,;]*$/, "").replace(/[\s.!,;]+$/g, "").trim();
/** One clause: a preference, or undefined. `kept`: he said "remember …", so a reaction-shaped clause still counts. */
function clause(c, kept) {
    for (const [re, verb3, verb2] of LIKE) {
        const m = c.match(re);
        if (!m)
            continue;
        const rest = trimEnd(c.slice(m[0].length));
        if (!rest || (!kept && REACTION.test(rest)))
            return undefined;
        // "i hate being called buddy" is how to talk to him: said back without the name itself.
        const named = rest.match(/^being called\s+(.+)$/);
        if (named && verb3 === "doesn't like")
            return { fact: `Nick doesn't want to be called ${named[1]}`, echo: "you don't want me calling you that" };
        return { fact: `Nick ${verb3} ${swap(rest, "third")}`, echo: `you ${verb2} ${swap(rest, "second")}` };
    }
    for (const [re, build] of STYLE) {
        const m = c.match(re);
        if (!m)
            continue;
        const head = m[1] ? `${m[1]} ` : "";
        const rest = trimEnd(`${head}${c.slice(m[0].length)}`);
        if (!rest)
            return undefined;
        if (/^(?:using|sending|use|send)\b/.test(rest) && !STYLE_NOUN.test(rest))
            return undefined; // "stop sending the report" is not style
        if (/^call me\b/.test(rest))
            return { fact: `Nick wants ORION not to call him ${rest.replace(/^call me\s+/, "")}`, echo: "you don't want me calling you that" };
        if (/^calling me\b/.test(rest))
            return { fact: `Nick wants ORION to stop calling him ${rest.replace(/^calling me\s+/, "")}`, echo: "you don't want me calling you that" };
        const built = build(rest);
        if (!built)
            return undefined;
        return { fact: `Nick wants ORION ${ORION_YOU(swap(built[0], "third"))}`, echo: `you want me ${swap(built[1], "second")}` };
    }
    return undefined;
}
/** The preference(s) he stated in this message, or undefined. Pure. */
export function readPreference(message) {
    const raw = message.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
    if (!raw || /\?\s*$/.test(raw) || raw.length > 220)
        return undefined;
    const body = raw.replace(FILLER, "");
    const kept = KEEP.test(body);
    const said = body.replace(KEEP, "");
    if (SCHEDULING.test(said))
        return undefined;
    const parts = said.split(/\s*(?:,|;|\band\b|\balso\b|\bplus\b)\s+(?=(?:i |i'd |don'?t |dont |do not |never |stop |quit |no more |be |talk |keep it |please ))/);
    const found = parts.map((p) => clause(p.trim(), kept));
    if (!found.length || found.some((f) => !f))
        return undefined;
    const all = found;
    return { fact: all.map((f) => f.fact).join("; "), echo: all.map((f) => f.echo).join(", and ") };
}
/** Writes it with orion-remember --user and answers from the result. Nothing is claimed unless the script says it was remembered. */
export async function savePreference(pref, run) {
    const args = ["--user", `Preference: ${pref.fact}.`];
    const out = await run(args).catch(() => ({ stdout: "", code: 1 }));
    const call = `exec orion-remember --user "Preference: ${pref.fact}."`;
    if (out.code === 0 && /\bremembered\b/i.test(out.stdout))
        return { outcome: "done", calls: [call], outputs: [out.stdout], reply: `Got it — I'll remember ${pref.echo}.` };
    return { outcome: "say", kind: "plain", text: "I couldn't save that just now, so it isn't kept yet. Say it again in a bit.", calls: [call], outputs: [out.stdout] };
}
/** The real script (no shell, fixed arguments), beside orion-wake in the repo's scripts (ORION_SCRIPTS_DIR for a replay). Wired in by index.ts only. */
export const liveRememberRun = (args) => new Promise((resolve) => execFile(join(process.env.ORION_SCRIPTS_DIR || dirname(ORION_WAKE), "orion-remember"), args, { timeout: 15000 }, (e, stdout, stderr) => resolve({ stdout: `${String(stdout ?? "")}${String(stderr ?? "")}`, code: e ? 1 : 0 })));
