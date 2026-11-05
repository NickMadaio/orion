/*
 What the last day edit left behind (w20 sched, fix-dayedit), for "add it anyway, don't worry if it already passed" / "yeah do that one",
 and "undo, i meant add those". One slot, not per session on purpose: the phone sent one conversation under three session keys in
 twelve minutes (orion-app-v2, orion-chat-<id>, orion-chat-phone-history), so a per-session memory lost exactly what he was referring to.
 He is the only person on this Mac. What is remembered for "anyway" is only the part(s) that were refused, never what already worked.
*/
import { readDayEdit } from "./day-edit.js";
const KEEP_MS = 30 * 60_000;
let last = null;
let lastAsk = null;
let lastRun = null;
export const rememberEdit = (edit, now) => { last = { edit, at: now.getTime() }; };
export const recallEdit = (now) => (last && now.getTime() - last.at <= KEEP_MS ? last.edit : null);
export const forgetEdit = () => { last = null; };
/** Everything remembered, for tests. */
export const resetDayEditMemory = () => { last = null; lastAsk = null; lastRun = null; };
const UNDO_THEN = /^(?:(?:ok|okay|wait|no|nah|sorry)[,\s]+)*(?:undo|revert)(?:\s+(?:that|it|all of that))?[.,!;:\s]+(?:(?:no|sorry)[,\s]+)?(?:i\s+)?(?:meant|mean)\s+(?:to\s+)?(?:add|put|schedule|book|log)\s+(?:those|them|these|all of (?:those|them))\b/;
const BARE = /^(?:(?:ok|okay|wait|no)[,\s]+)*(?:undo|revert|cancel)\b/;
/** "Undo. I meant add those to the schedule": the last edit comes back off, then the ask before it is read as the schedule. */
export const isUndoThen = (message) => UNDO_THEN.test(message.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim());
/** What he last asked (any message that is not itself an undo), for "those" in an undo-then. */
export const rememberAsk = (text, now) => { if (!isUndoThen(text) && !BARE.test(text.trim().toLowerCase()) && !OVERRIDE.test(text.toLowerCase().replace(/[’`]/g, "'")))
    lastAsk = { text, at: now.getTime() }; };
export const recallAsk = (now) => (lastAsk && now.getTime() - lastAsk.at <= KEEP_MS ? lastAsk.text : null);
/** The writes the last day edit made, so an undo takes back exactly those. */
export const rememberRun = (writes, facts, now) => { lastRun = writes || facts.length ? { writes, facts, at: now.getTime() } : null; };
export const recallRun = (now) => (lastRun && now.getTime() - lastRun.at <= KEEP_MS ? lastRun : null);
const OVERRIDE = /\b(?:anyway|anyways|regardless|even though|even if|still (?:add|put|log)|(?:add|put|log) (?:it|that|those|them) (?:anyway|anyways|still))\b|\b(?:don'?t worry|doesn'?t matter|who cares|never mind) (?:that |if )?(?:it |that )?(?:already |has |have )?(?:passed|started|happened|over)\b|\balready passed\b/;
/** "add marketing museum anyways don't worry if it already passed": the part(s) that were refused, or just the ones he names. */
export function readOverride(message, now) {
    const m = message.toLowerCase().replace(/[’`]/g, "'");
    if (!OVERRIDE.test(m) || !/\b(?:add|put|log|do|book|schedule|keep|that|it)\b/.test(m))
        return null;
    // What was refused is remembered as an edit; when nothing was (it went through another way), the ask before this one is read again.
    const asked = recallAsk(now);
    const prev = recallEdit(now) ?? (asked ? readDayEdit(asked, now) : null);
    if (!prev)
        return null;
    const named = prev.parts.filter((p) => "name" in p && !!p.name && p.name.length > 2 && m.includes(p.name.toLowerCase().split(" ")[0]));
    return { parts: named.length ? named : prev.parts };
}
