/*
 What the last day edit was (w20 sched), for "add it anyway, don't worry if it already passed" / "yeah do that one". One slot, not per
 session on purpose: the phone sent one conversation under three session keys in twelve minutes (orion-app-v2, orion-chat-<id>,
 orion-chat-phone-history), so a per-session memory lost exactly what he was referring to. He is the only person on this Mac.
*/
import type { DayEdit } from "./day-edit.js";

const KEEP_MS = 30 * 60_000;
let last: { edit: DayEdit; at: number } | null = null;

export const rememberEdit = (edit: DayEdit, now: Date): void => { last = { edit, at: now.getTime() }; };
export const recallEdit = (now: Date): DayEdit | null => (last && now.getTime() - last.at <= KEEP_MS ? last.edit : null);
export const forgetEdit = (): void => { last = null; };

const OVERRIDE = /\b(?:anyway|anyways|regardless|even though|even if|still (?:add|put|log)|(?:add|put|log) (?:it|that|those|them) (?:anyway|anyways|still))\b|\b(?:don'?t worry|doesn'?t matter|who cares|never mind) (?:that |if )?(?:it |that )?(?:already |has |have )?(?:passed|started|happened|over)\b|\balready passed\b/;
/** "add marketing museum anyways don't worry if it already passed": the last edit again, or just the parts he names. */
export function readOverride(message: string, now: Date): DayEdit | null {
  const m = message.toLowerCase().replace(/[’`]/g, "'");
  if (!OVERRIDE.test(m) || !/\b(?:add|put|log|do|book|schedule|keep|that|it)\b/.test(m)) return null;
  const prev = recallEdit(now);
  if (!prev) return null;
  const named = prev.parts.filter((p) => "name" in p && p.name.length > 2 && m.includes(p.name.toLowerCase().split(" ")[0]!));
  return { parts: named.length ? named : prev.parts };
}
