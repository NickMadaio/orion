// A scenario turn's `replyToOutreach` is the TEXT of the nudge Nick is answering ('ORION: "Leave in 13 min..."').
// In real use that nudge is a row in outreach.jsonl and the app builds the [ORION context: ...] prefix from it.
// This module turns each distinct text into a synthetic row (the plugin's reach-<ms>-<hex6> schema) so the
// premise "ORION just said X" is actually applied. A value that is already a real id is left alone.
import { createHash } from "node:crypto";

export const REAL_ID = /^reach-\d+-[0-9a-f]{6}$/;
export const DEFAULT_AGE_MIN = 5;

/** 'ORION: "Leave now."' / 'ORION morning brief: "..."' -> 'Leave now.' */
export function messageText(raw) {
  const s = String(raw).trim().replace(/^ORION(?:\s[^:"]{0,30})?:\s*/, "");
  const q = s.match(/^"([\s\S]*)"$/);
  return (q ? q[1] : s).trim();
}

const hex6 = (s) => createHash("sha1").update(s).digest("hex").slice(0, 6);

/** Minutes before `nowMs` the message was sent, from the item's notes; null when the notes say nothing usable. */
export function ageFromNotes(notes, nowMs, { sandbox }) {
  if (typeof notes !== "string") return null;
  const ago = notes.match(/(\d{1,3})\s*min(?:utes)?\s+ago/i);
  if (ago) return Number(ago[1]);
  if (!sandbox) return null;   // a clock time in the notes belongs to the sandbox clock, not the real one
  // Times inside the quoted nudge ("Leave ... for MKTG2201 at 1:30 PM.") are its content, not when it was sent.
  const unquoted = notes.replace(/"[^"]*"/g, " ").replace(/\u201c[^\u201d]*\u201d/g, " ");
  const at = unquoted.match(/\bat\s+(\d{1,2}):(\d{2})\s*(am|pm)?\b/i);
  if (!at) return null;
  const now = new Date(nowMs);
  let hour = Number(at[1]);
  if (at[3]) hour = (hour % 12) + (at[3].toLowerCase() === "pm" ? 12 : 0);
  let target = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, Number(at[2]));
  if (target > nowMs) target -= 86_400_000;
  return Math.round((nowMs - target) / 60_000);
}

/** One outreach row, in the shape the live outreach writers produce (an unanswered nudge: no ask, not held). */
export function outreachRow({ text, atMs, index = 0 }) {
  return {
    id: `reach-${atMs}-${hex6(`${text}|${atMs}|${index}`)}`, at: new Date(atMs).toISOString(), text,
    kind: /\?\s*$/.test(text) ? "question" : "checkin", why: "gate: seeded outreach", channel: "mac-bubble",
    reason: "gate fixture", urgent: false, headphones: false,
  };
}

/**
 * Seed plan for one item. Returns a NEW plan (appends + applied extended), the rows, and `replyTo(value)` -> the id to send.
 * `nowMs` is the item's effective now: the sandbox clock for a sandboxed item, the real clock for a live one.
 */
export function seedOutreach(item, plan, nowMs) {
  const texts = [...new Set(item.turns.map((t) => t.replyToOutreach).filter((v) => typeof v === "string" && v !== "" && !REAL_ID.test(v)))];
  if (!texts.length) return { plan, rows: [], replyTo: (v) => v ?? null };
  const age = ageFromNotes(item.setup?.notes, nowMs, { sandbox: Boolean(plan.sandbox) }) ?? DEFAULT_AGE_MIN;
  // Later messages are newer: one minute apart, the last one `age` minutes before now.
  const rows = texts.map((raw, i) => outreachRow({ text: messageText(raw), atMs: nowMs - (age + (texts.length - 1 - i)) * 60_000, index: i }));
  const ids = new Map(texts.map((raw, i) => [raw, rows[i].id]));
  return {
    plan: { ...plan, appends: [...(plan.appends ?? []), { file: "outreach.jsonl", text: rows.map((r) => `${JSON.stringify(r)}\n`).join("") }],
      applied: [...plan.applied, ...rows.map((r) => `outreach:${r.id}`)] },
    rows,
    replyTo: (v) => (v == null ? null : ids.get(v) ?? v),
  };
}
