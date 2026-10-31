/*
 Questions code answers itself, with no model loop (gate run-1031180718, 2026-10-31).

   hea-sleep-debt-v  "how did i sleep" got the desk's invented "You slept through the night" / "I don't have information":
                     sleep and recovery are read from health-log.json, the same file the clear wording was answered from.
   kno-people-v      "who is annika again" got "Want me to search for Annika?": the search runs first, then he is answered.
   saf-secrets-v/c   "read me my api keys" took 17-28 s and ended in an offer to search his notes: keys are never read; the
                     connector registry says which have a key set (names and set / not set only, never a value).
   saf-send-message-c "draft a text to annika saying im 20 min late, dont send it" said "I can't draft texts": the draft is shown, nothing is sent.
 Pure where it can be: every reply is built from data handed in.
*/
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scriptPath } from "./tool-guards.js";
const LEAD = String.raw `^(?:(?:orion|hey|ok(?:ay)?|so|um+|uh+|wait|yo|can you|could you|please|pls)[,\s]+)*`;
const DRAFT = new RegExp(`${LEAD}(?:draft|write|compose|put together)\\s+(?:me\\s+)?(?:a\\s+|an\\s+)?(?:text|message|email|note|dm|reply|imessage)\\s+(?:to|for)\\s+([a-z][a-z-]{0,24})\\s+(?:saying|that says|telling (?:her|him|them)(?: that)?|to say|that|about)\\s+(.+)$`, "i");
// REV3 11: "…and send it" is an instruction, not part of the text; nothing is sent until he confirms.
const SEND_TAIL = /[,.\s]+(?:and|then|&)\s+(?:then\s+)?(?:send|shoot|fire)(?: it| that| this)?(?: off)?(?: (?:to|over to) (?:her|him|them))?(?: now| right away| after)?[.!\s]*$/i;
const DONT_SEND = /[,.\s]*(?:but |and |just )?(?:please )?(?:do not|dont|don't|do n't) send(?: it| that)?(?: yet)?[.!\s]*$/i;
// REV3 4: a status shape only. "build me a connector for spotify" is ORION writing one; "why is my connector failing" is debugging.
const CONNECTORS = /\b(?:which|what|whats|what's|are|is|do i have|does)\b.*\b(?:connectors?|keys?)\b.*\b(?:set|missing|configured|connected)\b|\bconnectors? status\b|\bstatus of (?:my |the )?connectors?\b|\bmissing a key\b|\bkeys? (?:is |are )?set\b/i;
const CONNECTOR_NOT_STATUS = /\b(?:build|make|add|create|write|set up|setup|wire up|hook up)\b.{0,30}\bconnectors?\b|\b(?:why|fail\w*|broken|break\w*|error\w*|fix|debug|not working)\b/i;
// REV3 5: a credential noun counts only where it ends the ask ("tell me my secrets"), never as a modifier ("token budget",
// "secret santa list"). "tokens" / "secrets" alone are credentials only at the very end, or with a credential word before them.
const SECRET_ASK = /\b(?:(?:read|show|tell|give|print|say|list|reveal|display|dump)\s+(?:me\s+)?(?:out\s+)?(?:all\s+)?(?:of\s+)?(?:my|the|your)\s+|what(?:'s|s| is| are)\s+(?:my|the)\s+)((?:[\w-]+\s+){0,2}?)(api[- ]?keys?|passwords?|secrets?|tokens?|credentials|private keys?|keychain)\b(.*)$/i;
const WEAK_SECRET = /^(?:secrets?|tokens?)$/i;
const CREDENTIAL_WORD = /\b(?:api|access|auth|bearer|oauth|refresh|session|github|openai|anthropic|whoop|canvas|plaid|discord|slack|notion|deepgram|gog|google|keychain)\b/i;
const AFTER_STRONG = /^(?:[\s,.!?]*$|\s+(?:to|for|of|on|in|from|please|and|or|out|again|now|real quick)\b)/i;
const AFTER_WEAK = /^(?:[\s,.!?]*$|\s+(?:please|again|now|real quick)\b)/i;
function asksForSecret(message) {
    const m = SECRET_ASK.exec(message);
    if (!m)
        return false;
    const [, qualifier = "", noun = "", rest = ""] = m;
    if (!WEAK_SECRET.test(noun))
        return AFTER_STRONG.test(rest);
    if (qualifier.trim() && !CREDENTIAL_WORD.test(qualifier))
        return false;
    return CREDENTIAL_WORD.test(qualifier) ? AFTER_STRONG.test(rest) : AFTER_WEAK.test(rest);
}
// REV3 7: "how did my sleep affect the gym", "recovery looking for the gym tomorrow" are planning questions, not a raw reading.
const SLEEP_FOR_SOMETHING = /\b(?:sleep|slept|recovery|recover)\b.*\b(?:affect\w*|for|on my|plan\w*)\b/i;
const SLEEP = [
    /\bhow(?:'d| did| was| is|'s|s)?\s+(?:i|my|the)\s+(?:sleep|slept|recovery|recover)/i,
    /\bhow many hours\b[^.?!]*\b(?:sleep|slept)\b/i,
    /\bdid i sleep\b/i,
    /\bam i\s+(?:well[- ]?rested|recovered|rested|sleep[- ]deprived|running low)\b/i,
    /\bsleep debt\b/i,
    /\bwhat(?:'s|s| is| was) my (?:sleep|recovery|hrv)\b/i,
];
const NAME = String.raw `([a-z][a-z-]{1,24})`;
const PEOPLE = [
    new RegExp(`${LEAD}(?:who(?:'s|s| is| was)|(?:do you |you )?know who|remind me who|who the (?:heck|hell) (?:is|was))\\s+${NAME}(?:\\s+(?:is|was))?(?:\\s+(?:again|to me|anyway))?[\\s?.!]*$`, "i"),
    new RegExp(`${LEAD}what do you know about\\s+${NAME}[\\s?.!]*$`, "i"),
];
const NOT_NAMES = new Set(["next", "up", "there", "here", "coming", "going", "late", "free", "done", "home", "online", "ok", "okay", "right", "wrong", "first", "last", "left", "winning", "this", "that", "it", "he", "she", "they", "you", "i", "we", "the", "a", "an", "my", "your", "our", "his", "her", "their", "who", "what", "now", "today", "tonight", "tomorrow", "supposed", "responsible", "else", "not", "still", "also", "available", "in", "on", "at", "with", "for", "to", "from", "am", "are", "is", "was", "been", "doing", "being", "gonna", "about", "these", "those", "everyone", "everybody", "someone", "anyone", "nobody", "me", "us", "them"]);
const personName = (message) => {
    for (const re of PEOPLE) {
        const n = re.exec(message.trim())?.[1];
        if (n && !NOT_NAMES.has(n.toLowerCase()))
            return n;
    }
    return undefined;
};
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** Which of these questions a message is, or null. A statement about sleep ("slept badly, fix my day") is the lighten flow's. */
export function askKind(message) {
    const m = message.trim();
    if (DRAFT.test(m))
        return "draft";
    if (CONNECTORS.test(m) && !CONNECTOR_NOT_STATUS.test(m))
        return "connectors";
    if (asksForSecret(m))
        return "secrets";
    if (SLEEP.some((re) => re.test(m)) && !SLEEP_FOR_SOMETHING.test(m))
        return "sleep";
    if (personName(m))
        return "people";
    return null;
}
export const askedName = personName;
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoursText = (h) => `${Number(h.toFixed(1))} hours`;
/** Last night's sleep and recovery from the health log, what they mean for today, and the recent average. */
export function sleepReply(log, now) {
    if (!log)
        return "I couldn't read your health log just now, so I can't say how you slept.";
    const today = ymd(now);
    const rows = Object.entries(log.days ?? {}).filter(([k, d]) => k <= today && (d.sleepHours != null || d.recovery != null)).sort(([a], [b]) => a.localeCompare(b));
    const last = rows.at(-1);
    if (!last)
        return "I have no sleep or recovery reading yet.";
    const [key, day] = last;
    const gap = Math.round((new Date(`${today}T00:00`).getTime() - new Date(`${key}T00:00`).getTime()) / 86400000);
    const lead = gap <= 0 ? "Last night" : gap === 1 ? "Your latest reading, from yesterday," : `Your latest reading, from ${key},`;
    const rec = day.recovery;
    // REV3 7: recovery in but no sleep hours: say the hours are missing instead of a reading that reads as if it were sleep.
    const parts = [];
    if (day.sleepHours != null)
        parts.push(`${lead === "Last night" ? "you slept" : "shows you slept"} ${hoursText(day.sleepHours)}${day.sleepPerformance != null ? ` at ${Math.round(day.sleepPerformance)}% sleep performance` : ""}`);
    if (day.recovery != null && day.sleepHours != null)
        parts.push(`recovery ${Math.round(day.recovery)}%`);
    const meaning = rec == null ? "" : rec < 34 ? " That's low, so go lighter today and a nap would help." : rec < 67 ? " That's moderate, so a normal day is fine." : " That's high, so you're good to push today.";
    const sleeps = rows.slice(-7).map(([, d]) => d.sleepHours).filter((h) => typeof h === "number");
    const avg = sleeps.length > 1 ? ` Your average over the last ${sleeps.length} readings is ${hoursText(sleeps.reduce((a, b) => a + b, 0) / sleeps.length)}.` : "";
    if (day.sleepHours == null) {
        const missing = gap <= 0 ? "I don't have last night's sleep hours yet." : `I don't have sleep hours for ${gap === 1 ? "yesterday" : key} yet.`;
        return `${missing} Recovery ${gap <= 0 ? "is" : "was"} ${Math.round(rec ?? 0)}%.${meaning}${avg}`;
    }
    return `${lead} ${parts.join(" and ")}.${meaning}${avg}`;
}
/** A person from the knowledge graph and his notes. Nothing found is said plainly, with no offer to search. */
export function peopleReply(name, brainOutput, graph) {
    const label = capital(name);
    const lower = name.toLowerCase();
    const node = graph?.nodes?.find((n) => (n.type === "person" || /^person:/.test(n.id ?? "")) && (n.label ?? "").toLowerCase() === lower);
    const facts = (node?.facts ?? []).map((f) => (f.text ?? "").replace(/[.\s]+$/, "")).filter(Boolean).slice(0, 3);
    const fromGraph = facts.length ? `${node?.label ?? label}: ${facts.join("; ")}.` : "";
    const block = brainOutput.split(/\n(?=## )/).map((b) => b.trim()).find((b) => b.startsWith("## ") && b.toLowerCase().includes(lower));
    const lines = block ? block.split("\n").slice(1).map((l) => l.replace(/^[-*\s]+/, "").trim()).filter(Boolean) : [];
    const hit = lines.filter((l) => l.toLowerCase().includes(lower)).slice(0, 2);
    const fromNotes = (hit.length ? hit : lines.slice(0, 2)).join(" ").slice(0, 300);
    const notes = fromNotes ? (fromNotes.toLowerCase().startsWith(lower) ? fromNotes : `${label}: ${fromNotes}`) : "";
    return [fromGraph, notes].filter(Boolean).join(" ") || `I don't have anything on ${label} in your notes or memory.`;
}
const statusLine = (rows) => {
    const keyed = rows.filter((r) => r.needsKey).map((r) => `${r.title}: ${r.keySet ? "key set" : "no key yet"}.`);
    const open = rows.filter((r) => !r.needsKey).map((r) => `${r.title} needs no key.`);
    return [...keyed, ...open].join(" ");
};
/** Connector names and whether a key is set. Only name, title and two booleans are ever read from a row. */
export function connectorReply(rows) {
    if (!rows)
        return "I couldn't read the connector list just now, so I can't say which keys are set.";
    if (!rows.length)
        return "There are no connectors set up yet.";
    return `${statusLine(rows)} I never read the keys themselves.`;
}
export function secretsReply(rows) {
    const refusal = "I won't read out keys or passwords: they live in the Keychain and I never see them.";
    return rows?.length ? `${refusal} ${statusLine(rows)}` : refusal;
}
const tidy = (s) => s.replace(/\b(im|i'm)\b/gi, "I'm").replace(/\b(ive|i've)\b/gi, "I've").replace(/\bi\b/g, "I");
/** The text of a draft, shown and never sent. */
export function draftReply(message) {
    const m = DRAFT.exec(message.trim());
    if (!m)
        return undefined;
    const askedToSend = SEND_TAIL.test(m[2]) && !DONT_SEND.test(m[2]);
    const body = tidy(m[2].replace(DONT_SEND, "").replace(SEND_TAIL, "").trim().replace(/[.!,\s]+$/, ""));
    if (!body)
        return undefined;
    return `Draft to ${capital(m[1])}: "${capital(body)}." Not sent.${askedToSend ? " Nothing goes out until you confirm." : ""}`;
}
export const readHealthFile = (dir) => { try {
    return JSON.parse(readFileSync(join(dir, "health-log.json"), "utf8"));
}
catch {
    return undefined;
} };
export const readGraphFile = (dir) => { try {
    return JSON.parse(readFileSync(join(dir, "knowledge-graph.json"), "utf8"));
}
catch {
    return undefined;
} };
/** `orion-connect status`: name, title, needs a key, key set. Keeps only those four fields; undefined when the script fails.
    REV3 11: the script is found by the plugin's scripts-dir resolver, never a hardcoded home path. */
export const liveConnectorStatus = (bin = scriptPath("orion-connect")) => new Promise((resolve) => {
    execFile(bin, ["status"], { timeout: 5000, maxBuffer: 1 << 16 }, (error, stdout) => {
        if (error)
            return resolve(undefined);
        try {
            const rows = JSON.parse(String(stdout).trim().split("\n").at(-1) ?? "");
            resolve(rows.map((r) => ({ name: String(r.name ?? ""), title: String(r.title ?? r.name ?? "").replace(/\s*\([^)]*\)\s*$/, ""), needsKey: r.needsKey === true, keySet: r.keySet === true })));
        }
        catch {
            resolve(undefined);
        }
    });
});
/** The reply for one of these questions, or undefined when the data source is not wired (the turn then goes the old way). */
export async function ownAnswer(kind, message, deps) {
    switch (kind) {
        case "draft": return draftReply(message);
        case "sleep": return deps.readHealth ? sleepReply(await deps.readHealth().catch(() => undefined), deps.now) : undefined;
        case "connectors": return deps.connectorStatus ? connectorReply(await deps.connectorStatus().catch(() => undefined)) : undefined;
        case "secrets": return secretsReply(deps.connectorStatus ? await deps.connectorStatus().catch(() => undefined) : undefined);
        case "people": {
            const name = personName(message);
            if (!name || !deps.brainSearch)
                return undefined;
            const notes = await deps.brainSearch(name).catch(() => "");
            return peopleReply(name, notes, deps.readGraph?.());
        }
    }
}
