/*
 A nag he never engaged with must not speak for him or through ORION (w20 round 3, live gate 2026-11-05 turns 37, 40, 44, 45, 50).

 The "[ORION context: you messaged him first, N min ago: ...]" label rode on every turn for 25 minutes, so after "You've been avoiding
 bed for 45 min. Get up." a bare "go" returned the nag, "yeah do it" ran `orion-checkin started bed` instead of the open-site offer ORION had
 just made, "hey how are you" got the nag glued on, and "can you fix your own code" never reached the self-fix offer (outreach blocks it).
 Rule: a short confirmation binds to ORION's most recent question in the chat (what it last asked, by time). An outreach binds only until
 ORION has replied in this chat; after that it is history. And outreach text is never appended to a reply about something else.
*/
import type { Outreach } from "./outreach-reply.js";

const MIN_MS = 60_000;

/** True once ORION has replied in this chat after the outreach was sent. The label's minutes are truncated, so the earliest send time is used. */
export function outreachStale(o: Outreach, lastReplyAt: number | undefined, nowMs: number): boolean {
  if (lastReplyAt === undefined) return false;
  if (o.kind === "question" && o.askId) return false;   // an ask he is answering across several messages keeps its binding
  return lastReplyAt > nowMs - (o.minutes + 1) * MIN_MS;
}

/** The line the worker gets in place of "his message answers that": the old outreach is not part of this turn. */
export const staleOutreachNote = (o: Outreach): string =>
  `[Context: earlier you messaged him "${o.text.slice(0, 200)}". He has not engaged with it and it is old. Do not repeat it, quote it, or act on it. Answer only his message below, against what you last said to him in this chat.]`;

const NAG_SHAPES: RegExp[] = [
  /you'?ve been avoiding [^.]{1,60}? for \d+ min\.(?: no\.)?(?: that'?s an hour\.)?(?: get up\.)?(?: we'?re doing it now\.)?/gi,
  /it'?s been \d+ min\. [^.]{1,60}?, now\.(?: phone down[^.]*\.)?/gi,
  /time to start: [^.]{1,60}\./gi,
];

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A reply with any outreach text it echoes cut out (the exact lines, and the ladder's own shapes), whitespace tidied. */
export function stripOutreachEcho(reply: string, texts: readonly string[]): string {
  let out = reply;
  for (const t of texts) if (t.trim().length >= 12) out = out.replace(new RegExp(escape(t.trim()), "gi"), " ");
  if (texts.some((t) => NAG_SHAPES.some((re) => { re.lastIndex = 0; return re.test(t); }))) for (const re of NAG_SHAPES) out = out.replace(re, " ");
  return out.replace(/\s+/g, " ").trim();
}
