/*
 A reply that says nobody wrote while it (or the messages result) shows someone did.
 Live sweep 2026-10-16 (r7), q065 "did anyone text me": "No one texted you recently. Your last messages were
 from Gia and you, with the most recent being yours at 00:20." The reply was never compared with what the
 messages read returned. Written by Claude on 2026-10-16.
*/
import type { ToolResult } from "./work-check.js";

const NONE_CLAIM = /\b(no one|nobody|no[- ]one|none of your contacts)\s+(has\s+|have\s+)?(texted|messaged|emailed|written|sent)\b|\bno\s+(new\s+|recent\s+|unread\s+)+(texts?|messages?|emails?)\b|\bnothing new\b|\b(haven'?t|have not) (got|gotten|received) any\b/i;
// The reply itself reports messages: "your last messages were from Gia", "Gia texted at 9".
const REPORTS_SOME = /\b(last|latest|most recent|recent|newest) (messages?|texts?|emails?)\b[^.]*\b(from|were|was)\b|\b(texted|messaged|emailed) you (at|about|on)\b|\bmost recent being\b/i;
// A line of the messages read: "Thu 14:02  Gia: running late" (scripts/orion-messages render()).
const MESSAGE_LINE = /\d{1,2}:\d{2}\s+[^\n:]{1,40}:\s+\S/;

// A denial limited to new, unread, today, tonight, this morning or "since …" is right beside older messages
// ("No new texts. Your last text was from Gia at 9:02 last night."); review, 2026-10-16.
const SCOPED = /\b(new|unread|today|tonight|this (morning|afternoon|evening)|since|yet)\b/i;

/** True when the reply denies messages yet reports some, or the messages read this turn returned some. */
export function denialContradictsMessages(reply: string, turnResults: ToolResult[]): boolean {
  const text = String(reply ?? "").replace(/[’‘]/g, "'");
  const denial = text.split(/(?<=[.!?;])\s+|\s[—–]\s/).find((c) => NONE_CLAIM.test(c));
  if (!denial || SCOPED.test(denial)) return false;
  if (REPORTS_SOME.test(text)) return true;
  return turnResults.some((r) => MESSAGE_LINE.test(String(r.stdout)) && !/No messages matched/.test(String(r.stdout)));
}
