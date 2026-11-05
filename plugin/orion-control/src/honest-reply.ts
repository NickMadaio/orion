/*
 What ORION says when his own reply could not be trusted, or when he truly cannot do the thing (w20 wording, tube audit root cause 1).
 Nick: "He just says he can't do it and to rephrase it. It's ugly, repetitive, and he should either be able to do it or explain to me
 what went wrong." So: say what really happened from the tool results (what ran, what failed and why) in one first-person sentence,
 offer the concrete next step, keep a model reply that was already true, and when the capability is missing say so and offer to build it.
*/
import { isBareConfirm } from "./bare-confirm.js";
import { claimsIn, outcomeOf, type ToolResult } from "./work-check.js";
import { failureReason, failedTools } from "./tool-failure.js";
import { parseReason, reasonFromSpoken, reasonOffer, repeatOffer, reasonClause } from "./failure-reason.js";

const hash = (s: string): number => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const lastPick = new Map<string, number>();
/** One of the variants, chosen from the seed; with `key`, never the same one twice in a row for that key. */
export function pickVariant<T>(key: string | undefined, seed: string, list: readonly T[]): T {
  let i = hash(seed) % list.length;
  if (key !== undefined) {
    if (lastPick.get(key) === i) i = (i + 1) % list.length;
    lastPick.set(key, i);
  }
  return list[i]!;
}
export const resetVariants = (): void => lastPick.clear();

