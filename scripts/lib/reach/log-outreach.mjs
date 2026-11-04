// Record a message ORION already sent by another route (Discord, a banner, a check-in alert) as outreach, so it is in the
// phone's chat line and the Mac's chat, and Nick's reply is read against it (2026-11-02, W10-A1).
//
// Two writes, no notification: a row in outreach.jsonl (what reply-context reads) and a line in outreach-outbox.jsonl with
// push:false (LinkEngine turns it into the phone thread record and the Mac chat message, and never an alert).
// Idempotent per id: the same message logged twice is one row.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { chatText } from "./chat-text.mjs";

const KINDS = ["reminder", "warning", "update", "question", "info", "morning", "checkin"];

export function outreachId(nowMs, id) {
  return id && /^[A-Za-z0-9._:-]{1,80}$/.test(id) ? id : `reach-${nowMs}-${randomUUID().slice(0, 6)}`;
}

/** Whether a row with this id was logged within the last 10 minutes (a retry), not on some earlier day that reused the id. */
function logged(file, id, nowMs) {
  if (!existsSync(file)) return false;
  return readFileSync(file, "utf8").split("\n").some((l) => {
    try { const r = JSON.parse(l); return r.id === id && Math.abs(nowMs - Date.parse(r.at)) < 10 * 60_000; } catch { return false; }
  });
}

/**
 * @returns {{ ok: boolean, id?: string, duplicate?: boolean, reason?: string, entry?: object }}
 */
export function logOutreach(dir, { text, kind = "info", why = null, channel = "logged", id = null, now = new Date(), ask = null, level = null, at = null } = {}) {
  if (!String(text ?? "").trim()) return { ok: false, reason: "empty text" };
  // The chat shows a sentence for a person: job output is refused, notify headers are stripped, times are 12-hour (lib/reach/chat-text.mjs).
  const body = chatText(text);
  if (!body) return { ok: false, reason: "internal job output is not a chat message" };
  const row = outreachId(now.getTime(), id);
  const log = join(dir, "outreach.jsonl");
  mkdirSync(dir, { recursive: true });
  if (logged(log, row, now.getTime())) return { ok: true, id: row, duplicate: true };
  // `at`: when the message really reached him (a phone notification mirrored hours later), so the thread keeps its true time.
  const when = at instanceof Date && !Number.isNaN(at.getTime()) && at.getTime() <= now.getTime() ? at : now;
  const entry = { id: row, at: when.toISOString(), text: body, kind: KINDS.includes(kind) ? kind : "info", why: why ?? null,
    channel: String(channel).slice(0, 40) || "logged", reason: "already sent by another route", urgent: false, urgentKind: null, alreadySent: true,
    ...(ask ? { ask, askId: ask.askId ?? row } : {}), ...(Number.isFinite(level) ? { level } : {}) };
  appendFileSync(log, `${JSON.stringify(entry)}\n`);
  appendFileSync(join(dir, "outreach-outbox.jsonl"), `${JSON.stringify({ id: row, text: body, kind: entry.kind, push: false, urgent: false, timeSensitive: false,
    ...(ask ? { ask, askId: entry.askId, category: "orion.ask" } : {}) })}\n`);
  return { ok: true, id: row, entry };
}

/** The id a check-in alert has in the phone thread (OutreachThread.entry(fromCheckin:)), so a reply to its notification binds exactly. */
export const checkinThreadId = (alert) => `checkin-${alert.id}-${Number.isFinite(alert.level) ? Math.trunc(alert.level) : 1}`;

/** Log check-in / watcher alerts as outreach under their thread ids. Best effort: never throws. */
export function logCheckinAlerts(dir, alerts, { now = new Date(), why = "checkin" } = {}) {
  for (const a of alerts ?? []) {
    try { if (a?.id && a?.text) logOutreach(dir, { text: a.text, kind: "checkin", why, channel: "phone", id: checkinThreadId(a), now, level: a.level ?? 1 }); } catch { /* best effort */ }
  }
}
