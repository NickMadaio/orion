// What headed the spoken morning brief each day (2026-10-30). "Top of your list: finish resume and Student oyster card" led
// 11 of 12 briefs (10-17 to 10-28) while both kept slipping. With the heads kept, topOfList (lib/life/morning-brief.mjs)
// turns a third day in a row into "this keeps slipping - give it a time today, or drop it?".
// File: brief-heads.json in the state dir, { schemaVersion: 1, heads: [{ date, head }] } (head is an itemKey), 21 days kept.
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "../awareness/io.mjs";

export const HEADS_FILE = "brief-heads.json";
const KEEP = 21;

/** Earlier days' heads, newest first (today's own entry is left out, so a re-run of today's brief does not count twice). */
export function readHeads(dir, today) {
  const file = readJson(join(dir, HEADS_FILE));
  const heads = file?.schemaVersion === 1 && Array.isArray(file.heads) ? file.heads : [];
  return heads.filter((h) => h?.date && h.date < today).sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Today's head, replacing any earlier entry for today. A null head is recorded too: it breaks a streak. */
export function recordHead(dir, today, head) {
  const file = readJson(join(dir, HEADS_FILE));
  const heads = (file?.schemaVersion === 1 && Array.isArray(file.heads) ? file.heads : []).filter((h) => h?.date && h.date !== today);
  const next = [...heads, { date: today, head: head ?? null }].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-KEEP);
  writeJsonAtomic(dir, HEADS_FILE, { schemaVersion: 1, heads: next });
}