const lcfirst = (s: string): string => (/^I\b/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

const ATTEMPTS: Array<[RegExp, string]> = [
  [/\bapp_open|folder_open/, "open it"], [/\bbrowser_open_url/, "open that page"], [/\bapp_quit/, "close it"],
  [/orion-reschedule\s+\S*\s*(?:add|plan)|orion-reschedule\s+add/, "add it to your day"],
  [/orion-reschedule/, "change your day"], [/orion-tasks/, "update your tasks"], [/session/, "start the session"],
  [/messages_send|orion-send/, "send that"], [/orion-log|orion-workout|orion-food/, "log that"],
];
export const attemptPhrase = (t: ToolResult): string => ATTEMPTS.find(([re]) => re.test(t.canonical))?.[1] ?? "do that";

/** What the failed tools say went wrong, with the next step. Empty when nothing failed. */
export function failureStory(tools: ReadonlyArray<ToolResult>): string {
  const failed = failedTools(tools);
  if (!failed.length) return "";
  const first = failed[0]!;
  const reason = failed.map((t) => failureReason(t.stdout)).find(Boolean) ?? "";
  const line = first.stdout.split("\n").map((l) => l.trim()).find((l) => /NOTHING WAS|NOT BOOKED|NOT SENT/i.test(l)) ?? first.stdout;
  const parsed = parseReason(line);
  const said = reason || reasonClause(parsed);
  const wrote = /orion-reschedule|orion-tasks|orion-log|orion-workout|orion-food|messages_send|orion-send|session/.test(first.canonical);
  const lead = said ? `I couldn't ${wrote ? "make that change" : "run that"}: ${lcfirst(said)}.` : `I couldn't ${wrote ? "make that change" : "run that"}, it didn't go through.`;
  const next = /allowed|not allowlisted/i.test(said) ? "That's a limit I can't get past from chat. Want me to build a way to do it?"
    : /find it|couldn't find/i.test(said) ? "Tell me the exact name and I'll go again."
    : /reach it/i.test(said) ? "It looks like a connection problem; I'll retry it the moment you say go."
    : reasonOffer(parsed);
  return `${lead} ${next}`;
}

export type HonestCtx = { calendar: boolean; message?: string; tools?: ReadonlyArray<ToolResult>; rotate?: boolean };

/** A bare "go" / "that one" with no tool run and nothing to say yes to: said plainly, then asked (live gate 3 #97 #98, not "I got ahead of myself"). */
export const NOTHING_PENDING_LINES = [
  "There's nothing waiting on a yes from me right now. What did you mean?",
  "I don't have anything open to go ahead with. What are you after?",
  "Nothing's pending on my side, so I'm not sure what you mean. What should I do?",
];
const POINTS_AT_NOTHING = /^(?:(?:yeah|yes|yep|ok|okay|sure)[\s,]+)?(?:(?:that|this|the) one|that|this|it)[\s.!?]*$/i;
export const isBareGoAhead = (message: string | undefined): boolean => !!message && (isBareConfirm(message) || POINTS_AT_NOTHING.test(message.trim()));

/** The honest line for a reply that claimed more than the tools show. From tool results when there are any. */
export function honestReply(ctx: HonestCtx): string {
  const story = failureStory(ctx.tools ?? []);
  if (story) return story;
  if (!(ctx.tools ?? []).length && isBareGoAhead(ctx.message)) return pickVariant(ctx.rotate ? "honest:nothing-pending" : undefined, ctx.message ?? "", NOTHING_PENDING_LINES);
  const ran = (ctx.tools ?? []).filter((t) => outcomeOf(t) !== "read").length;
  const looked = (ctx.tools ?? []).length - ran;
  const seed = `${ctx.message ?? ""}|${ctx.calendar}|${looked}`;
  const key = ctx.rotate ? (ctx.calendar ? "honest:cal" : "honest:any") : undefined;
  const lookedOnly = looked > 0 ? " I only looked things up." : "";
  const lines = ctx.calendar
    ? [`I couldn't make that change: it never actually ran, so your calendar is exactly as it was.${lookedOnly} Want me to do it now?`,
       `I couldn't run that change, I said more than I did, so nothing on your calendar moved.${lookedOnly} Shall I make it now?`,
       `I couldn't get that change to run, and your day is untouched.${lookedOnly} Want me to try it now?`]
    : [`I couldn't run that, so nothing was started or changed.${lookedOnly} Want me to do it now?`,
       `I couldn't actually run that: I got ahead of myself and nothing happened.${lookedOnly} Shall I do it now?`,
       `I couldn't run that yet, and nothing was changed.${lookedOnly} Want me to go ahead?`];
  return pickVariant(key, seed, lines);
}

/** True when the model's reply plainly says nothing happened and claims no change. The check may flag "is already running"; that stays. */
export function truthfulDenial(reply: string, tools: ReadonlyArray<ToolResult> = []): boolean {
  if (tools.some((t) => ["success", "partial"].includes(outcomeOf(t)))) return false;
  const claims = claimsIn(reply);
  if (!claims.some((c) => c.kind === "denial")) return false;
  return !claims.some((c) => c.kind === "promise" || (c.kind === "done" && c.strength === "strong"));
}

// ---- repeats ----
/** A different, more useful reply to the same failed ask: the reason plus a concrete alternative. */
export function repeatedFailure(previous: string, level: number, key?: string): string {
  const body = previous.replace(/^(?:Not done:|I couldn't [^:]*:|I tried to [^,]*,? but)\s*/i, "").split(/(?<=[.?!])\s+/)[0]?.replace(/[.?!]+$/, "") ?? "";
  const parsed = reasonFromSpoken(previous);
  const why = body && body.length < 140 && parsed.kind !== "unknown" ? lcfirst(body) : "";
  const alt = repeatOffer(parsed);
  const lines = level <= 1
    ? [why ? `Same wall as before: ${why}. ${alt}` : `That hit the same snag as before. ${alt}`,
       why ? `Asking it the same way will end the same way: ${why}. ${alt}` : `Same result again, so I won't just rerun it. ${alt}`,
       why ? `Still stuck on this: ${why}. ${alt}` : `Still stuck on that one. ${alt}`]
    : [`I'm not going to keep retrying that unchanged. ${alt}`, `That one needs something different from you, not another go. ${alt}`];
  return pickVariant(key, previous, lines);
}

// ---- capability missing ----
export const BUILD_OFFER = /\bwant me to build (?:that|it|this)\?\s*$/i;
export const offersBuild = (text: string): boolean => BUILD_OFFER.test(text.trim());

const POLITE = /^(?:(?:hey|ok(?:ay)?|so|please|pls|um+|uh+|yo|orion|can you|could you|would you|will you|i need you to|i want you to|just)[,\s]+)+/i;
/** A short phrase for what he asked ("close some of the apps that are open"), pronouns turned around. */
export function gistOf(message: string): string {
  const m = message.trim().replace(POLITE, "").replace(/[?!.…]+$/g, "").replace(/\s+/g, " ");
  const words = m.split(" ").slice(0, 9).map((w) => (/^my$/i.test(w) ? "your" : /^me$/i.test(w) ? "you" : w.toLowerCase()));
  return words.join(" ");
}

/** The honest line when the capability is missing: what is missing in plain words, and the offer that hands off to the self-fix flow. */
export function capabilityLine(message: string, key?: string): string {
  const gist = gistOf(message);
  const what = gist ? `"${gist}"` : "that";
  return pickVariant(key, message, [
    `I don't have a way to do ${what} yet, and I haven't touched anything. Want me to build that?`,
    `That's not something I can do right now (${what}), so nothing changed. Want me to build that?`,
    `I can't do ${what} yet, but I can add it. Nothing changed so far. Want me to build that?`,
  ]);
}

// A model refusal that hands the job back to him ("I can't X with the tools I have. Try doing Y yourself.").
const REFUSAL = /\b(?:i (?:can'?t|cannot|am unable to|'m unable to|i'?m not able to|am not able to|don'?t have (?:a way|the (?:ability|tools?)|access to))|(?:that'?s|this is) not something (?:i|orion) can do|with the tools i have)\b/i;
const HANDS_BACK = /\b(?:try|you(?:'ll| will)? (?:need|have) to|you can|please) [^.!?]{0,60}\b(?:yourself|manually|directly|settings|restart|yourself)\b|\bwith the tools i have\b|\bnot something (?:i|orion) can do\b/i;
const ASK_SHAPE = /^(?:(?:hey|ok(?:ay)?|so|please|pls|um+|uh+|yo|orion)[,\s]+)*(?:can you|could you|would you|will you|please|pls|open|close|quit|re-?open|pull up|bring up|play|set|put|add|move|push|send|log|start|stop|turn|make|fix|find|show|take|get|block|unblock|mute|text|call|email|map|connect)\b/i;

/** The reply to use in place of a model refusal that neither tried nor explained: the capability line. */
export function refusalRewrite(reply: string, message: string, tools: ReadonlyArray<ToolResult> = [], key?: string): string | undefined {
  if (!REFUSAL.test(reply) || !HANDS_BACK.test(reply)) return undefined;
  if (/\?\s*$/.test(message.trim()) && !/^(?:can|could|would|will) you\b/i.test(message.trim())) return undefined;
  if (!ASK_SHAPE.test(message.trim().replace(/^(?:and|then|also|ok(?:ay)?|so|wait)[,\s]+/i, ""))) return undefined;
  const failed = failureStory(tools);
  return failed || capabilityLine(message, key);
}
