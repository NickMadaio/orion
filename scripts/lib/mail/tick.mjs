// The mail watcher's tick (wave 14, 2026-11-02). Nick: "make sure gmail and stuff im getting passive alerts for anything that might
// be important (over time i can tell him things arent important and certain things are so he knows what to look out for)".
//
// Rides orion-watches' 5-minute tick, but polls Gmail at most every 10 minutes. Each poll:
//   1. reads the inbox's newest threads (headers and snippet only, read-only; gog.mjs)
//   2. skips what mail-seen.jsonl already has; the very first poll only learns what is there, so he is not told about last week
//   3. scores each new mail: his rules first, then signals (score.mjs); borderline mail gets the local model's opinion (model.mjs)
//   4. important mail becomes one quiet orion-reach notice (tier low, mirrored to chat), batched and spaced (alert.mjs)
// An expired sign-in is told once a day per account ("Gmail needs reconnecting", "Yahoo needs an app password"); a network failure is not told at all.
// Several accounts (wave 17, mail-accounts.json): each is polled and backed off on its own, mail from all of them goes through the one pipeline.
// Every outside thing is a dependency, so tests run it with a fake inbox, a fake model and a recording reach.
import { localDate } from "../life/live-day.mjs";
import { classifyGmailError } from "../gmail-status.mjs";
import { appendLines, mailFile, readSeen, readState, writeState } from "./files.mjs";
import { readJson } from "../awareness/io.mjs";
import { emptyPrefs } from "./prefs.mjs";
import { scoreMail, fromPerson, verifiedTeacher } from "./score.mjs";
import { alertRow, digestLine, planAlert, recentUrgent } from "./alert.mjs";
import { isSensitive, redactSensitive } from "./sensitive.mjs";

export const POLL_EVERY_MS = 10 * 60_000;
/** After failed polls the wait doubles (10, 20, 40 min), up to an hour, so a hanging or broken gog is not retried every tick. */
export const MAX_BACKOFF_MS = 60 * 60_000;
export const pollWaitMs = (failures = 0) => Math.min(POLL_EVERY_MS * 2 ** Math.max(0, (failures | 0) - 1), MAX_BACKOFF_MS);
/** Below the important band but this close: kept when the model has no opinion. */
const FALLBACK_KEEP_AT = 3;
/** Model calls per poll: 4 x the 15 s timeout stays well inside orion-watches' 2-minute budget for this tick. */
export const MAX_MODEL_CALLS = 4;
/** The original Gmail's sentence; other accounts get theirs from accounts.mjs reconnectText(). */
export const RECONNECT_TEXT = "Gmail needs reconnecting, so I can't watch your inbox right now. Running gog auth add nmadaio08@gmail.com in Terminal fixes it.";

const QUEUE_FIELDS = ["account", "accountId", "key", "threadId", "messageId", "fromName", "fromAddress", "domain", "subject", "snippet", "sensitive", "urgent", "person", "verifiedTeacher", "foundAt"];
/** What waits in mail-state.json. Sensitive mail is redacted first: its subject and snippet are never stored. */
const queued = (item) => { const safe = redactSensitive(item); return Object.fromEntries(QUEUE_FIELDS.filter((k) => safe[k] !== undefined).map((k) => [k, safe[k]])); };

/** The verdict for one item: rules, then the model for borderline ones, then the rules' fallback. */
async function judgeItem(item, { ctx, prefs, askModel, budget }) {
  const rules = scoreMail(item, { ...ctx, prefs });
  if (rules.level !== "borderline") return { ...rules, by: rules.rule ? "his rule" : "rules" };
  const ask = askModel && budget.left > 0;
  if (ask) budget.left -= 1;   // a per-poll counter, local to this tick
  const opinion = ask ? await askModel(redactSensitive(item), { prefs, reasons: rules.reasons }) : null;
  if (opinion) return { ...rules, level: opinion.important ? "important" : "skip", by: "local model", modelWhy: opinion.why };
  return { ...rules, level: rules.score >= FALLBACK_KEEP_AT ? "important" : "skip", by: "rules (model had no answer)" };
}

