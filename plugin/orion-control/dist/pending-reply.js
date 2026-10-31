import { HUSH, REQUEST, offerOf, pauseThenStart, readReply } from "./pending-reply-read.js";
import { runTurn } from "./pending-reply-act.js";
import { readCrisisAt, writeCrisisAt } from "./pending-reply-crisis.js";
import { answeredIn, readAnswered, withAnswered, writeAnswered } from "./pending-reply-answered.js";
export { offerOf, readReply } from "./pending-reply-read.js";
const MEMO_MS = 60 * 60_000;
/** How long after ORION's own message a short reply is read as answering it, when the app sent no label (the state card's last push). */
const PUSH_MS = 30 * 60_000;
const QUESTION_MS = 90 * 60_000;
/** Which replies each offer carries out (anything else goes on to the normal turn, which still has the context). */
const OFFER_TAKES = {
    start: ["defer", "done", "resume", "accept", "indifferent", "decline", "counter", "awake"],
    leave: ["defer", "accept", "indifferent"],
    bedtime: ["awake", "workload", "defer", "bed"],
    catchup: ["accept", "indifferent", "counter", "decline"],
    slipped: ["accept", "indifferent", "decline", "counter"],
    brief: ["accept", "indifferent", "counter"],
    "session-done": ["accept", "next", "indifferent", "done"],
    "plan-check": ["changed", "decline", "accept", "counter"],
};
const MEMO_TAKES = {
    resume: ["resume", "done", "accept"],
    bedtime: ["awake", "workload", "defer", "bed"],
    booked: ["accept", "indifferent"],
    brief: ["accept", "counter"],
    next: ["next", "accept"],
    "move-offer": ["accept", "counter", "decline"],
};
/** How long after the crisis reply a short reply is never read as answering a nudge (the normal turn and its support line have it). */
const latest = (a, b) => (a === undefined ? b : b === undefined ? a : Math.max(a, b));
export const CRISIS_HOLD_MS = 30 * 60_000;
/**
 Per chat: the memo, when ORION last replied, and when the crisis reply went. Per state dir (every chat, across restarts): the outreach
 already answered (pending-reply-answered.ts). Without a state dir the answered record is kept in memory only.
*/
export class PendingMemory {
    memos = new Map();
    replies = new Map();
    crises = new Map();
    /** Without a state dir: every answered outreach. With one: only those whose write failed (the file is the record otherwise). */
    answered = [];
    memo(key, nowMs) { const m = this.memos.get(key); return m && nowMs - m.at < MEMO_MS ? m : undefined; }
    setMemo(key, memo) { if (memo)
        this.memos.set(key, memo);
    else
        this.memos.delete(key); }
    /**
     Records this turn (ORION answers it unless it was hushed; a crisis turn starts the hold) and returns what came before it.
     nowMs is the plugin's clock, the one outreach times are read on.
    */
    beginTurn(key, nowMs, turn, dir) {
        const lastReplyAt = this.replies.get(key);
        const crisisAt = latest(this.crises.get(key), dir ? readCrisisAt(dir) : undefined);
        const afterCrisis = turn.crisis || (crisisAt !== undefined && nowMs - crisisAt >= 0 && nowMs - crisisAt < CRISIS_HOLD_MS);
        if (turn.crisis) {
            this.crises.set(key, nowMs);
            if (dir)
                writeCrisisAt(dir, nowMs);
        }
        if (turn.replied)
            this.replies.set(key, nowMs);
        return { ...(lastReplyAt !== undefined ? { lastReplyAt } : {}), afterCrisis };
    }
    wasAnswered(text, sentAt, nowMs, dir) {
        return (dir ? answeredIn(readAnswered(dir), text, sentAt, nowMs) : false) || answeredIn(this.answered, text, sentAt, nowMs);
    }
    /**
     W5 (2026-10-31, gate run-1031224700): the state file is the record. A copy kept in memory as well outlived the file, so a state
     restored to before the answer (an undo, the gate's per-item restore) still read "answered" and the next reply bound to nothing.
    */
    markAnswered(text, sentAt, nowMs, dir) {
        if (dir && writeAnswered(dir, withAnswered(readAnswered(dir), text, sentAt, nowMs)))
            return;
        this.answered = withAnswered(this.answered, text, sentAt, nowMs);
    }
}
const QUESTION_KINDS = ["catchup", "plan-check", "brief", "slipped"];
const CHANGE_VERB = /\b(?:move|add|put|book|schedule|cancel|drop|remind|set|start|text|email|play|clear|delete|remove)\s+(?:me\s+)?(?:in\s+)?(?:my\s+|the\s+|a\s+|an\s+|some\s+)?([a-z0-9']+)/i;
/** Words a counter-offer may name after its verb without naming something else: a length, "it", "time". */
const GENERIC_OBJECT = /^(?:\d+|a|an|one|two|half|it|that|this|them|those|time|some|hour|hours|hr|min|mins|minutes|slot|block|session|both|everything|catch|catchup|tomorrow|tmrw|tonight|today|first|now)$/;
const nameWords = (names) => names.flatMap((n) => n.toLowerCase().split(/[^a-z0-9]+/)).filter((w) => w.length > 2);
const offerNames = (o) => o.kind === "brief" ? o.items : o.kind === "catchup" ? [o.subject ?? "", "catch up"] : "title" in o ? [o.title] : [];
const memoNames = (m) => (m.kind === "brief" ? m.items : "title" in m ? [m.title] : []);
/** A counter-offer that names something other than what ORION offered ("add gym tomorrow at 7" after the morning brief) is his own request. */
function ownRequest(message, reply, names) {
    if (reply.kind !== "counter")
        return false;
    const verb = message.toLowerCase().match(CHANGE_VERB);
    if (!verb)
        return false;
    const object = verb[1];
    return !GENERIC_OBJECT.test(object) && !nameWords(names).some((w) => w.startsWith(object) || object.startsWith(w));
}
/** The pending reply this message is, or undefined (the turn goes on unchanged). Pure. */
export function readPendingTurn(input) {
    const { message, now, outreach, lastPush, memo } = input;
    const explicit = pauseThenStart(message);
    const said = message.trim().slice(0, 120);
    if (explicit)
        return { said, offer: { kind: "start", title: explicit.title }, reply: { kind: "defer", activity: explicit.activity, ...(explicit.minutes ? { minutes: explicit.minutes } : {}), ...(explicit.typical ? { typical: explicit.typical } : {}) } };
    const reply = readReply(message);
    if (!reply || HUSH.test(message.toLowerCase()))
        return undefined;
    if (reply.kind !== "counter" && REQUEST.test(message.toLowerCase()))
        return undefined;
    if (memo && MEMO_TAKES[memo.kind].includes(reply.kind) && !ownRequest(message, reply, memoNames(memo)))
        return { said, reply, memo };
    const fromLabel = outreach ? { text: outreach.text, at: now.getTime() - outreach.minutes * 60_000 } : undefined;
    const push = !fromLabel && lastPush ? { text: lastPush.text, at: Date.parse(lastPush.at) } : undefined;
    const source = fromLabel ?? push;
    const planned = planDefer(said, reply);
    if (!source || Number.isNaN(source.at) || input.answered?.(source.text, source.at))
        return planned;
    const offer = offerOf(source.text);
    // ORION spoke in this chat after the outreach went: his reply answers that turn (a question asked in chat beats an older push), unless
    // his words can only answer the outreach ("fine going to bed now" after "ok one more thing" → "What is it?" answers the bedtime line).
    const onlyThatOffer = reply.kind === "bed" && offer?.kind === "bedtime";
    if (input.lastReplyAt !== undefined && source.at <= input.lastReplyAt && !onlyThatOffer)
        return planned;
    if (!offer || !OFFER_TAKES[offer.kind].includes(reply.kind))
        return planned;
    if (offer.kind === "start" && reply.kind === "counter" && CHANGE_VERB.test(message))
        return undefined; // "move gym to 8" is the calendar's
    if (ownRequest(message, reply, offerNames(offer)))
        return undefined;
    if (push) {
        const age = now.getTime() - push.at;
        if (age < 0 || age > (QUESTION_KINDS.includes(offer.kind) ? QUESTION_MS : PUSH_MS))
            return undefined;
    }
    // A memo about a different thing is replaced by the outreach he is answering now.
    return { said, reply, offer, sentAt: source.at, outreachText: source.text };
}
/**
 W5 (gate loop-eat-first): "im starving gonna eat first" with no nudge on record. A pause for something named (eating, a shower, a call)
 is him putting off what his calendar has on now; pending-reply-act.ts finds that block (started in the last half hour, not fixed) and
 grants the grace on it, or does nothing when there is none. A bare "5 more min" is not read this way (a running session's own).
*/
function planDefer(said, reply) {
    // "meal prepping for 40 min then ill do gym" names its own next step: that is a plan he is telling (reality.ts), not this.
    return reply.kind === "defer" && reply.activity && reply.typical !== undefined && !/\bthen\b/i.test(said) ? { said, reply, plan: true } : undefined;
}
/** Carries the pending reply out; undefined when there is nothing code can do with it (the normal turn follows). */
export function runPendingTurn(turn, deps) {
    return runTurn(turn, deps);
}
// ---------------------------------------------------------------- voice cut-off
const CONTINUING = /^\(Continuing\s*[—–-]+\s*my last message was cut off(?:[^")]*?"([^"]*)")?[^)]*\)\s*([\s\S]*)$/;
/**
 * The app's marker for the rest of a cut-off spoken request (AppState.send): `full` when the marker carries the whole sentence
 * ("…my full message was: "…""), `rest` the words after it. Undefined when the message is not a continuation.
 */
export function continuationOf(said) {
    const m = said.match(CONTINUING);
    if (!m)
        return undefined;
    const full = m[1]?.trim();
    return { ...(full ? { full } : {}), rest: (m[2] ?? "").trim() };
}
