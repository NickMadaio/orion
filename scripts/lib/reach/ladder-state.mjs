// ladders.json (2026-10-30): today's plan-block ladders, for the chat state card and anything else that reads what ORION
// is chasing and how it ended. A projection of checkins.json, rewritten by orion-checkin on every save; never edited by
// hand and never read back by orion-checkin. Sibling of now.json in the state dir.
//
// Contract, schemaVersion 1 (docs/design/2026-10-30-escalation-ladder.md):
//   { schemaVersion: 1, computedAt: ISO, date: "YYYY-MM-DD",
//     ladders: [{ id, blockId, title, kind, window: { date, start, end } | null, rung: "L0".."END" | null, strictness,
//                 status: open|grace|started|done|replanned|asked|declared|lapsed|cancelled,
//                 messages: [{ msgId, rung, name, at, text, channels }],
//                 grace: { at, until, reason, returning } | null,
//                 resolution: { status, how, at, text?, replyTo?, until? } | null }],
//     attended: [{ date, blockId, title, source, at }] }
// `msgId` is the askId the message carried (outreach.jsonl, the phone/Mac thread row), so a reply names what it answers.
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "../awareness/io.mjs";
import { ladderOf, kindOf } from "./plan-loop.mjs";
import { rungName } from "./plan-ladder.mjs";

export const LADDERS_FILE = "ladders.json";
export const LADDERS_VERSION = 1;
const localDate = (ms) => new Date(ms).toLocaleDateString("en-CA");

function statusOf(c) {
  const r = ladderOf(c).resolution;
  if (r?.status) return r.status;
  if (c.loop?.phase === "active") return "started";
  if (c.loop?.phase === "done") return "done";
  if (c.loop?.phase === "cancelled") return "cancelled";
  if (c.loop?.phase === "given_up") return "lapsed";
  return "open";
}

function row(c) {
  const l = ladderOf(c);
  const last = l.sent.at(-1);
  return { id: c.id, blockId: c.block, title: c.what, kind: kindOf(c), window: c.blockWindow ?? null,
    rung: last ? last.name === "comeback" ? rungName(last.rung) : last.name : null, strictness: last?.strictness ?? null,
    status: statusOf(c), messages: l.sent, grace: l.grace ?? null, resolution: l.resolution ?? null };
}

const today = (c, date) => (c.blockWindow?.date ?? (c.createdAt ? localDate(Date.parse(c.createdAt)) : null)) === date;

/** The view for `nowMs`'s day. Pure. */
export function laddersView({ checkins = [], attended = [], nowMs }) {
  const date = localDate(nowMs);
  return { schemaVersion: LADDERS_VERSION, computedAt: new Date(nowMs).toISOString(), date,
    ladders: checkins.filter((c) => c.block && today(c, date)).map(row),
    attended: (attended ?? []).filter((a) => a.date === date) };
}

export const writeLadders = (dir, view) => writeJsonAtomic(dir, LADDERS_FILE, view);

/** The last view written, or null (missing, or another schemaVersion). */
export function readLadders(dir) {
  const v = readJson(join(dir, LADDERS_FILE));
  return v && v.schemaVersion === LADDERS_VERSION ? v : null;
}