/** The state of one account. The original Gmail ("gmail") keeps its fields at the top of mail-state.json, as before wave 17; the rest live under accounts[id]. */
export const PRIMARY_ID = "gmail";
const sliceOf = (state, id) => id === PRIMARY_ID ? state : state.accounts?.[id] ?? {};
const patchSlice = (state, id, patch) => id === PRIMARY_ID ? { ...state, ...patch } : { ...state, accounts: { ...state.accounts, [id]: { ...(state.accounts?.[id] ?? {}), ...patch } } };
const keyPrefix = (id) => id === PRIMARY_ID ? "" : `${id}:`;
const dueIn = (state, account, now, force) => { const s = sliceOf(state, account.id); return force || !s.lastPollAt || now.getTime() - Date.parse(s.lastPollAt) >= pollWaitMs(s.failures); };

/** "expired" for a sign-in that needs Nick (an app password counts), else gmail-status's classes (a network failure is "unreachable"). */
function failureKind(account, text) {
  if (account.kind === "imap" && /app password|sign-in refused|authentication failed|keychain/i.test(text) && classifyGmailError(text) !== "unreachable") return "expired";
  return classifyGmailError(text);
}

/** Told once a day per account, and only for a sign-in that needs him. */
async function reportFailure(account, error, { state, today, reach }) {
  const kind = failureKind(account, error instanceof Error ? error.message : String(error));
  const s = sliceOf(state, account.id);
  const base = patchSlice(state, account.id, { problem: kind, failures: (s.failures ?? 0) + 1 });
  if (kind !== "expired" || s.expiredAlertedOn === today) return { state: base, said: null, kind };
  const text = account.reconnectText ?? RECONNECT_TEXT;
  const sent = await reach(text, { why: `mail: reconnect ${account.id}`, urgent: false });
  return { state: sent.ok ? patchSlice(base, account.id, { expiredAlertedOn: today }) : base, said: sent.ok ? text : null, kind };
}

/** An item from one account: its keys namespaced (except the original Gmail's), the account named in alerts only when there is more than one. */
const tag = (item, account, multi) => ({ ...item, key: `${keyPrefix(account.id)}${item.key}`, messageId: `${keyPrefix(account.id)}${item.messageId}`, accountId: account.id, ...(multi ? { account: account.label } : {}) });

/**
 * One tick.
 * deps: { dir, now, sandboxed, ctx, fetchInbox({ isSeen, firstPoll }) → items (one Gmail), or accounts: [{ id, label, kind, reconnectText, fetchInbox }], askModel, reach(text, { why, urgent }) → { ok }, force }
 * @returns {{ polled: boolean, reason?: string, fresh?: number, said?: string|null, verdicts?: object[] }}
 */
