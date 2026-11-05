// One tick of one plan loop (a planned block he has not started), 2026-10-30. The rungs and their words are
// lib/reach/plan-ladder.mjs; this decides which one is due and records what happened. No I/O of its own: every outward
// step is an effect the caller (orion-checkin tick) passes in, so a test drives it with fakes and a fake clock.
//
// A plan check-in carries, besides the old fields (loop, alerts, drops, blockWindow), `ladder`:
//   { sent: [{ msgId, rung, name, at, text, channels }], grace: { at, until, reason, returning } | null, graces,
//     firm, lastAttemptAt, replan, resolution: { status, how, at, text?, replyTo? } | null }
// resolution.status: started | done | grace | replanned | asked | declared | lapsed | cancelled. ladders.json is its projection.
//
// 2026-10-31 review (one ignored Gym became 23 pushes, 4 replans, 5-min blocks and the Gym deleted): a title is displaced at
// most once a day (ctx.replannedTitles; a later END asks instead), the block a replan re-entered gets a `reprise` loop (L0,
// then the END question, nothing between), one missed sample per title per day (ladder.sampled, ctx.sampledTitles), the END
// waits out a grace, an END that never got through leaves a "what changed" line for his next open moment (fx.queue), and a
// block he started gets one gentle "still going?" at its planned end.
import { rungText, endText, noteText, comebackText, voiceText, smallerVersion, strictnessFor, avoidanceLine, capVerdict, restrictionFor,
  recordSays, replanFrom, nextGap, lateEngaged, LATE_STRETCH, rungName, legitSkip, GAPS, END_RUNG } from "./plan-ladder.mjs";
import { gymEvidence } from "../life/attendance.mjs";
import { cancels } from "../awareness/declared-facts.mjs";
import { classify } from "../life/live-day.mjs";

const MIN = 60_000;
const RETRY_MIN = 2;               // a rung that did not get through is tried again after this, not every 30 s tick
const LAPSE_AFTER_END_MIN = 180;   // a closing message about a block that ended longer ago than this is stale
const MAX_DROPS = 3;
const DROP_COOLDOWN_MIN = 30;
const COMEBACK_GAP = 10;          // after the comeback, the next rung follows as L1 follows L0
const REPRISE_GAP = GAPS.reduce((a, b) => a + b, 0);   // a reprise's END comes when a full ladder's would
const STILL_GOING_WINDOW_MIN = 60; // the "still going?" is worth asking only this soon after the block's planned end

