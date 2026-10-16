/*
 Raw CLI / tool text never reaches Nick (H4, round 8b2, 2026-10-16).
 q069: a reply carried `Get "https://gmail.googleapis.com/…": … oauth2: "invalid_grant" …`.
 q070: a reply ended with "⚠️ 🛠️ Exec failed: `~/Desktop/ORION/scripts/orion-gmail-search …`" (stripExecFailed ran only in
 reply_payload_sending, which never fires on the Mac chat / phone route).
 This runs in before_agent_finalize and the result is put in place; it catches what the worker paraphrased or the host
 appended. Lines that are scheduler/tool banners ("NOTHING WAS BOOKED:", "If he meant …", "--date 2026-10-16") are dropped.
*/
import { stripExecFailed } from "./memory-facts.js";

const GMAIL_SIGN_IN = "I can't read your Gmail right now — it needs signing in again.";
const FULL_DISK = "I can't read your texts — ORION needs Full Disk Access.";
export const REPLY_FAILED = "I couldn't finish that just now.";

const OAUTH = /invalid_grant|oauth2?\b|googleapis\.com/i;
const PERMISSION = /operation not permitted|authorization denied|not authori[sz]ed to (?:open|read)/i;
const RAW_LINE = [
  /\bExec failed\b/i,
  /`[^`\n]*(?:\/scripts\/|~\/Desktop\/ORION|\borion-[a-z-]+)[^`\n]*`/,
  /--[a-z-]+\s+\d{4}-\d{2}-\d{2}/,
  /\bIf he meant\b/i,
  /^\W*[A-Z][A-Z]+(?:\s+[A-Z][A-Z]+)+\s*:/, // an ALL-CAPS tool banner: "NOTHING WAS BOOKED:"
  /https?:\/\/\S+/,
];

/** The reply with raw CLI/tool lines removed (known failures become one short line). Returns the input when it is clean. */
export function sanitizeReply(reply: string): string {
  const stripped = stripExecFailed(reply);
  const lines = stripped.split("\n");
  const out: string[] = [];
  let changed = stripped !== reply.trim();
  for (const line of lines) {
    if (OAUTH.test(line)) { out.push(GMAIL_SIGN_IN); changed = true; continue; }
    if (PERMISSION.test(line) && !/Full Disk Access/i.test(line)) { out.push(FULL_DISK); changed = true; continue; }
    if (RAW_LINE.some((re) => re.test(line))) { changed = true; continue; }
    out.push(line);
  }
  if (!changed) return reply;
  const unique = out.filter((l, i) => !l.trim() || out.indexOf(l) === i);
  const text = unique.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return text || REPLY_FAILED;
}
