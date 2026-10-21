/*
 Gmail's connection status, from a real call -- never from "a token file exists".

 On 2026-10-21 ORION told Nick Gmail was connected while `gog gmail search` failed with invalid_grant (last authorised
 2026-08-14). A stored token only proves a token is stored; only Google can say whether it still works. So status is
 the result of one cheap authenticated read (a one-thread search).
*/
import { searchThreads } from "./gmail-client.mjs";

export const GMAIL_ACCOUNT = "nmadaio08@gmail.com";
export const GMAIL_EXPIRED = `Gmail's sign-in expired — run \`gog auth add ${GMAIL_ACCOUNT}\` to reconnect.`;

const EXPIRED = /invalid_grant|token (?:has been )?(?:expired|revoked)|expired or revoked|sign-in expired/i;
const OFFLINE = /no such host|dial tcp|network is unreachable|could not resolve|getaddrinfo|ENOTFOUND|timed? ?out|connection refused|round trip/i;

/** "expired" | "unreachable" | "error" for a failed gog call's text. A network failure is never reported as an expired sign-in. */
export function classifyGmailError(text) {
  const t = String(text ?? "");
  if (OFFLINE.test(t) && !/invalid_grant/i.test(t)) return "unreachable";
  return EXPIRED.test(t) ? "expired" : "error";
}

/** One cheap authenticated read. Returns { state: "connected"|"expired"|"unreachable"|"error", say }. */
export async function gmailStatus(orionRoot, { search = searchThreads } = {}) {
  try {
    await search(orionRoot, "in:inbox", 1);
    return { state: "connected", say: "working (read-only)" };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    const state = classifyGmailError(text);
    if (state === "expired") return { state, say: GMAIL_EXPIRED };
    if (state === "unreachable") return { state, say: "Gmail couldn't be reached just now (network), so its status is unknown." };
    return { state, say: `NOT working: ${text.trim().split("\n").at(-1)?.slice(0, 120) || "no answer"}` };
  }
}
