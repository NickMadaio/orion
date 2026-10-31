/*
 Closing the proactive loop (2026-10-31, gate run-1031202318 clusters 1 and 8: the loop area passed 4 of 20).

 ORION nudges first (a ladder rung, the leave line, bedtime, "Session done", the morning brief, a missed class, an off-plan question)
 and Nick answers short: "sure whenever", "yeah", "...", "im starving gonna eat first", "changed", "ok fine". Those fell through to
 "Didn't catch that" / "I didn't actually do that" / "I couldn't make that change", because nothing read the reply against what ORION
 had just asked.

 Here, the reply is resolved against the most recent unanswered outreach (the app's "[ORION context: …]" label, else the last message
 in outreach.jsonl from the state card inside a short window, else what this chat agreed a turn ago), and the action that outreach
 offered is carried out through the same paths the explicit command uses: the scheduler (by the exact words calendar-intent.ts reads),
 orion-checkin (defer / started / close on the ONE loop it belongs to, or a new check-in when there is none: never a second ladder),
 the focus-session flow, and a read of the day. Every reply is built from those results. With no pending outreach, nothing happens.

 REV4 (2026-10-31): nothing is bound within 30 min of the crisis reply, or to an outreach older than ORION's last reply in this chat (a
 question asked in chat beats an older push); an outreach answered in any chat is recorded in the state dir (pending-answered.json). In
 pending-reply-act.ts a decline never writes, a class or a plan with people moves only when he names it, a time already gone is refused,
 and every reply about a time says what the calendar shows after the write.

 Also: a voice turn that finishes a cut-off one ("(Continuing — my last message was cut off …)") is read as the whole request
 (continuationOf), the joined text when the app sends only the rest, or the full text when the marker carries it.
*/
import type { Day, FlowResult } from "./schedule-flow.js";
import type { ToolResult } from "./work-check.js";
import type { Outreach } from "./outreach-reply.js";
import { HUSH, REQUEST, offerOf, pauseThenStart, readReply, type Offer, type Reply } from "./pending-reply-read.js";
import { runTurn } from "./pending-reply-act.js";
import { answeredIn, readAnswered, withAnswered, writeAnswered, type AnsweredRow } from "./pending-reply-answered.js";

export { offerOf, readReply } from "./pending-reply-read.js";

/** What this chat agreed a turn ago, that the next short reply continues. */
export type Memo =
  | { kind: "resume"; title: string; activity?: string; at: number }
  | { kind: "bedtime"; at: number; checkinId?: string; checkinAt?: number; napped?: boolean }
  | { kind: "booked"; title: string; when: string; at: number }
  | { kind: "brief"; items: string[]; at: number }
  | { kind: "next"; at: number }
  | { kind: "move-offer"; title: string; to: number; which: "today" | "tomorrow"; at: number };

/** said: his words, trimmed (the reason orion-checkin reads for a grace). */
export type PendingTurn = { reply: Reply; offer?: Offer; memo?: Memo; sentAt?: number; outreachText?: string; said?: string };

export type PendingDeps = {
  now: Date;
  schedule?: (command: string) => Promise<FlowResult>;
  session?: (words: string) => Promise<FlowResult>;
  checkin?: (args: string[]) => Promise<{ stdout: string; code: number }>;
  readDay?: (dateArgs: string[]) => Promise<Day | undefined>;
};

export type PendingOutcome = { flow: FlowResult; tools: ToolResult[]; marks: string[]; memo: Memo | null };

const MEMO_MS = 60 * 60_000;
/** How long after ORION's own message a short reply is read as answering it, when the app sent no label (the state card's last push). */
const PUSH_MS = 30 * 60_000;
const QUESTION_MS = 90 * 60_000;

/** Which replies each offer carries out (anything else goes on to the normal turn, which still has the context). */
const OFFER_TAKES: Record<Offer["kind"], ReadonlyArray<Reply["kind"]>> = {
  start: ["defer", "done", "resume", "accept", "indifferent", "decline", "counter", "awake"],
  leave: ["defer", "accept", "indifferent"],
  bedtime: ["awake", "workload", "defer"],
  catchup: ["accept", "indifferent", "counter", "decline"],
  slipped: ["accept", "indifferent", "decline", "counter"],
  brief: ["accept", "indifferent", "counter"],
  "session-done": ["accept", "next", "indifferent", "done"],
  "plan-check": ["changed", "decline", "accept", "counter"],
};
const MEMO_TAKES: Record<Memo["kind"], ReadonlyArray<Reply["kind"]>> = {
  resume: ["resume", "done", "accept"],
  bedtime: ["awake", "workload", "defer"],
  booked: ["accept", "indifferent"],
  brief: ["accept", "counter"],
  next: ["next", "accept"],
  "move-offer": ["accept", "counter", "decline"],
};

