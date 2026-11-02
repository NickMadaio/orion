// The mail watcher's tick (wave 14, 2026-11-02). Nick: "make sure gmail and stuff im getting passive alerts for anything that might
// be important (over time i can tell him things arent important and certain things are so he knows what to look out for)".
//
// Rides orion-watches' 5-minute tick, but polls Gmail at most every 10 minutes. Each poll:
//   1. reads the inbox's newest threads (headers and snippet only, read-only; gog.mjs)
//   2. skips what mail-seen.jsonl already has; the very first poll only learns what is there, so he is not told about last week
//   3. scores each new mail: his rules first, then signals (score.mjs); borderline mail gets the local model's opinion (model.mjs)
//   4. important mail becomes one quiet orion-reach notice (tier low, mirrored to chat), batched and spaced (alert.mjs)
// An expired sign-in is told once a day ("Gmail needs reconnecting"); a network failure is not told at all.
// Every outside thing is a dependency, so tests run it with a fake inbox, a fake model and a recording reach.
import { localDate } from "../life/live-day.mjs";
import { classifyGmailError } from "../gmail-status.mjs";
import { appendLines, mailFile, readSeen, readState, writeState } from "./files.mjs";
import { readJson } from "../awareness/io.mjs";
import { emptyPrefs } from "./prefs.mjs";
import { scoreMail, fromPerson } from "./score.mjs";
import { alertRow, digestLine, planAlert } from "./alert.mjs";

export const POLL_EVERY_MS = 10 * 60_000;
/** Below the important band but this close: kept when the model has no opinion. */
const FALLBACK_KEEP_AT = 3;
/** Model calls per poll: 4 x the 15 s timeout stays well inside orion-watches' 2-minute budget for this tick. */
export const MAX_MODEL_CALLS = 4;
export const RECONNECT_TEXT = "Gmail needs reconnecting, so I can't watch your inbox right now. Running gog auth add nmadaio08@gmail.com in Terminal fixes it.";

const QUEUE_FIELDS = ["key", "threadId", "messageId", "fromName", "fromAddress", "domain", "subject", "snippet", "urgent", "person", "foundAt"];
const queued = (item) => Object.fromEntries(QUEUE_FIELDS.filter((k) => item[k] !== undefined).map((k) => [k, item[k]]));

/** The verdict for one item: rules, then the model for borderline ones, then the rules' fallback. */
async function judgeItem(item, { ctx, prefs, askModel, budget }) {
  const rules = scoreMail(item, { ...ctx, prefs });
  if (rules.level !== "borderline") return { ...rules, by: rules.rule ? "his rule" : "rules" };
  const ask = askModel && budget.left > 0;
  if (ask) budget.left -= 1;   // a per-poll counter, local to this tick
  const opinion = ask ? await askModel(item, { prefs, reasons: rules.reasons }) : null;
  if (opinion) return { ...rules, level: opinion.important ? "important" : "skip", by: "local model", modelWhy: opinion.why };
  return { ...rules, level: rules.score >= FALLBACK_KEEP_AT ? "important" : "skip", by: "rules (model had no answer)" };
}

/** Told once a day, and only for an expired sign-in. */
async function reportFailure(error, { state, today, reach }) {
  const text = error instanceof Error ? error.message : String(error);
  const kind = classifyGmailError(text);
  if (kind !== "expired" || state.expiredAlertedOn === today) return { state: { ...state, problem: kind }, said: null };
  const sent = await reach(RECONNECT_TEXT, { why: "mail: reconnect", urgent: false });
  return { state: { ...state, problem: kind, ...(sent.ok ? { expiredAlertedOn: today } : {}) }, said: sent.ok ? RECONNECT_TEXT : null };
}

/**
 * One tick.
 * deps: { dir, now, sandboxed, ctx: { people, courses, schoolDomains }, fetchInbox({ isSeen, firstPoll }) → items, askModel, reach(text, { why, urgent }) → { ok } , force }
 * @returns {{ polled: boolean, reason?: string, fresh?: number, said?: string|null, verdicts?: object[] }}
 */
export async function mailTick(deps) {
  const { dir, now, sandboxed = false, ctx = {}, fetchInbox, askModel = null, reach, force = false } = deps;
  const files = { seen: mailFile(dir, "seen", { sandboxed }), state: mailFile(dir, "state", { sandboxed }), prefs: mailFile(dir, "prefs", { sandboxed }), alerts: mailFile(dir, "alerts", { sandboxed }) };
  const state = readState(files.state);
  if (!force && state.lastPollAt && now.getTime() - Date.parse(state.lastPollAt) < POLL_EVERY_MS) return { polled: false, reason: "polled under 10 min ago" };
  const today = localDate(now);
  const seen = readSeen(files.seen);
  const polledState = { ...state, lastPollAt: now.toISOString() };

  let items;
  try {
    items = await fetchInbox({ isSeen: (key) => !!seen?.has(key), firstPoll: seen === null });
  } catch (error) {
    const out = await reportFailure(error, { state: polledState, today, reach });
    writeState(files.state, out.state);
    return { polled: true, reason: `gmail ${out.state.problem}`, said: out.said };
  }

  const fresh = items.filter((i) => i.key && !seen?.has(i.key));
  if (seen === null) {
    appendLines(files.seen, fresh.map((i) => ({ key: i.key, threadId: i.threadId, messageId: i.messageId, at: now.toISOString(), level: "seeded" })));
    writeState(files.state, { ...polledState, problem: null });
    return { polled: true, reason: "first poll: learned what is already there", fresh: 0, said: null };
  }

  const prefs = readJson(files.prefs) ?? emptyPrefs();
  const verdicts = [];
  const budget = { left: MAX_MODEL_CALLS };
  for (const item of fresh) verdicts.push({ item, verdict: await judgeItem(item, { ctx, prefs, askModel, budget }) });
  appendLines(files.seen, verdicts.map(({ item, verdict }) => ({ key: item.key, threadId: item.threadId, messageId: item.messageId, at: now.toISOString(),
    level: verdict.level, by: verdict.by, why: verdict.reasons.slice(0, 6) })));

  const important = verdicts.filter((v) => v.verdict.level === "important")
    .map(({ item, verdict }) => queued({ ...item, urgent: verdict.urgent, person: fromPerson(item), foundAt: now.toISOString() }));
  const plan = planAlert({ queue: state.queue ?? [], fresh: important, lastAlertAt: state.lastAlertAt ?? null, now });
  let next = { ...polledState, problem: null, queue: plan.keep };
  let said = null;
  if (plan.send.length) {
    const text = digestLine(plan.send);
    const urgent = plan.send.some((x) => x.urgent);
    const sent = await reach(text, { why: `mail: ${plan.send.length} important${urgent ? " (urgent)" : ""}`, urgent });
    if (sent.ok) {
      appendLines(files.alerts, [alertRow({ id: sent.id ?? `mail-${now.getTime()}`, text, items: plan.send, now })]);
      next = { ...next, lastAlertAt: now.toISOString(), queue: [] };
      said = text;
    } else next = { ...next, queue: plan.send };   // not sent (a cap): tried again next poll, until it is 12 h old
  }
  writeState(files.state, next);
  return { polled: true, fresh: fresh.length, said, reason: plan.reason, verdicts: verdicts.map(({ item, verdict }) => ({ subject: item.subject, from: item.fromAddress, level: verdict.level, by: verdict.by, score: verdict.score })) };
}
