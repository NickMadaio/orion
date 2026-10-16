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
const FULL_DISK = "I can't read your texts — ORION needs Full Disk Access.";
export const REPLY_FAILED = "I couldn't finish that just now.";

/** Raw error shapes a failed gmail/messages script prints (first match starts the span that is cut). */
const RAW_OAUTH = /invalid_grant|\boauth2: "|\bGet "https?:\/\/[^"\n]*"\s*:/i;
const RAW_PERMISSION = /operation not permitted|authorization denied|not authori[sz]ed to (?:open|read)/i;
const MAIL_TOOL = /orion-gmail|orion-messages|\bgmail\b|\bmessages\b/i;

// Spans cut out of a line (the rest of the sentence stays).
const SPANS: RegExp[] = [
  /(?:⚠️\s*)?(?:🛠️\s*)?\bExec failed\b:?[^\n]*/gi,
  /`[^`\n]*(?:\/scripts\/|~\/Desktop\/ORION|\borion-[a-z-]+)[^`\n]*`/g,
  /--[a-z-]+\s+\d{4}-\d{2}-\d{2}/g,
  /\bIf he meant\b[^\n]*/gi,
];
// A line that IS a known scheduler/tool banner ("NOTHING WAS BOOKED: …"), not any ALL-CAPS label.
const BANNER = /^\W*(?:NOTHING WAS (?:BOOKED|CHANGED|SENT|ADDED|MOVED|DELETED|SAVED|SCHEDULED)|NOT (?:BOOKED|SENT|CHANGED|SCHEDULED))\b[^:\n]*:/;

export type SanitizeContext = { mailFailed?: boolean };

/** True when this run's tool results include a gmail/messages read that failed (non-zero exit or a raw error shape). */
export function mailReadFailed(tools: ReadonlyArray<{ canonical: string; stdout: string; exit?: number | null }>): boolean {
  return tools.some((t) => MAIL_TOOL.test(t.canonical)
    && ((typeof t.exit === "number" && t.exit !== 0) || RAW_OAUTH.test(t.stdout) || RAW_PERMISSION.test(t.stdout)));
}

const tidy = (line: string): string => line.replace(/[ \t]{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();

/** The reply with raw CLI/tool spans removed (known failures become one short line). Returns the input when it is clean. */
export function sanitizeReply(reply: string, ctx: SanitizeContext = {}): string {
  const stripped = stripExecFailed(reply);
  let changed = stripped !== reply.trim();
  const out: string[] = [];
  for (const raw of stripped.split("\n")) {
    if (BANNER.test(raw)) { changed = true; continue; }
    let line = raw;
    if (ctx.mailFailed) {
      const oauth = line.search(RAW_OAUTH);
      const perm = line.search(RAW_PERMISSION);
      const hit = oauth >= 0 ? { at: oauth, say: GMAIL_SIGN_IN } : perm >= 0 && !/Full Disk Access/i.test(line) ? { at: perm, say: FULL_DISK } : null;
      if (hit) {
        const prefix = line.slice(0, hit.at).replace(/\b(?:Get|Post)\s+"[^"]*$/i, "").trim();
        if (tidy(prefix).replace(/[^\w]/g, "").length > 0 && !/\b(?:I tried|tried|got|error|failed)\W*$/i.test(tidy(prefix))) out.push(tidy(prefix));
        out.push(hit.say);
        changed = true;
        continue;
      }
    }
    for (const re of SPANS) line = line.replace(re, () => { changed = true; return ""; });
    if (line !== raw) { line = tidy(line); if (!/\w/.test(line)) continue; }
    out.push(line);
  }
  if (!changed) return reply;
  const unique = out.filter((l, i) => !l.trim() || out.indexOf(l) === i);
  const text = unique.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return text || REPLY_FAILED;
}
