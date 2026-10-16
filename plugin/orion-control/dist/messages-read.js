/*
 Plain reads of his texts and Gmail, run by code (sweep r8, q066 + q069, 2026-10-16).

 "read my last 3 texts" got the worker's "I'm reading your last three texts now." and "search gmail for the
 internship offer" got "I'm searching your Gmail for the internship offer." — no tool ran in either. A read
 request that names no send is one fixed, read-only command, so code runs it (scripts/orion-messages recent|from|
 search, scripts/orion-gmail-search) and hands the worker the result with "do not call tools"; a failure
 (Full Disk Access, Gmail not signed in) or an empty result is said exactly by code. Nothing here sends.
*/
import { execFile } from "node:child_process";
import { cannotSend } from "./messages-route.js";
const SCRIPTS = "/Users/nickmadaio/Desktop/ORION/scripts";
export const ORION_MESSAGES = `${SCRIPTS}/orion-messages`;
export const ORION_GMAIL_SEARCH = `${SCRIPTS}/orion-gmail-search`;
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, couple: 2, few: 3 };
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 15;
const READ_VERB = /\b(read|search|find|look for|show|check|see|did|has|list|get|pull up|open|tell me|summari[sz]e|look at)\b/i;
const SENDS = /^(?:\W*(?:hey|ok(?:ay)?|so|please|pls|orion|can you|could you|would you)[,\s]+)*(?:text|imessage|message|send|e-?mail|reply|respond)\b/i;
// Weak read verbs count only when a texts word follows ("any new texts", "what messages do i have").
const WEAK_READ = new RegExp(String.raw `\b(?:have|any|what|whats|what's)\b.*\b${"(?:texts?|text messages?|imessages?|messages?)"}\b`, "i");
// M5 (2026-10-16 r8 review): a send anywhere voids the read ("check my messages and reply to sam saying yes").
const SEND_ANYWHERE = /\b(?:reply|respond|send|forward|compose|draft)\b|\b(?:text|imessage|message)\s+(?:to\s+)?(?!me\b|from\b|messages?\b|about\b)[a-z]|\bmessage\s+for\s+(?!me\b)|\b(?:and|then)\s+e-?mail\s+(?!me\b)/i;
const MAIL_WORD = /\b(?:g-?mail|e-?mails?|inbox|mail)\b/i;
const TEXT_WORD = String.raw `(?:texts?|text messages?|imessages?|messages?)`;
const count = (word) => {
    if (!word)
        return DEFAULT_LIMIT;
    const n = /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word.toLowerCase()];
    return n && n > 0 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;
};
const limitOf = (m) => {
    const a = m.match(/\b(?:last|latest|recent|newest|past|first)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|couple|few)\b/i)
        ?? m.match(new RegExp(String.raw `\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:(?:most\s+)?(?:recent|latest|new|newest|unread)\s+)?${TEXT_WORD}\b`, "i"));
    return count(a?.[1]);
};
const clean = (s) => s.replace(/^["'“”‘’\s]+|["'“”‘’.!?\s]+$/g, "").replace(/["“”]/g, "").trim();
/** What a plain read of his texts or Gmail asks for, or null (a send, or not a read). */
export function parseMessagesRead(message) {
    const m = message.trim().replace(/\s+/g, " ");
    if (!m || m.length > 160 || SENDS.test(m) || SEND_ANYWHERE.test(m) || cannotSend(m) || /\bto-?dos?\b|\bremind/i.test(m))
        return null;
    // Gmail: "search gmail for the internship offer", "search my email for X".
    const gmail = m.match(/\b(?:search|find|look(?: up)?|check)\b[^.]*?\b(?:g-?mail|e-?mail|inbox|mail)\b[^.]*?\bfor\s+(.+)$/i);
    if (gmail?.[1]) {
        let q = clean(gmail[1]).replace(/^(?:(?:the|any|anything|something|stuff|an|a|my|some)\s+)+/i, "").replace(/^(?:(?:about|regarding)\s+)(?:(?:the|a|an|my)\s+)*/i, "").replace(/^(?:e-?mails?|messages?|mail)\s+(?:about|regarding|on|with)\s+/i, "").replace(/^(?:e-?mails?|messages?|mail)\s+(?=from\b)/i, "");
        const from = q.match(/^from\s+(?:the\s+)?(.+)$/i);
        if (from?.[1])
            q = /\s/.test(from[1]) ? `from:"${from[1]}"` : `from:${from[1]}`;
        return q ? { kind: "gmail", query: q.slice(0, 120) } : null;
    }
    if (MAIL_WORD.test(m))
        return null; // email questions other than a search stay with the worker
    if (!READ_VERB.test(m) && !WEAK_READ.test(m) && !/\b(?:did|has|have)\s+(?:anyone|anybody|someone|somebody)\b/i.test(m))
        return null;
    const search = m.match(new RegExp(String.raw `\b(?:search|find|look for)\s+(?:through\s+)?(?:my\s+)?${TEXT_WORD}\s+(?:for|about|mentioning|with)\s+(.+)$`, "i"));
    if (search?.[1] && clean(search[1]))
        return { kind: "search", text: clean(search[1]).slice(0, 80), limit: limitOf(m) };
    const from = m.match(new RegExp(String.raw `\b${TEXT_WORD}\s+from\s+(.+?)(?:\s+(?:today|yesterday|please|pls))?$`, "i"))
        ?? m.match(/\bwhat did\s+([\w' ]+?)\s+(?:text|message|send)\s+me\b/i);
    if (from?.[1] && clean(from[1]))
        return { kind: "from", person: clean(from[1]).replace(/^my\s+/i, "").slice(0, 60), limit: limitOf(m) };
    if (new RegExp(String.raw `\b${TEXT_WORD}\b`, "i").test(m) || /\b(?:did|has|have)\s+(?:anyone|anybody|someone|somebody)\s+(?:text|message)(?:ed)?\s+me\b/i.test(m))
        return { kind: "recent", limit: limitOf(m) };
    return null;
}
const label = (r) => r.kind === "gmail" ? "Gmail" : "texts";
// review 5 H1 (2026-10-16): `googleapis` / bare `token` no longer mean sign-in (a DNS error names googleapis).
// q069 (2026-10-16 r8b2): raw script output (URLs, oauth text, paths) never reaches Nick; known failures get one short line.
const GMAIL_SIGN_IN = "I can't read your Gmail right now — it needs signing in again.";
const FULL_DISK = "I can't read your texts — ORION needs Full Disk Access.";
export function failureLine(req, out) {
    // Review 6 H-A (2026-10-16): network shapes first — an offline oauth refresh prints "oauth2: cannot fetch token … no such host".
    if (/no such host|dial tcp|network is unreachable|could not resolve|getaddrinfo|ENOTFOUND|offline|timed? ?out|connection refused/i.test(out) && req.kind === "gmail")
        return "I couldn't reach Gmail just now.";
    if (/invalid_grant|not signed in|sign(?:ed)?[ -]?in (?:again|required)|unauthori[sz]ed|credentials/i.test(out) && (req.kind === "gmail" || /invalid_grant/i.test(out)))
        return GMAIL_SIGN_IN;
    if (/full disk access|operation not permitted|authorization denied|not authori[sz]ed to (?:open|read)/i.test(out))
        return FULL_DISK;
    return `I couldn't read your ${label(req)} just now. Nothing was sent or changed.`;
}
/** The command for a read: file + argv only (no shell). */
export function readCommand(r) {
    if (r.kind === "gmail")
        return { file: ORION_GMAIL_SEARCH, args: [r.query], canonical: `exec orion-gmail-search "${r.query}"` };
    const args = r.kind === "recent" ? ["recent", String(r.limit)] : r.kind === "from" ? ["from", r.person, String(r.limit)] : ["search", r.text, String(r.limit)];
    return { file: ORION_MESSAGES, args, canonical: `exec orion-messages ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}` };
}
/** Runs the read. say = code's exact reply (failure or nothing found); data = what the worker summarizes. */
export async function runMessagesRead(req, exec) {
    const { file, args, canonical } = readCommand(req);
    const { stdout, code } = await exec(file, args);
    const out = String(stdout ?? "").trim();
    const base = { calls: [canonical], outputs: [out] };
    if (code !== 0)
        return { ...base, say: failureLine(req, out) };
    if (!out || /^No (?:mail|messages?|texts?)\b/i.test(out)) {
        const what = req.kind === "gmail" ? `Nothing in your Gmail matched "${req.query}".` : req.kind === "from" ? `I found no texts from ${req.person}.` : req.kind === "search" ? `I found no texts mentioning "${req.text}".` : "I found no recent texts.";
        return { ...base, say: what };
    }
    return { ...base, data: out.slice(0, 3500) };
}
/** The worker's instruction for a read code already ran: summarize this and nothing else. */
export function readNote(req, data) {
    if (req.kind === "gmail")
        return `Gmail search for "${req.query}", run just now (read-only):\n${data}\n\nTell Nick what matched in two or three short spoken sentences: each subject and who it is from, and when. Use only these lines. Do not call any tools. If it is not clear which is the one he wants, say what you found and stop.`;
    return `His texts, read just now from Messages (newest first):\n${data}\n\nSummarize them for Nick in two or three short spoken sentences: who each is from, the gist, and when (12-hour times). Use only these lines. Do not call any tools.`;
}
const run = (file, args) => new Promise((resolve) => execFile(file, args, { timeout: 30000, maxBuffer: 4 << 20 }, (error, stdout, stderr) => resolve({
    stdout: error ? `${String(stderr ?? "") || String(stdout ?? "") || error.message}` : String(stdout ?? ""), code: error ? 1 : 0
})));
/** The real read: read-only scripts. Wired in by index.ts only. */
export const liveMessagesRead = (req) => runMessagesRead(req, run);
