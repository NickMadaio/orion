/*
 Never send nothing (w20 round 3, live gate turn 43: "whats on my todo list" came back blank after 68 s, model null).
 A blank, or a reply that was only an old outreach line, becomes a short honest line with the reason, and offers the retry that
 retry-slot.ts keeps ("Say go and I'll retry it.").
*/
import { RETRY_OFFER } from "./retry-slot.js";

export const EMPTY_MARK = "I came back with nothing";

/** The honest line. `reason` is one short clause (a failed tool, "the model didn't answer in time"). */
export function emptyReplyLine(reason?: string): string {
  const why = reason?.trim() ? reason.trim().replace(/[.!\s]+$/, "") : "the model didn't answer in time";
  return `${EMPTY_MARK} just now: ${why}. Say go and I'll retry it.`;
}

export const isBlank = (reply: string | undefined): boolean => !reply || !/[\p{L}\p{N}]/u.test(reply);
export const isEmptyLine = (reply: string): boolean => reply.startsWith(EMPTY_MARK) && RETRY_OFFER.test(reply);

/** A why-question about the reply that was blank: it is that reply he means. */
export function whyEmptyLine(reason?: string): string {
  const why = reason?.trim() ? reason.trim().replace(/[.!\s]+$/, "") : "the model didn't answer in time";
  return `My last reply came back blank, that was my failure, not yours: ${why}. Say go and I'll retry it.`;
}
