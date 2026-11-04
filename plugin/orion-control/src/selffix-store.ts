/*
 ORION's fix offers about his own mistakes, as the plugin reads them (w19 selffix, 2026-11-04). selffix.json is written only by
 scripts/orion-selffix; this side reads which offer his message may be answering. Every reader is total: a missing or broken file is no offers.
*/
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type FixItem = { id: string; signature: string; title: string; status: string; offeredAt?: string; createdAt?: string; startedAt?: string; remindAt?: string; projectId?: string; diagnosis?: { failingExample?: { message?: string } } };

export const OFFER_ANSWER_MS = 3 * 3600_000;
export const REMINDER_ANSWER_MS = 6 * 3600_000;

export function readFixItems(stateDir: string): FixItem[] {
  try {
    const s = JSON.parse(readFileSync(join(stateDir, "selffix.json"), "utf8")) as { items?: unknown };
    return Array.isArray(s.items) ? (s.items as FixItem[]).filter((i) => i && typeof i.id === "string" && typeof i.status === "string") : [];
  } catch { return []; }
}

const at = (iso: string | undefined): number => { const t = Date.parse(iso ?? ""); return Number.isNaN(t) ? 0 : t; };

/** The newest offer waiting for "now or later?", asked in the last 3 h. */
export const openOffer = (items: FixItem[], now: Date): FixItem | undefined =>
  items.filter((i) => i.status === "offered" && now.getTime() - at(i.offeredAt) >= 0 && now.getTime() - at(i.offeredAt) < OFFER_ANSWER_MS).sort((a, b) => at(b.offeredAt) - at(a.offeredAt))[0];

/** A parked project whose reminder fired in the last 6 h: "yes" to the reminder starts it. */
export const dueParked = (items: FixItem[], now: Date): FixItem | undefined =>
  items.filter((i) => i.status === "parked" && i.projectId && at(i.remindAt) <= now.getTime() && now.getTime() - at(i.remindAt) < REMINDER_ANSWER_MS).sort((a, b) => at(b.remindAt) - at(a.remindAt))[0];

/** Any parked project (for "start the fix project" said unprompted). */
export const parkedAny = (items: FixItem[]): FixItem | undefined => items.filter((i) => i.status === "parked" && i.projectId).sort((a, b) => at(b.remindAt) - at(a.remindAt))[0];