const at = (date, minute) => { const [y, m, d] = String(date).split("-").map(Number); return new Date(y, m - 1, d, 0, minute).getTime(); };
const localDate = (ms) => new Date(ms).toLocaleDateString("en-CA");
const nowMin = (ms) => Math.floor(ms / MIN);
const minuteOfDay = (ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
const emptyLadder = () => ({ sent: [], grace: null, graces: 0, firm: false, lastAttemptAt: null, replan: null, resolution: null });

export const ladderOf = (c) => ({ ...emptyLadder(), ...(c.ladder ?? {}) });
export const kindOf = (c) => c.kind ?? classify(String(c.what ?? ""));
const withLadder = (c, patch) => ({ ...c, ladder: { ...ladderOf(c), ...patch } });
const titleKey = (c) => String(c.what ?? "").trim().toLowerCase();
/** This title was already re-planned today (by another loop): never displaced again. */
const replannedBefore = (c, ctx) => !!c.reprise || (ctx.replannedTitles ?? []).includes(titleKey(c));
/** One missed sample per title per day: record it only when no loop for this title has. */
function missedSample(c, ctx, fx) {
  if (ladderOf(c).sampled || (ctx.sampledTitles ?? []).includes(titleKey(c))) return false;
  fx.outcome?.({ what: c.what, plannedAt: blockStartMs(c), actualAt: null });
  return true;
}
const historyRow = (loop, now, event, phase) => [...(loop.history ?? []), { at: nowMin(now), event, phase }];

/** Close the loop: the phase other readers know (done, cancelled, given_up) and the resolution the state card reads. */
export function resolve(c, { status, how, nowMs, text = null, replyTo = null, phase }) {
  const loop = { ...c.loop, phase, nextCheckAt: null, history: historyRow(c.loop, nowMs, `ladder-${status}`, phase) };
  return withLadder({ ...c, loop }, { resolution: { status, how, at: new Date(nowMs).toISOString(), ...(text ? { text } : {}), ...(replyTo ? { replyTo } : {}) } });
}

/** The message id the last rung carried, so a reply names the message it answers. */
export const lastMsgId = (c) => ladderOf(c).sent.at(-1)?.msgId ?? null;

/** Every ladder message sent today, across loops: the input of the daily cap. */
export const sentToday = (checkins, nowMs) => (checkins ?? []).flatMap((c) => ladderOf(c).sent.map((s) => ({ blockId: c.block, at: s.at })))
  .filter((s) => localDate(Date.parse(s.at)) === localDate(nowMs));

function offByFact(c, ctx) {
  const facts = ctx.declared ?? [];
  const block = { id: c.block, title: c.what, kind: kindOf(c), date: localDate(ctx.nowMs) };
  return facts.find((f) => cancels([f], block)) ?? null;
}

/** Before any rung: something he said, or the gym itself, may already have settled this block. */
function settled(c, ctx, fx) {
  const fact = offByFact(c, ctx);
  if (fact) {
    // a skip with a real reason (ill, injured) is not a miss in his record; an excuse, or no reason, is (2026-10-31 policy)
    const counts = (kindOf(c) === "gym" || fact.kind === "skip") && !legitSkip(fact.text);
    const sampled = counts && missedSample(c, ctx, fx);
    const closed = resolve(c, { status: "declared", how: "declared", nowMs: ctx.nowMs, text: fact.text, phase: "cancelled" });
    return sampled ? withLadder(closed, { sampled: true }) : closed;
  }
  if (kindOf(c) !== "gym") return null;
  const seen = gymEvidence({ date: localDate(ctx.nowMs), workouts: ctx.workouts, placeId: ctx.placeId, declared: ctx.declared, now: new Date(ctx.nowMs) });
  if (!seen) return null;
  fx.outcome?.({ what: c.what, plannedAt: blockStartMs(c), actualAt: seen.at ? Date.parse(seen.at) : ctx.nowMs });
  return { ...resolve(c, { status: "done", how: `evidence:${seen.source}`, nowMs: ctx.nowMs, phase: "done" }), attended: seen };
}

const blockStartMs = (c) => (c.blockWindow ? at(c.blockWindow.date, c.blockWindow.start) : (c.dueAt ?? 0) * MIN);
const blockOver = (c, nowMs) => !!c.blockWindow && c.blockWindow.date === localDate(nowMs) && nowMs >= at(c.blockWindow.date, c.blockWindow.end);
const otherDay = (c, nowMs) => (c.blockWindow ? c.blockWindow.date !== localDate(nowMs)
  : !!c.createdAt && localDate(Date.parse(c.createdAt)) !== localDate(nowMs));

/** A grace that ends early: he declared "I ate" after asking for time to eat. */
function graceOver(c, ctx) {
  const g = ladderOf(c).grace;
  if (!g) return true;
  if (ctx.nowMs >= Date.parse(g.until)) return true;
  return g.returning === "you ate" && (ctx.declared ?? []).some((f) => f.kind === "ate" && Date.parse(f.at) >= Date.parse(g.at));
}

/** Which message is due now: a rung, the comeback after a grace, or the closing. null when nothing is. */
function due(c, ctx) {
  const ladder = ladderOf(c);
  if (ladder.lastAttemptAt && ctx.nowMs - Date.parse(ladder.lastAttemptAt) < RETRY_MIN * MIN) return null;
  if (c.retryAfter && nowMin(ctx.nowMs) < c.retryAfter) return null;
  // a grace he was given is waited out, even past the block's end: no closing message while he is eating (review finding 8)
  if (c.loop.phase === "deferred" && !graceOver(c, ctx)) return null;
  if (blockOver(c, ctx.nowMs)) return { rung: END_RUNG };
  if (c.loop.phase === "deferred") return { rung: Math.min(c.alerts ?? 0, END_RUNG - 1), comeback: true };
  if (c.loop.nextCheckAt !== null && c.loop.nextCheckAt !== undefined && nowMin(ctx.nowMs) < c.loop.nextCheckAt) return null;
  return { rung: Math.min(c.alerts ?? 0, END_RUNG) };
}

function elapsedOf(c, ctx, said) {
  if (said?.minutes !== undefined && Number.isFinite(said.minutes)) return said.minutes;
  return Math.max(0, Math.floor((ctx.nowMs - blockStartMs(c)) / MIN));
}

/** The sentence and how it goes out, for rung `rung` (or the comeback). Restriction and the replan happen here, once. */
function compose(c, ctx, fx, { rung, comeback }, said) {
  const kind = kindOf(c);
  const ladder = ladderOf(c);
  const elapsed = elapsedOf(c, ctx, said);
  const smaller = smallerVersion(c.blockWindow, minuteOfDay(ctx.nowMs));
  const strictness = strictnessFor({ record: ctx.record, blockId: c.block, kind, title: c.what, elapsed, patterns: ctx.patterns, slips: ctx.slipsToday, firm: ladder.firm });
  const blockMinutes = c.blockWindow ? c.blockWindow.end - c.blockWindow.start : null;
  if (comeback) return { strictness, text: comebackText({ title: c.what, returning: ladder.grace?.returning }), patch: { grace: null } };
  if (rung === END_RUNG) {
    // displace runs at most once per title a day: a second miss is a question, never another rewrite of the evening
    const replan = ladder.replan ?? (replannedBefore(c, ctx) ? { kind: "repeat", changes: [] } : replanFrom(fx.displace?.(c) ?? { status: 1 }, c.what));
    return { strictness, replan, text: endText({ title: c.what, start: c.blockWindow?.start, smaller, replan }), patch: { replan } };
  }
  const plan = rung === 3 ? restrictionFor({ grant: ctx.grant, activity: ctx.activity, kind, nowMs: ctx.nowMs, strictness }) : null;
  const restricted = plan && fx.restrict?.(c, plan) ? plan.step : null;
  const text = rungText({ rung, title: c.what, elapsed, smaller, strictness, blockMinutes, restricted,
    avoidance: avoidanceLine(ctx.patterns, kind, c.what), habit: ctx.habit ?? null });
  return { strictness, restricted, text, ...(rung === 2 ? { urgent: true, voice: ctx.speak ? voiceText({ title: c.what, smaller }) : null } : {}) };
}

/** After a message reached him: the rung is recorded, the loop moves on (or ends, after the closing message). */
function afterReached(c, ctx, step, msg, delivery) {
  const ladder = ladderOf(c);
  const row = { msgId: msg.msgId, rung: step.rung, name: step.comeback ? "comeback" : rungName(step.rung), at: new Date(ctx.nowMs).toISOString(), text: msg.text,
    channels: delivery.channels ?? [], strictness: msg.strictness, ...(msg.restricted ? { restricted: msg.restricted } : {}) };
  const sent = [...ladder.sent, row];
  if (step.rung === END_RUNG) {
    const status = msg.replan?.kind === "moved" ? "replanned" : "asked";
    const closed = resolve({ ...c, alerts: (c.alerts ?? 0) + 1 }, { status, how: "end", nowMs: ctx.nowMs, text: msg.text, phase: "given_up" });
    return withLadder(closed, { sent, ...msg.patch });
  }
  const level = step.rung + 1;
  // a reprise (the block a replan re-entered) is L0 and then the closing question, nothing between
  const reprise = !!c.reprise && !step.comeback;
  const gap = step.comeback ? COMEBACK_GAP : reprise ? REPRISE_GAP : nextGap(step.rung, lateEngaged(ctx) ? LATE_STRETCH : 1);
  const loop = { ...c.loop, phase: step.rung === 0 && !step.comeback ? "reminded" : "intervening", level, nextCheckAt: nowMin(ctx.nowMs) + gap,
    history: historyRow(c.loop, ctx.nowMs, step.comeback ? "comeback" : rungName(step.rung), "reminded") };
  const alerts = reprise ? END_RUNG : step.comeback ? (c.alerts ?? 0) : (c.alerts ?? 0) + 1;
  return withLadder({ ...c, loop, alerts, drops: 0, retryAfter: null, returning: null },
    { sent, lastAttemptAt: null, ...(msg.patch ?? {}), ...(step.comeback ? { resolution: null } : {}) });
}

/** A budget or the ceiling dropped a rung: skip it on a doubling cooldown; after a few, go straight to the closing message. */
function afterDropped(c, ctx, step) {
  const drops = (c.drops ?? 0) + 1;
  const retryAfter = nowMin(ctx.nowMs) + DROP_COOLDOWN_MIN * 2 ** (drops - 1);
  const alerts = drops >= MAX_DROPS ? END_RUNG : step.rung >= END_RUNG ? END_RUNG : (c.alerts ?? 0);
  return withLadder({ ...c, drops, retryAfter, alerts }, { lastAttemptAt: new Date(ctx.nowMs).toISOString() });
}

/**
 * One tick for plan loop `c`.
 * @param ctx { nowMs, record (now.json or null), declared (today's facts), patterns, slipsToday, workouts, placeId, grant,
 *              activity (focus-activity.json), speak (Mac voice allowed), held (the gate holds ORION's own lines now),
 *              graceWake (just woke), sentToday (every ladder message today), habit }
 * @param fx  { send(c, msg) -> { reached, dropped, channels }, displace(c) -> { status, stdout }, restrict(c, plan) -> bool,
 *              outcome({ what, plannedAt, actualAt }) }
 * @returns the check-in after this tick (a new object; the input is not changed)
 */
export function tickPlanLoop(c, ctx, fx = {}) {
  if (ladderOf(c).resolution && ["done", "cancelled", "given_up"].includes(c.loop?.phase)) return c;
  const done = settled(c, ctx, fx);
  if (done) return done;
  if (otherDay(c, ctx.nowMs)) return lapse(c, ctx, fx, c.blockWindow ? "yesterday's block" : "made on an earlier day");
  if (blockOver(c, ctx.nowMs) && ctx.nowMs - at(c.blockWindow.date, c.blockWindow.end) > LAPSE_AFTER_END_MIN * MIN) return lapse(c, ctx, fx, "the block is over");
  if (c.loop?.phase === "active") return stillGoing(c, ctx, fx);   // he started: one gentle check at the block's planned end
  if (ctx.held || (ctx.graceWake && c.by === "orion")) return c;
  const step = due(c, ctx);
  if (!step) return c;
  const said = recordSays(ctx.record, { blockId: c.block, nowMs: ctx.nowMs });
  if (said.verdict === "wait" && step.rung < END_RUNG) return c;
  const capped = capVerdict({ sent: ctx.sentToday ?? [], blockId: c.block, nowMs: ctx.nowMs, rung: step.rung });
  if (!capped.ok) return withLadder(c, { capped: { reason: capped.reason, at: new Date(ctx.nowMs).toISOString() } });
  const msg = { ...compose(c, ctx, fx, step, said.verdict === "go" ? said : null), msgId: `${c.id}-${step.comeback ? `CB${ladderOf(c).graces}` : rungName(step.rung)}`, rung: step.rung };
  const withReplan = msg.patch?.replan ? withLadder(c, { replan: msg.patch.replan }) : c;   // displace ran: never again for this loop
  const delivery = fx.send?.(withReplan, msg) ?? { reached: false, dropped: false };
  if (delivery.reached) {
    // the block did not happen: one planned-vs-actual sample (patterns.json) per title a day, as the old give-up recorded
    const sampled = step.rung === END_RUNG && missedSample(c, ctx, fx);
    return afterReached(sampled ? withLadder(withReplan, { sampled: true }) : withReplan, ctx, step, msg, delivery);
  }
  if (delivery.dropped) return afterDropped(withReplan, ctx, step);
  return withLadder(withReplan, { lastAttemptAt: new Date(ctx.nowMs).toISOString() });
}

/**
 * A loop that ran out of time. If its replan changed the calendar but the closing message never reached him, a short
 * "what changed" line is queued for his next open moment (fx.queue): the calendar never changes silently.
 */
function lapse(c, ctx, fx, why) {
  const ladder = ladderOf(c);
  const told = ladder.sent.some((s) => s.rung === END_RUNG);
  const changed = ladder.replan && (ladder.replan.kind === "moved" || (ladder.replan.changes ?? []).length > 0);
  const queued = !told && changed && fx.queue ? (fx.queue(c, noteText({ title: c.what, replan: ladder.replan })), true) : false;
  const closed = resolve(c, { status: "lapsed", how: "expired", nowMs: ctx.nowMs, phase: "given_up" });
  return { ...(queued ? withLadder(closed, { queuedNote: new Date(ctx.nowMs).toISOString() }) : closed), expired: why };
}

/** He started the block: once, at its planned end (and not long after), a gentle "still going?". Nothing else. */
function stillGoing(c, ctx, fx) {
  const ladder = ladderOf(c);
  if (ladder.stillAsked || !blockOver(c, ctx.nowMs) || ctx.held) return c;
  if (ctx.nowMs - at(c.blockWindow.date, c.blockWindow.end) > STILL_GOING_WINDOW_MIN * MIN) return c;
  const msg = { text: `Still going with ${c.what}? Say done when you finish.`, msgId: `${c.id}-SG`, rung: 0, still: true };
  const delivery = fx.send?.(c, msg) ?? { reached: false };
  if (!delivery.reached) return delivery.dropped ? withLadder(c, { stillAsked: new Date(ctx.nowMs).toISOString() }) : c;
  const row = { msgId: msg.msgId, rung: 0, name: "still-going", at: new Date(ctx.nowMs).toISOString(), text: msg.text, channels: delivery.channels ?? [] };
  return withLadder(c, { sent: [...ladder.sent, row], stillAsked: row.at });
}

/**
 * His answer to a ladder message (via the plugin: orion-checkin started|done|defer|cancel <id>). Returns the check-in with
 * the resolution recorded; the loop's own step (follow-through) is the caller's.
 */
export function replyResolution(c, { verb, nowMs, text = null, replyTo = null, how = "reply" }) {
  const status = { started: "started", done: "done", cancel: "cancelled" }[verb] ?? verb;
  return withLadder(c, { resolution: { status, how, at: new Date(nowMs).toISOString(), ...(text ? { text: String(text).slice(0, 200) } : {}), replyTo: replyTo ?? lastMsgId(c) } });
}

/** A legitimate pause: the grace and the comeback it promises. */
export function startGrace(c, { nowMs, minutes, returning, reason, replyTo = null }) {
  const ladder = ladderOf(c);
  const until = new Date(nowMs + minutes * MIN).toISOString();
  return withLadder(c, { grace: { at: new Date(nowMs).toISOString(), until, reason: String(reason ?? "").slice(0, 200), returning }, graces: ladder.graces + 1,
    resolution: { status: "grace", how: "reply", at: new Date(nowMs).toISOString(), text: String(reason ?? "").slice(0, 200), replyTo: replyTo ?? lastMsgId(c), until } });
}