export async function mailTick(deps) {
  const { dir, now, sandboxed = false, ctx = {}, fetchInbox, askModel = null, reach, force = false } = deps;
  const accounts = deps.accounts ?? [{ id: PRIMARY_ID, label: "Gmail", kind: "gmail", fetchInbox }];
  const multi = accounts.length > 1;
  const files = { seen: mailFile(dir, "seen", { sandboxed }), state: mailFile(dir, "state", { sandboxed }), prefs: mailFile(dir, "prefs", { sandboxed }), alerts: mailFile(dir, "alerts", { sandboxed }) };
  const state = readState(files.state);
  if (!accounts.length) return { polled: false, reason: "no mailboxes configured (orion-mail-accounts add-gmail or add-imap)" };
  const due = accounts.filter((a) => dueIn(state, a, now, force));
  if (!due.length) return { polled: false, reason: `polled under ${Math.round(pollWaitMs(sliceOf(state, accounts[0]?.id).failures) / 60_000)} min ago` };
  const today = localDate(now);
  const seen = readSeen(files.seen);
  // Claimed before any fetch runs: if this process is killed mid-fetch (orion-watches' budget), the next tick still waits.
  let polledState = due.reduce((acc, a) => patchSlice(acc, a.id, { lastPollAt: now.toISOString() }), state);
  writeState(files.state, polledState);

  const isFirst = (a) => { const seeded = sliceOf(state, a.id).seeded; return seeded === undefined ? (a.id === PRIMARY_ID ? seen === null : true) : !seeded; };
  const results = await Promise.all(due.map(async (a) => {
    const firstPoll = isFirst(a);
    try { return { a, firstPoll, items: await a.fetchInbox({ isSeen: (key) => !!seen?.has(`${keyPrefix(a.id)}${key}`), firstPoll }) }; }
    catch (error) { return { a, firstPoll, error }; }
  }));

  let failureSaid = null;
  const failed = [];
  for (const r of results.filter((x) => x.error)) {
    const out = await reportFailure(r.a, r.error, { state: polledState, today, reach });
    polledState = out.state; failureSaid = failureSaid ?? out.said; failed.push({ a: r.a, kind: out.kind });
  }
  const worked = results.filter((r) => !r.error);
  if (!worked.length) {
    writeState(files.state, polledState);
    return { polled: true, reason: `${failed[0].a.id === PRIMARY_ID ? "gmail" : failed[0].a.label} ${failed[0].kind}`, said: failureSaid };
  }
  const tagged = worked.map((r) => ({ ...r, items: r.items.map((i) => tag(i, r.a, multi)) }));
  for (const r of tagged) polledState = patchSlice(polledState, r.a.id, { problem: null, failures: 0, seeded: true });
  const seedRows = tagged.filter((r) => r.firstPoll).flatMap((r) => r.items.filter((i) => i.key && !seen?.has(i.key)));
  if (seen === null || seedRows.length || tagged.some((r) => r.firstPoll)) appendLines(files.seen, seedRows.map((i) => ({ key: i.key, threadId: i.threadId, messageId: i.messageId, at: now.toISOString(), level: "seeded" })));
  const fresh = tagged.filter((r) => !r.firstPoll).flatMap((r) => r.items).filter((i) => i.key && !seen?.has(i.key));
  const seededSome = tagged.some((r) => r.firstPoll);

  const prefs = readJson(files.prefs) ?? emptyPrefs();
  const verdicts = [];
  const budget = { left: MAX_MODEL_CALLS };
  for (const item of fresh) verdicts.push({ item, verdict: await judgeItem(item, { ctx, prefs, askModel, budget }) });
  appendLines(files.seen, verdicts.map(({ item, verdict }) => ({ key: item.key, threadId: item.threadId, messageId: item.messageId, at: now.toISOString(),
    level: verdict.level, by: verdict.by, why: verdict.reasons.slice(0, 6) })));

  const important = verdicts.filter((v) => v.verdict.level === "important")
    .map(({ item, verdict }) => queued({ ...item, urgent: verdict.urgent, person: fromPerson(item), ...(verifiedTeacher(item, ctx) ? { verifiedTeacher: true } : {}), foundAt: now.toISOString() }));
  const urgentSentAt = recentUrgent(state.urgentSentAt ?? [], now);
  const plan = planAlert({ queue: state.queue ?? [], fresh: important, lastAlertAt: state.lastAlertAt ?? null, urgentSentAt, now });
  let next = { ...polledState, queue: plan.keep, urgentSentAt };
  let said = null;
  if (plan.send.length) {
    const text = digestLine(plan.send);
    const urgent = plan.urgent;
    const sent = await reach(text, { why: `mail: ${plan.send.length} important${urgent ? " (urgent)" : ""}`, urgent });
    if (sent.ok) {
      appendLines(files.alerts, [alertRow({ id: sent.id ?? `mail-${now.getTime()}`, text, items: plan.send, now })]);
      next = { ...next, lastAlertAt: now.toISOString(), queue: [], urgentSentAt: urgent ? [...urgentSentAt, now.toISOString()] : urgentSentAt };
      said = text;
    } else next = { ...next, queue: plan.send };   // not sent (a cap): tried again next poll, until it is 12 h old
  }
  writeState(files.state, next);
  const reason = seededSome && !fresh.length && !said ? "first poll: learned what is already there" : plan.reason;
  return { polled: true, fresh: fresh.length, said: said ?? failureSaid, reason, verdicts: verdicts.map(({ item, verdict }) => ({ subject: isSensitive(item) ? "(hidden: it holds a code)" : item.subject, from: item.fromAddress, ...(item.account ? { account: item.account } : {}), level: verdict.level, by: verdict.by, score: verdict.score })) };
}