/** How long after the crisis reply a short reply is never read as answering a nudge (the normal turn and its support line have it). */
export const CRISIS_HOLD_MS = 30 * 60_000;

/** What came before this turn in the chat: when ORION last replied here, and whether the crisis reply is still recent. */
export type PriorTurn = { lastReplyAt?: number; afterCrisis: boolean };

/**
 Per chat: the memo, when ORION last replied, and when the crisis reply went. Per state dir (every chat, across restarts): the outreach
 already answered (pending-reply-answered.ts). Without a state dir the answered record is kept in memory only.
*/
export class PendingMemory {
  private memos = new Map<string, Memo>();
  private replies = new Map<string, number>();
  private crises = new Map<string, number>();
  private answered: AnsweredRow[] = [];
  memo(key: string, nowMs: number): Memo | undefined { const m = this.memos.get(key); return m && nowMs - m.at < MEMO_MS ? m : undefined; }
  setMemo(key: string, memo: Memo | null): void { if (memo) this.memos.set(key, memo); else this.memos.delete(key); }
  /**
   Records this turn (ORION answers it unless it was hushed; a crisis turn starts the hold) and returns what came before it.
   nowMs is the plugin's clock, the one outreach times are read on.
  */
  beginTurn(key: string, nowMs: number, turn: { crisis: boolean; replied: boolean }): PriorTurn {
    const lastReplyAt = this.replies.get(key);
    const crisisAt = this.crises.get(key);
    const afterCrisis = turn.crisis || (crisisAt !== undefined && nowMs - crisisAt >= 0 && nowMs - crisisAt < CRISIS_HOLD_MS);
    if (turn.crisis) this.crises.set(key, nowMs);
    if (turn.replied) this.replies.set(key, nowMs);
    return { ...(lastReplyAt !== undefined ? { lastReplyAt } : {}), afterCrisis };
  }
  wasAnswered(text: string, sentAt: number, nowMs: number, dir?: string): boolean {
    return answeredIn(dir ? readAnswered(dir) : this.answered, text, sentAt, nowMs) || answeredIn(this.answered, text, sentAt, nowMs);
  }
  markAnswered(text: string, sentAt: number, nowMs: number, dir?: string): void {
    this.answered = withAnswered(this.answered, text, sentAt, nowMs);
    if (dir) writeAnswered(dir, withAnswered(readAnswered(dir), text, sentAt, nowMs));
  }
}

export type PendingInput = {
  message: string; now: Date;
  /** The app's label for the outreach this answers (already windowed by the app's tracker). */
  outreach?: Outreach;
  /** The last message ORION sent (outreach.jsonl via the state card), for a reply that came with no label. */
  lastPush?: { text: string; at: string } | null;
  memo?: Memo;
  /** Whether this outreach (its text, sent at) was already answered, in any chat. */
  answered?: (text: string, sentAt: number) => boolean;
  /** When ORION last replied in this chat (plugin clock, ms): an outreach sent before that is not what a short reply answers. */
  lastReplyAt?: number;
};

const QUESTION_KINDS: ReadonlyArray<Offer["kind"]> = ["catchup", "plan-check", "brief", "slipped"];

