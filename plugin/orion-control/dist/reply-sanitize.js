/*
 Raw CLI / tool text never reaches Nick (H4, round 8b2, 2026-10-16; reworked for review 5 H1, 2026-10-16 r8b).
 q069: a reply carried `Get "https://gmail.googleapis.com/…": … oauth2: "invalid_grant" …`.
 q070: a reply ended with "⚠️ 🛠️ Exec failed: `~/Desktop/ORION/scripts/orion-gmail-search …`" (stripExecFailed ran only in
 reply_payload_sending, which never fires on the Mac chat / phone route).
 This runs in before_agent_finalize and the result is put in place; it catches what the worker paraphrased or the host
 appended. Review 5 H1: it removes only the matched span (never a whole line that also holds a real answer), the OAuth /
 permission rules fire only when this run had a FAILED gmail/messages tool result and only on raw error shapes, and the
 generic failure line is returned only when nothing readable survives.
*/
import { stripExecFailed } from "./memory-facts.js";
const GMAIL_SIGN_IN = "I can't read your Gmail right now — it needs signing in again.";
const GMAIL_OFFLINE = "I couldn't reach Gmail just now.";
const GMAIL_OTHER = "I couldn't read your Gmail just now.";
// Review 6 H-A (2026-10-16): an offline Mac prints `Get "https://…": … oauth2: cannot fetch token: … no such host` — that is
// a network failure, not a sign-in. Only invalid_grant means signing in again.
const NETWORK = /no such host|dial tcp|network is unreachable|could not resolve|getaddrinfo|ENOTFOUND|timed? ?out|connection refused/i;
const mailLine = (text) => /invalid_grant/i.test(text) ? GMAIL_SIGN_IN : NETWORK.test(text) ? GMAIL_OFFLINE : GMAIL_OTHER;
// A change claim left standing after a failure tail was cut ("Done. ⚠️ Exec failed: …", review 6 M-B).
const NEGATED = /\b(?:no|nothing|not|never|none)\b|n't\b/i; // "Nothing was moved — Gym is not on Friday." is an honest reply (review 7 M2)
const CHANGE_CLAIM = /\b(?:done|added|moved|booked|scheduled|pushed|set|cancell?ed|removed|sent|logged|saved)\b/i;
const FULL_DISK = "I can't read your texts — ORION needs Full Disk Access.";
export const REPLY_FAILED = "I couldn't finish that just now.";
/** Raw error shapes a failed gmail/messages script prints (first match starts the span that is cut). */
const RAW_OAUTH = /invalid_grant|\boauth2: "|\bGet "https?:\/\/[^"\n]*"\s*:/i;
const RAW_PERMISSION = /operation not permitted|authorization denied|not authori[sz]ed to (?:open|read)/i;
const MAIL_TOOL = /orion-gmail|orion-messages|\bgmail\b|\bmessages\b/i;
// Spans cut out of a line (the rest of the sentence stays).
const SPANS = [
    /(?:⚠️\s*)?(?:🛠️\s*)?\bExec failed\b:?[^\n]*/gi,
    /`[^`\n]*(?:\/scripts\/|~\/Desktop\/ORION|\borion-[a-z-]+)[^`\n]*`/g,
    /--[a-z-]+\s+\d{4}-\d{2}-\d{2}/g,
    /\bIf he meant\b[^\n]*/gi,
];
// A known scheduler/tool banner label ("NOTHING WAS BOOKED: …"), not any ALL-CAPS label. Review 6 H-B (2026-10-16): the
// line is honest and must be told to him ("NOT BOOKED: Laundry (no room before 9 PM)"), so only the shouting label is
// rewritten to plain words; the line is never dropped.
const BANNER = /\b(NOTHING WAS (?:BOOKED|CHANGED|SENT|ADDED|MOVED|DELETED|SAVED|SCHEDULED)|NOT (?:BOOKED|SENT|CHANGED|SCHEDULED))\b(?=[^:\n]*:)/g;
/** The raw error shapes alone (never prose): cut on every turn. A bare "invalid_grant" in a sentence is prose. */
const RAW_SHAPE = /\boauth2: "|\bGet "https?:\/\/[^"\n]*"\s*:/i;
/** A lead-in that ends in ":" before the raw text becomes its own sentence ("I couldn't read your Gmail:" → "…Gmail."). */
const asSentence = (piece) => /:\s*$/.test(piece) ? (/\b(?:couldn'?t|can'?t|cannot|unable)\b/i.test(piece) ? piece.replace(/\s*:\s*$/, ".") : "") : piece;
/** True when this run's tool results include a gmail/messages read that failed (non-zero exit or a raw error shape). */
export function mailReadFailed(tools) {
    return tools.some((t) => MAIL_TOOL.test(t.canonical)
        && ((typeof t.exit === "number" && t.exit !== 0) || RAW_OAUTH.test(t.stdout) || RAW_PERMISSION.test(t.stdout)));
}
const tidy = (line) => line.replace(/[ \t]{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
/** The reply with raw CLI/tool spans removed (known failures become one short line). Returns the input when it is clean. */
export function sanitizeReply(reply, ctx = {}) {
    const stripped = stripExecFailed(reply);
    let changed = stripped !== reply.trim();
    let execCut = changed;
    const out = [];
    for (const raw of stripped.split("\n")) {
        let line = raw.replace(BANNER, (label) => { changed = true; return `${label.charAt(0)}${label.slice(1).toLowerCase()}`; })
            .replace(/^(\W*Not done:\s*)Nothing was booked:\s*/i, "$1");
        const oauth = line.search(RAW_OAUTH);
        const shape = line.search(RAW_SHAPE);
        // Review 6 M-D: a raw error shape is never prose, so it is cut on every turn; only the spoken line needs a failed mail read.
        if (shape >= 0 && !ctx.mailFailed) {
            const prefix = asSentence(tidy(line.slice(0, shape).replace(/\b(?:Get|Post)\s+"[^"]*$/i, "")));
            changed = true;
            if (/\w/.test(prefix) && /[.!?]$/.test(prefix))
                out.push(prefix);
            continue;
        }
        if (ctx.mailFailed) {
            const perm = line.search(RAW_PERMISSION);
            const hit = oauth >= 0 ? { at: oauth, say: mailLine(line) } : perm >= 0 && !/Full Disk Access/i.test(line) ? { at: perm, say: FULL_DISK } : null;
            if (hit) {
                const prefix = line.slice(0, hit.at).replace(/\b(?:Get|Post)\s+"[^"]*$/i, "").trim();
                // Review 6 M-C: a leftover piece is kept only when it is a whole sentence, never with a URL in it.
                const piece = asSentence(tidy(prefix).replace(/https?:\/\/\S+/g, "").trim());
                if (/\w/.test(piece) && /[.!?]$/.test(piece) && !/\b(?:I tried|tried|got|error|failed)\W*$/i.test(piece))
                    out.push(piece);
                out.push(hit.say);
                changed = true;
                continue;
            }
        }
        for (const re of SPANS)
            line = line.replace(re, () => { changed = true; if (re === SPANS[0])
                execCut = true; return ""; });
        if (line !== raw) {
            line = tidy(line);
            if (!/\w/.test(line))
                continue;
        }
        out.push(line);
    }
    if (!changed)
        return reply;
    const unique = out.filter((l, i) => !l.trim() || out.indexOf(l) === i);
    const text = unique.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    // "Done." with the failure that followed it cut away would be a false claim (review 6 M-B).
    if (execCut && CHANGE_CLAIM.test(text) && !NEGATED.test(text) && text.split(/\s+/).length <= 12)
        return REPLY_FAILED;
    return text || REPLY_FAILED;
}
