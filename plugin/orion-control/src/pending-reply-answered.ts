/*
 Which of ORION's outreach messages a short reply has already been bound to (REV4 11a, 2026-10-31).

 This lived in memory per chat: an answer on the phone did not count on the Mac, and a gateway restart forgot it, so a second "yeah" could
 book the same nudge twice. Now it is one small file in the controlled state dir, shared by every chat and kept across restarts. Nothing
 else records "this outreach was answered" (outreach-injected.json is which session an outreach was injected into, not whether he answered
 it), so this is the record.

 A row is the outreach's text and when it was sent. The app's label gives "N min ago" and the card gives the exact time, so a row matches
 a sent time within a few minutes. Rows older than six hours are dropped (the card never offers an outreach older than that).
*/
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ANSWERED_FILE = "pending-answered.json";
const KEEP_MS = 6 * 3600_000;
const SAME_SEND_MS = 3 * 60_000;
const MAX_ROWS = 40;

export type AnsweredRow = { text: string; sentAt: number; answeredAt: number };

const isRow = (r: unknown): r is AnsweredRow => !!r && typeof (r as AnsweredRow).text === "string"
  && Number.isFinite((r as AnsweredRow).sentAt) && Number.isFinite((r as AnsweredRow).answeredAt);

const fresh = (rows: readonly AnsweredRow[], nowMs: number): AnsweredRow[] => rows.filter((r) => nowMs - r.answeredAt < KEEP_MS && r.answeredAt <= nowMs + SAME_SEND_MS);

export function readAnswered(dir: string): AnsweredRow[] {
  try {
    const raw = JSON.parse(readFileSync(join(dir, ANSWERED_FILE), "utf8")) as { rows?: unknown };
    return Array.isArray(raw.rows) ? raw.rows.filter(isRow) : [];
  } catch { return []; }
}

/** Whether this outreach (its text, sent at sentAt) was already answered, in `rows`. Pure. */
export function answeredIn(rows: readonly AnsweredRow[], text: string, sentAt: number, nowMs: number): boolean {
  return fresh(rows, nowMs).some((r) => r.text === text && Math.abs(r.sentAt - sentAt) <= SAME_SEND_MS);
}

/** `rows` with this outreach marked answered, old rows dropped. Pure. */
export function withAnswered(rows: readonly AnsweredRow[], text: string, sentAt: number, nowMs: number): AnsweredRow[] {
  return [...fresh(rows, nowMs), { text: text.slice(0, 600), sentAt, answeredAt: nowMs }].slice(-MAX_ROWS);
}

/** Writes the rows atomically (temp file, then rename). Best effort: a failed write leaves the caller's memory copy in charge. */
export function writeAnswered(dir: string, rows: readonly AnsweredRow[]): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `${ANSWERED_FILE}.${process.pid}.tmp`);
    writeFileSync(tmp, `${JSON.stringify({ schemaVersion: 1, rows })}\n`, { mode: 0o600 });
    renameSync(tmp, join(dir, ANSWERED_FILE));
    return true;
  } catch { return false; }
}