const CHANGE_VERB = /\b(?:move|add|put|book|schedule|cancel|drop|remind|set|start|text|email|play|clear|delete|remove)\s+(?:me\s+)?(?:in\s+)?(?:my\s+|the\s+|a\s+|an\s+|some\s+)?([a-z0-9']+)/i;
/** Words a counter-offer may name after its verb without naming something else: a length, "it", "time". */
const GENERIC_OBJECT = /^(?:\d+|a|an|one|two|half|it|that|this|them|those|time|some|hour|hours|hr|min|mins|minutes|slot|block|session|both|everything|catch|catchup|tomorrow|tmrw|tonight|today|first|now)$/;
const nameWords = (names: string[]): string[] => names.flatMap((n) => n.toLowerCase().split(/[^a-z0-9]+/)).filter((w) => w.length > 2);
const offerNames = (o: Offer): string[] =>
  o.kind === "brief" ? o.items : o.kind === "catchup" ? [o.subject ?? "", "catch up"] : "title" in o ? [o.title] : [];
const memoNames = (m: Memo): string[] => (m.kind === "brief" ? m.items : "title" in m ? [m.title] : []);
/** A counter-offer that names something other than what ORION offered ("add gym tomorrow at 7" after the morning brief) is his own request. */
function ownRequest(message: string, reply: Reply, names: string[]): boolean {
  if (reply.kind !== "counter") return false;
  const verb = message.toLowerCase().match(CHANGE_VERB);
  if (!verb) return false;
  const object = verb[1]!;
  return !GENERIC_OBJECT.test(object) && !nameWords(names).some((w) => w.startsWith(object) || object.startsWith(w));
}

/** The pending reply this message is, or undefined (the turn goes on unchanged). Pure. */
export function readPendingTurn(input: PendingInput): PendingTurn | undefined {
  const { message, now, outreach, lastPush, memo } = input;
  const explicit = pauseThenStart(message);
  const said = message.trim().slice(0, 120);
  if (explicit) return { said, offer: { kind: "start", title: explicit.title }, reply: { kind: "defer", activity: explicit.activity, ...(explicit.minutes ? { minutes: explicit.minutes } : {}), ...(explicit.typical ? { typical: explicit.typical } : {}) } };
  const reply = readReply(message);
  if (!reply || HUSH.test(message.toLowerCase())) return undefined;
  if (reply.kind !== "counter" && REQUEST.test(message.toLowerCase())) return undefined;
  if (memo && MEMO_TAKES[memo.kind].includes(reply.kind) && !ownRequest(message, reply, memoNames(memo))) return { said, reply, memo };
  const fromLabel = outreach ? { text: outreach.text, at: now.getTime() - outreach.minutes * 60_000 } : undefined;
  const push = !fromLabel && lastPush ? { text: lastPush.text, at: Date.parse(lastPush.at) } : undefined;
  const source = fromLabel ?? push;
  if (!source || Number.isNaN(source.at) || input.answered?.(source.text, source.at)) return undefined;
  // ORION spoke in this chat after the outreach went: his reply answers that turn (a question asked in chat beats an older push).
  if (input.lastReplyAt !== undefined && source.at <= input.lastReplyAt) return undefined;
  const offer = offerOf(source.text);
  if (!offer || !OFFER_TAKES[offer.kind].includes(reply.kind)) return undefined;
  if (offer.kind === "start" && reply.kind === "counter" && CHANGE_VERB.test(message)) return undefined;   // "move gym to 8" is the calendar's
  if (ownRequest(message, reply, offerNames(offer))) return undefined;
  if (push) {
    const age = now.getTime() - push.at;
    if (age < 0 || age > (QUESTION_KINDS.includes(offer.kind) ? QUESTION_MS : PUSH_MS)) return undefined;
  }
  // A memo about a different thing is replaced by the outreach he is answering now.
  return { said, reply, offer, sentAt: source.at, outreachText: source.text };
}

/** Carries the pending reply out; undefined when there is nothing code can do with it (the normal turn follows). */
export function runPendingTurn(turn: PendingTurn, deps: PendingDeps): Promise<PendingOutcome | undefined> {
  return runTurn(turn, deps);
}

// ---------------------------------------------------------------- voice cut-off

const CONTINUING = /^\(Continuing\s*[—–-]+\s*my last message was cut off(?:[^")]*?"([^"]*)")?[^)]*\)\s*([\s\S]*)$/;
/**
 * The app's marker for the rest of a cut-off spoken request (AppState.send): `full` when the marker carries the whole sentence
 * ("…my full message was: "…""), `rest` the words after it. Undefined when the message is not a continuation.
 */
export function continuationOf(said: string): { full?: string; rest: string } | undefined {
  const m = said.match(CONTINUING);
  if (!m) return undefined;
  const full = m[1]?.trim();
  return { ...(full ? { full } : {}), rest: (m[2] ?? "").trim() };
}
