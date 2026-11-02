/*
 Nick teaching ORION about his mail, in chat (wave 14, 2026-11-02): "over time i can tell him things arent important and certain things
 are so he knows what to look out for". Code's, before the front desk and every other flow (like questions-flow.ts):

   mute   "not important" / "dont care about these" / "stop telling me about linkedin" / "ignore emails from barclays"
   boost  "this matters" / "always tell me when prof smith emails" / "anything from my landlord is important"

 A bare reply ("not important", "this matters") is about the mail alert that is still the last thing ORION sent (mail-alerts.ts), and
 becomes one rule per mail it named: a person's address, or an automated sender's domain. A reply that names something ("stop telling
 me about job alerts") is taken when it talks about mail, or when what it names is in that alert; anything else ("stop telling me about
 the gym") is left to the other flows. Every write goes through scripts/orion-mail-prefs (fixed argument lists, no shell); every reply
 is built from what it said.
*/
import { execFile } from "node:child_process";
import { scriptPath } from "./tool-guards.js";
import { currentMailAlert, mailAlertsFile, readMailAlerts } from "./mail-alerts.js";
const low = (s) => s.toLowerCase().replace(/[’]/g, "'").replace(/'/g, "").replace(/\s+/g, " ").trim();
const MAIL_WORD = /\b(?:e-?mails?|mails?|emailed|emailing|inbox|newsletters?|gmail)\b/;
const FILLER = /\b(?:anymore|any more|pls|please|plz|lol|lmao|tho|though|ok|okay|thx|thanks|ty|rn|tbh|ever|again|its|from now on)\b/g;
const low2 = (s) => s.replace(/\brly\b/g, "really").replace(/\b(?:u|ya)\b/g, "you").replace(/\blmk\b/g, "let me know");
const TELL = "(?:tell|let|alert|ping|notify|flag|text|show|warn|bug|message|send)(?: me)?(?: know)?";
// Bare replies, about the alert itself.
const BARE_MUTE = /^(?:(?:nah|naw|no|nope|meh|eh+|ugh|bro|honestly|tbh|yeah|ya|ok)[, ]+)*(?:(?:thats|that|this|its|these|those|they|them|it|both|that one|this one)(?: (?:is|are|were|was))? )?(?:(?:really|honestly|kinda|totally|so|def|definitely|not that|not really) )?(?:not (?:that |really |very |super )?(?:important|urgent|relevant|a big deal|a priority|needed|useful|something i care about)|(?:isnt|arent|wasnt|werent|aint) (?:that |really |very |super )?(?:important|urgent|relevant|a big deal|needed|useful)|unimportant|irrelevant|useless|spam|junk|who cares|idc|i (?:really )?dont (?:really )?care(?: about (?:these|those|this|that|them|it))?|dont (?:really )?care(?: about (?:these|those|this|that|them|it))?|dont need (?:to know about )?(?:these|those|this|that|them|it)|no need(?: to tell me)?|not worth (?:it|telling me|flagging)|dont bother(?: me with (?:these|those|this|that|them))?)\b[\s.!]*(?:lol|lmao|tbh|honestly|tho|thx)?[\s.!]*$/;
const BARE_BOOST = /^(?:(?:yes|yeah|yea|yep|ok|okay|oh|ooh|wait|damn|ty|thanks|thx|oh shit|good)[, ]+)*(?:(?:this|that|thats|these|those|it|they)(?: (?:one|ones))?(?: (?:is|are|was|were))? (?:(?:really|actually|super|very|def|definitely|so) )?(?:important|matters?|urgent|useful|good to know|a big deal)|(?:this|that|these|those|they|it)(?: one| ones)? (?:(?:actually|really|def|definitely) )?(?:does |do )?(?:matters?|count)|keep (?:em|them|these|those) coming|(?:good|nice) (?:catch|call|flag)|more (?:of these|like this)|always (?:tell|flag|show) me (?:these|those|this|that)(?: ones?)?)\b[\s.!]*(?:ty|thx|thanks|lol)?[\s.!]*$/;
// Replies that name something.
const NAMED_MUTE = [
    /\b(?:stop|quit|no more) (?:telling|alerting|pinging|notifying|flagging|bugging|sending|messaging|texting|showing)(?: me)? (?:about |abt |re |with |on )?(.{2,60})$/,
    new RegExp(`\\b(?:dont|do not|no need to|never) ${TELL} (?:about |abt |re |when |if )?(.{2,60})$`),
    /\b(?:dont|do not) (?:need|want) (?:any )?(?:more )?(?:e-?mails?|mails?|alerts?|updates?|notifications?) (?:from|about|abt) (.{2,60})$/,
    /\b(?:ignore|mute|skip|filter out|forget about) (?:all )?(?:the )?(?:e-?mails?|mails?|anything|stuff|messages) (?:from|by|about) (.{2,60})$/,
    /\b(?:ignore|mute) (.{2,60}?)(?: e-?mails?| mails?)?$/,
    /\bi (?:really )?(?:dont|do not) (?:really )?care (?:about|abt) (?:e-?mails? (?:from|about) )?(.{2,60})$/,
    /\bidc (?:about|abt) (?:e-?mails? (?:from|about) )?(.{2,60})$/,
    /^(.{2,40}?) (?:e-?mails?|mails?|stuff|ones) (?:are|is|r) (?:not|never) (?:important|urgent|relevant)\b/,
    /^(.{2,40}?) (?:e-?mails?|mails?|stuff|ones) (?:arent|isnt|dont matter|never matter)\b/,
];
const NAMED_BOOST = [
    new RegExp(`\\b(?:always|definitely|def|make sure (?:you|to)(?: always)?|pls|please)? ?${TELL} (?:me )?(?:whenever|when|if|anytime|any time|every time) (.{2,60}?) (?:e-?mails?|mails?|writes|messages|reaches out|sends? (?:me )?(?:something|anything|an e-?mail))(?: me)?\\b`),
    /\b(?:anything|everything|any e-?mails?|e-?mails?|mails?) (?:from|by) (.{2,60}?) (?:is|are|r) (?:always )?(?:important|urgent|a priority)\b/,
    /\b(?:always|definitely) (?:tell|flag|show|alert) me (?:about )?(?:e-?mails? (?:from|about) )?(.{2,60})$/,
    /\bkeep (?:telling|flagging|alerting) me (?:about )?(?:e-?mails? (?:from|about) )?(.{2,60})$/,
    /^(.{2,40}?) (?:e-?mails?|mails?) (?:are|is|r) (?:always )?(?:important|urgent|a priority)\b/,
    /\bi (?:always |really )?care about (?:e-?mails? (?:from|about) )?(.{2,60})$/,
];
/** "from X", or "when X emails": what he named is who sends it, not what it is about. */
const aboutSender = (said) => /\b(?:from|by)\b/.test(said) || (/\b(?:when(?:ever)?|if|anytime|any time|every time)\b/.test(said) && /\b(?:e-?mails?|mails?|writes|messages|reaches out|sends?)\b/.test(said));
const ADDRESS = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/;
const DOMAIN = /^@?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
const STOP = new Set(["the", "my", "a", "an", "these", "those", "this", "that", "them", "it", "all", "any", "about", "from", "emails", "email", "mail", "mails", "stuff", "ones"]);
const words = (s) => low(s).split(/[^a-z0-9@.]+/).filter((w) => w.length > 1 && !STOP.has(w));
/** Cleans what he named: no filler, no "the"/"emails", no trailing punctuation. */
function cleanTarget(raw) {
    return low(raw).replace(FILLER, " ").replace(/\b(?:e-?mails?|mails?|stuff|ones|notifications?|alerts? from)\b/g, " ")
        .replace(/^(?:\s*(?:the|my|all|any|those|these|them|that|this|from|about)\b)+/g, " ").replace(/[!?,]+/g, " ").replace(/\.+(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
}
const itemRule = (action, i) => i.person || !i.domain ? { action, kind: "sender", value: i.fromAddress, label: i.who } : { action, kind: "domain", value: i.domain, label: i.who };
/** The item of the current alert that what he named points at (its sender's name or brand, or its topic). */
function itemNamed(target, alert) {
    const want = words(target);
    if (!alert || !want.length)
        return undefined;
    return alert.items.find((i) => {
        const have = [...words(i.who), ...words(i.domain.split(".")[0] ?? ""), ...words(i.fromAddress.split("@")[0] ?? "")];
        return want.every((w) => have.some((h) => h.startsWith(w) || w.startsWith(h)));
    });
}
function namedRule(action, target, alert, bySender) {
    if (ADDRESS.test(target))
        return { action, kind: "sender", value: target, label: target };
    if (DOMAIN.test(target))
        return { action, kind: "domain", value: target.replace(/^@/, ""), label: target };
    const item = itemNamed(target, alert);
    if (item)
        return itemRule(action, item);
    if (target.length < 2 || target.split(" ").length > 6)
        return undefined;
    return { action, kind: bySender ? "sender" : "topic", value: target, label: target };
}
/** What this message teaches about his mail, if anything. Reads only. */
export function readMailMove(message, ctx) {
    const m = low2(low(message));
    if (!m || m.length > 200)
        return undefined;
    const alerts = ctx.alerts ?? readMailAlerts(mailAlertsFile(ctx.stateDir));
    const alert = currentMailAlert(alerts, ctx.now, { ...(ctx.label !== undefined ? { label: ctx.label } : {}), lastPush: ctx.lastPush ?? null });
    for (const [action, bare] of [["mute", BARE_MUTE], ["boost", BARE_BOOST]]) {
        if (alert && bare.test(m))
            return { kind: "rules", action, rules: alert.items.slice(0, 3).map((i) => itemRule(action, i)) };
    }
    for (const [action, patterns] of [["mute", NAMED_MUTE], ["boost", NAMED_BOOST]]) {
        for (const p of patterns) {
            const hit = m.match(p);
            if (!hit?.[1])
                continue;
            const target = cleanTarget(hit[1]);
            const named = namedRule(action, target, alert, aboutSender(hit[0]));
            if (!named)
                continue;
            // "my landlord" is "your landlord" when ORION says it back.
            const rule = named.label === target && /^\s*my\s/.test(hit[1]) ? { ...named, label: `your ${target}` } : named;
            const aboutMail = MAIL_WORD.test(m) || (!!alert && !!itemNamed(target, alert));
            if (aboutMail || ADDRESS.test(target) || DOMAIN.test(target))
                return { kind: "rules", action, rules: [rule] };
        }
    }
    return undefined;
}
async function call(run, args, log) {
    const out = await run(args).catch(() => ({ stdout: "", code: 1 }));
    log.calls.push(`exec orion-mail-prefs ${args.map((a) => JSON.stringify(a)).join(" ")}`);
    log.outputs.push(out.stdout);
    if (out.code !== 0)
        return undefined;
    try {
        return JSON.parse(out.stdout.trim().split("\n").at(-1) ?? "");
    }
    catch {
        return undefined;
    }
}
const titled = (s) => (/[A-Z]/.test(s) || /^your\s/.test(s) || s.includes("@") ? s : s.replace(/\b[a-z]/g, (c) => c.toUpperCase()));
const listOf = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
/** "Got it, I won't flag mail from Barclays anymore." from what orion-mail-prefs saved. */
function saidText(action, saved) {
    const senders = saved.filter((r) => r.kind !== "topic").map((r) => titled(r.label));
    const topics = saved.filter((r) => r.kind === "topic").map((r) => r.label);
    const parts = [senders.length ? `mail from ${listOf(senders)}` : "", topics.length ? `mail about ${listOf(topics)}` : ""].filter(Boolean).join(" or ");
    if (action === "mute")
        return `Got it, I won't flag ${parts} anymore.`;
    const who = [senders.length ? `${listOf(senders)} emails` : "", topics.length ? `anything about ${listOf(topics)} comes in` : ""].filter(Boolean).join(" or ");
    return `Got it, I'll always tell you when ${who}.`;
}
/** Saves the rules through orion-mail-prefs and says what was saved, from its answers. */
export async function runMailMove(move, run) {
    const log = { text: "", calls: [], outputs: [] };
    const saved = [];
    for (const r of move.rules) {
        const out = await call(run, ["add", r.action, r.kind, r.value, "--via", "chat", "--json"], log);
        if (out?.ok)
            saved.push(r);
    }
    if (!saved.length)
        return { ...log, text: "I couldn't save that just now, so I'll keep going by my own guess for these. Try again in a moment." };
    const missed = move.rules.length - saved.length;
    return { ...log, text: `${saidText(move.action, saved)}${missed ? ` (${missed} didn't save, so I may still flag ${missed === 1 ? "that one" : "those"}.)` : ""}` };
}
/** The real script (no shell, fixed argument lists), with ORION's state dir. Wired in by local-routing.ts. */
export const liveMailPrefsRun = (stateDir) => (args) => new Promise((resolve) => execFile(scriptPath("orion-mail-prefs"), args, { timeout: 15000, maxBuffer: 1 << 20, env: { ...process.env, ...(stateDir ? { ORION_CONTROLLED_DIR: stateDir } : {}) } }, (e, stdout) => resolve({ stdout: String(stdout ?? ""), code: e ? 1 : 0 })));
