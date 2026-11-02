/*
 Corrections become standing rules (wave 12, 2026-11-02).

 In-chat fixes lived in turn memory (edit-followup.ts, calendar-intent.ts) and were gone when the session ended: the audit found no
 correction ever became a durable rule. A correction he means to LAST is now written with orion-remember --user into USER.md's
 learned lines ("- <date> — Rule: …"), the same store preference-remember.ts writes, which `orion_v2_workspace_sync.sh` now keeps
 and the nightly consolidator dedupes. standingRulesLine() reads them back into every local turn's state card; cloud sessions load
 USER.md whole.

 What counts, and what is one-off (edit-followup's, in this chat only):
   naming    "stop calling it X, it's Y", "it's called Y not X", "call it Y not X"          -> Nick calls it "Y", not "X"
   meaning   "when i say X i mean Y", "by X i mean Y"                                       -> when Nick says "X" he means Y
   standing  "dont / never / stop / quit" + something ORION does, with no "today", "it",    -> Nick wants ORION not to …
             "tonight" making it about this one time
   restated  "no i prefer …", "i told you i hate …": a preference said again as a correction -> Preference: … (preference-remember)
 One-off, never a rule (fixer, 2026-11-02): a plain "dont <verb> <thing>" is a decision about THIS time. It is kept only when its
 wording is explicit ("ever", "anymore", "again", "always", "from now on") or general ("anything before 10am", "stuff on sundays"),
 and a general one that uses the verb of ORION's pending offer ("want me to move your study block?" -> "no dont move my study
 block", "dont book anything at 6am" after "should I book gym at 6am?") is still just the answer to that offer. "never",
 "stop/quit doing", "i prefer", naming and meaning are explicit on their own.
 Never kept: a plain "no", "no i meant tomorrow" (this chat's fix), a bare "dont move it", anything near distress or shaped like
 instructions, and the anchors preference-remember also refuses (dropping gym or classes, silencing check-ins or alarms with no
 "when"). Nothing is captured inside an evaluation (the eval-mode marker) or any session that is not Nick's (isNickSession).
 Saved rules are capped (rule-cap.ts).
*/
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isCrisis, touchesLifeOrDeath } from "./distress.js";
import { readPreference } from "./preference-remember.js";
import { enforceRuleCap, hasRule } from "./rule-cap.js";
import { readLastOutreach } from "./state-card.js";
export { MAX_RULES, capRules } from "./rule-cap.js";
const MAX_SAID = 160;
const MAX_FACT = 120;
const MAX_NAME = 40;
const LEAD = /^(?:(?:no|nah|nope|naw|actually|ugh|bro|dude|man|orion|ok(?:ay)?|wait|hey|yo|again|like i said)[,!.\s]+)+/i;
const TOLD = /^(?:i (?:already |literally )?(?:told (?:you|u)|said)|like i said)(?: (?:that|before|already))?[,\s]+/i;
const INJECTION = /\b(?:ignor(?:e|ing)|disregard\w*|instructions?|system prompt|prompts?|you are now|act as|pretend|jailbreak|override|delet(?:e|es|ing)|wipe|sudo|exec|password|token|api key|root)\b|\brm\s+-|[<>{}`$\\|]|https?:|\b(?:system|assistant|user|developer|admin)\s*:/i;
const PRONOUN = /^(?:it|that|this|them|those|these|one|that one|this one|me|him|her)$/i;
const ONE_OFF = /\b(?:today|tonight|tomorrow|tmrw|this (?:morning|afternoon|evening|week|time|one)|right now|now|yet|for now|just this|that one)\b/i;
const TAIL = /\s+(?:again|anymore|any more|ever|please|pls|thanks|ok|okay|lol|tbh)\s*$/i;
const NOT_A_NAME = /^\d|\b(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|today|tonight|tomorrow|fine|ok|okay)\b/i;
const ADD_VERB = "schedule|scheduling|book|booking|put|putting|add|adding|plan|planning";
const CONTACT_VERB = "ping|pinging|text|texting|message|messaging|nudge|nudging|remind|reminding|bug|bugging|wake|waking|call|calling";
const OTHER_VERB = "move|moving|ask|asking|suggest|suggesting|bring up|bringing up|mention|mentioning|double[- ]book|double[- ]booking|send|sending|tell|telling|give|giving|cancel|cancelling|canceling|shorten|shortening|stack|stacking";
const STANDING = new RegExp(String.raw `^(?:(?:please|pls)\s+)?(don'?t|dont|do not|never|stop|quit)\s+(ever\s+)?(${ADD_VERB}|${CONTACT_VERB}|${OTHER_VERB})\b\s*(.*)$`, "i");
const ANCHOR = /\b(?:gym|workouts?|working out|lifting|training|class(?:es)?|lectures?|seminars?|labs?|check[- ]?ins?|alarms?|wake[- ]?ups?)\b/i;
const FROM_NOW = /^(?:from now on|going forward|in (?:the )?future)[,\s]+|[,\s]+(?:from now on|going forward|in (?:the )?future)$/i;
const EXPLICIT = /\b(?:ever|anymore|any more|again|always|from now on|going forward)\b/i;
const GENERAL = /\b(?:anything|any|stuff|things|everything|anyone|without asking)\b/i;
const QUALIFIED = /\b(?:before|after|during|while|when|whenever|until|between|unless|if|on (?:mon|tues|wednes|thurs|fri|satur|sun)days|at night|in the (?:morning|evening|afternoon)|mornings|evenings|nights|weekends|weekdays|back to back|\d)\b/i;
const tidy = (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
const trimEnd = (s) => s.replace(/[\s.!,;]+$/g, "").trim();
const swap = (s) => s.replace(/\b(?:me|my|mine|myself|i'm|im|i)\b/gi, (w) => ({ me: "him", my: "his", mine: "his", myself: "himself", "i'm": "he's", im: "he's", i: "he" }[w.toLowerCase()] ?? w));
const name = (s) => {
    const n = trimEnd((s ?? "").replace(/^["']|["']$/g, "").replace(/^(?:it|that|this|them)\s+/i, ""));
    return n && n.length <= MAX_NAME && !PRONOUN.test(n) && !NOT_A_NAME.test(n) && n.split(" ").length <= 5 ? n : undefined;
};
function naming(s) {
    const called = s.match(/^(?:it'?s|its|it is) called (.+?),? not (.+)$/i) ?? s.match(/^call it (.+?),? not (.+)$/i);
    if (called) {
        const right = name(called[1]);
        const wrong = name(called[2]);
        return right && wrong ? { kind: "naming", fact: `Rule: Nick calls it "${right}", not "${wrong}"` } : undefined;
    }
    const stop = s.match(/^(?:(?:please|pls)\s+)?(?:stop|quit|don'?t|dont|do not|never)\s+call(?:ing)?\s+(?!me\b|him\b|her\b)(it|that|this|them)\s+(.+?)(?:[,;]?\s+(?:it'?s|its|it is|they'?re|call it|just call it)\s+(.+))?$/i);
    if (!stop)
        return undefined;
    const wrong = name(stop[2]);
    const right = stop[3] ? name(stop[3]) : undefined;
    if (!wrong || (stop[3] && !right))
        return undefined;
    return { kind: "naming", fact: `Rule: Nick wants ORION not to call it "${wrong}"${right ? `; Nick calls it "${right}"` : ""}` };
}
function meaning(s) {
    const a = s.match(/^(?:when i say|by) (.+?),? i (?:mean|meant) (.+)$/i);
    const b = a ? null : s.match(/^i (?:mean|meant) (.+?),? (?:when i say|when i said|by) (.+)$/i);
    const [said, meant] = a ? [a[1], a[2]] : b ? [b[2], b[1]] : [undefined, undefined];
    const x = name(said);
    const y = name(meant);
    return x && y && x.toLowerCase() !== y.toLowerCase() ? { kind: "meaning", fact: `Rule: when Nick says "${x}" he means ${y}` } : undefined;
}
/** The offer's own verb in his "dont …": "move" in "want me to move your study block?" (stems, so "moving" finds it). */
const usesOfferVerb = (verb, offered) => !!offered && new RegExp(`\\b${verb.replace(/[- ]/g, "[- ]?").replace(/(?:ing|e)$/, "")}`, "i").test(offered);
function standing(s, o) {
    const m = s.match(STANDING);
    if (!m)
        return undefined;
    const [, neg, ever, verb, restRaw] = m;
    const rest = trimEnd(restRaw.replace(TAIL, ""));
    const object = rest.replace(/\s+(?:again|anymore|ever)\b.*$/i, "").trim();
    if (!rest || PRONOUN.test(object) || /^(?:it|that|this|them)\b/i.test(object) || ONE_OFF.test(rest))
        return undefined;
    const v = verb.toLowerCase();
    const qualified = QUALIFIED.test(rest);
    // A plain "dont": one-off unless it says it lasts, or is general and not just the answer to ORION's pending offer.
    if (/^(?:don'?t|dont|do not)$/i.test(neg) && !ever && !o.explicit && !EXPLICIT.test(restRaw)) {
        if (usesOfferVerb(v, o.offered) || !(qualified || GENERAL.test(rest)))
            return undefined;
    }
    if (new RegExp(`^(?:${ADD_VERB})$`).test(v) && ANCHOR.test(rest) && !qualified)
        return undefined; // "dont schedule gym"
    if (new RegExp(`^(?:${CONTACT_VERB})$`).test(v) && !qualified)
        return undefined; // "stop texting me" silences check-ins
    if (/^call/.test(v))
        return undefined; // naming() or preference-remember
    const never = /^never$/i.test(neg) || !!ever;
    const stop = /^(?:stop|quit)$/i.test(neg) && !ever;
    const said = `${v} ${swap(rest)}`;
    return { kind: "standing", fact: `Rule: Nick wants ORION ${stop ? "to stop" : never ? "never to" : "not to"} ${said}` };
}
/** A correction he means to last, or undefined. `offered` is what ORION just proposed (its last push or offer), if any. Pure. */
export function readCorrection(message, o = {}) {
    const raw = tidy(message);
    if (!raw || raw.length > MAX_SAID || /\?\s*$/.test(raw))
        return undefined;
    const low = raw.toLowerCase();
    if (isCrisis(low) || touchesLifeOrDeath(low) || INJECTION.test(raw))
        return undefined;
    const led = raw.replace(LEAD, "");
    const told = led.replace(TOLD, "");
    const corrected = led !== raw || told !== led;
    const lasting = trimEnd(told);
    const explicit = FROM_NOW.test(lasting);
    const s = trimEnd(lasting.replace(FROM_NOW, "").replace(LEAD, ""));
    const found = naming(s) ?? meaning(s) ?? standing(s, { ...(o.offered ? { offered: o.offered } : {}), explicit });
    if (found)
        return found.fact.length <= MAX_FACT ? found : undefined;
    if (!corrected)
        return undefined; // a plain "i prefer …" is preference-remember's, on its own path
    const pref = readPreference(s);
    return pref && !pref.refuse && pref.fact ? { kind: "restated", fact: `Preference: ${pref.fact}` } : undefined;
}
const LEARNED = /^- \d{4}-\d{2}-\d{2} [—–-] (?:Preference|Rule): (.+?)\.?\s*$/;
/** Learned preferences and rules in USER.md (one-line dated bullets), newest first, deduplicated. Pure. */
export function learnedRules(userMd, max = 6) {
    if (!userMd)
        return [];
    const lines = userMd.split("\n");
    const found = lines.flatMap((l, i) => { const m = l.match(LEARNED); return m && !/^\s+\S/.test(lines[i + 1] ?? "") ? [m[1].trim()] : []; });
    return [...new Set(found.reverse())].slice(0, max);
}
/** The state-card line for them ("" when there are none or USER.md is unreadable). Never throws. */
export function standingRulesLine(userMdPath, maxChars = 600) {
    if (!userMdPath)
        return "";
    let text = null;
    try {
        text = readFileSync(userMdPath, "utf8");
    }
    catch {
        return "";
    }
    const rules = learnedRules(text);
    if (!rules.length)
        return "";
    const line = `\n- Standing rules and preferences he gave you (follow them): ${rules.join("; ")}`;
    return line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line;
}
/** True while an evaluation holds the eval-mode marker in this state dir (under two hours old, as scripts/lib/eval-mode.mjs). */
export function inEvaluation(stateDir, now = Date.now()) {
    if (!stateDir)
        return false;
    try {
        return now - statSync(join(stateDir, "eval-mode")).mtimeMs < 2 * 3600_000;
    }
    catch {
        return false;
    }
}
/*
 Session keys that are not Nick talking (fixer, 2026-11-02, from the keys the repo uses): cron and standing jobs, heartbeats,
 doctors, tests and evals (orion-eval-sched-*), gates (gate31, orion-gate-selftest), subagents, missions (orion-mission:
 agent:main:mission-<id>), claude checks (claude-check-*, usage.mjs counts them as checks), probes, benches, the V3 pipeline
 (orion-v3-pipe-*), live sweeps (orion-chat-sweep-*), smoke and canary runs. Matched as a whole segment word, so a uuid never trips it.
*/
const NOT_NICK = /(?:^|[:_.-])(?:cron|heartbeat|doctor|tests?|subagent|evals?|gates?|mission|missions|claude|probes?|bench|benchmark|sweeps?|v3-pipe|pipeline|standing|selftest|smoke|canary)(?=$|[:_.\-\d])/i;
/** True when a session key is Nick's own chat (or unknown): never a job, check, mission, sweep or evaluation. */
export const isNickSession = (sessionKey) => !NOT_NICK.test(sessionKey ?? "");
/** What ORION has just proposed, as words to compare a "dont …" against: the app's label, the last push (2 h), a held own offer, a memo. */
export function pendingOffer(o) {
    let push;
    if (o.stateDir) {
        try {
            const last = readLastOutreach(o.stateDir, o.now);
            if (last && o.now.getTime() - Date.parse(last.at) < 2 * 3600_000)
                push = last.text;
        }
        catch {
            push = undefined;
        }
    }
    const memo = o.memo?.kind === "move-offer" ? `move ${o.memo.title ?? ""}` : o.memo?.kind === "booked" ? `book ${o.memo.title ?? ""}` : undefined;
    const parts = [o.label, push, o.held ? "move shorten drop cancel" : undefined, memo].filter((p) => !!p && !!p.trim());
    return parts.length ? parts.join(" | ") : undefined;
}
const readOr = (path) => { if (!path)
    return null; try {
    return readFileSync(path, "utf8");
}
catch {
    return null;
} };
/** Reads the message and, if it is a lasting correction, keeps it (capped, never twice). Never throws; reports what happened. */
export async function learnCorrection(message, o) {
    if (!isNickSession(o.sessionKey) || inEvaluation(o.stateDir))
        return "skipped";
    const c = readCorrection(message, o.offered ? { offered: o.offered } : {});
    if (!c)
        return "skipped";
    if (hasRule(readOr(o.userMdPath), c.fact))
        return "already";
    try {
        const out = await o.run(["--user", `${c.fact}.`]);
        if (out.code !== 0)
            return "failed";
        if (/already remembered/i.test(out.stdout))
            return "already";
        if (!/\bremembered\b/i.test(out.stdout))
            return "failed";
        if (o.userMdPath)
            enforceRuleCap(o.userMdPath, o.stateDir);
        return "saved";
    }
    catch {
        return "failed";
    }
}
