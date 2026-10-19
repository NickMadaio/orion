// A to-do that Nick himself let slip on 2+ different days in the last 3 days cools down (2026-10-19): it is not planned
// again automatically; he is asked once whether he wants it today or later. Read from slips.jsonl; never silent.
// Only his own slips count (gave up on it, or did something else instead): never ones ORION caused (no-room, bumped:*).
// His "today" clears it (cooldown-clears.json, kept apart from slips.jsonl so the nightly review never reads it).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { controlledDir } from "./slips.mjs";

const day = (iso) => Date.parse(`${iso}T00:00:00Z`);
export const norm = (t) => String(t ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const NICK_DRIVEN = new Set(["gave-up", "reality"]);   // reality: he logged something else instead (log --instead)
const clearsFile = () => join(controlledDir(), "cooldown-clears.json");

export function readClears() { try { return JSON.parse(readFileSync(clearsFile(), "utf8")); } catch { return {}; } }
export function clearCooldown(title, date, at) {
  const file = clearsFile(); mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify({ ...readClears(), [norm(title)]: { date, at } }, null, 2)); renameSync(`${file}.tmp`, file);
}

/** @returns {{ days: number } | null} null when the to-do has not slipped (by his doing) on enough different days */
export function cooldownOf(title, slips, date, { days = 3, times = 2, clears = {} } = {}) {
  const from = day(date) - days * 86400000;
  const cleared = clears[norm(title)];
  const rows = slips.filter((r) => r?.date && day(r.date) >= from && day(r.date) < day(date) && norm(r.planned?.title) === norm(title)
    && NICK_DRIVEN.has(r.reason) && !(cleared && (r.date < cleared.date || (r.date === cleared.date && String(r.at) <= String(cleared.at)))));
  const distinct = new Set(rows.map((r) => r.date)).size;
  return distinct >= times ? { days: distinct } : null;
}

/** The one question about a cooled-down to-do, in his words. */
export function cooldownAsk(title, { days }) {
  const text = `${title} has slipped ${days} days`;
  return `${text[0].toUpperCase()}${text.slice(1)} — want it today, or later this week?`;
}
