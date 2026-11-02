// The estimate ORION has offered to log and is waiting on a yes for (orion-food-estimate --offer, the food inbox).
//
// CONTRACT: <controlled dir>/food-pending.json, one object, the newest offer only (a new offer replaces the old):
//   { id, at: ISO offered, expiresAt: ISO, via: "chat"|"inbox", inboxId?, offerText, summary, meal?, target?: { entryId },
//     text?, photos?: [path], estimate }
// The plugin (food-chat.ts) reads it to bind "yes" / "log it" / "no" / "it was a small one" to this offer, and runs
// `orion-food-estimate log-pending` or `--revise "<correction>"`; nothing else writes it.
import { readFileSync, renameSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { controlledDir } from "../clock.mjs";

export const PENDING_FILE = "food-pending.json";
export const CHAT_OFFER_MS = 30 * 60_000;
/** A photo from the phone is answered when he next looks, so its offer waits longer. */
export const INBOX_OFFER_MS = 3 * 3600_000;
export const pendingPath = (env = process.env) => join(controlledDir(env), PENDING_FILE);

export function writePending(offer, { now = new Date(), env = process.env } = {}) {
  const ttl = offer.via === "inbox" ? INBOX_OFFER_MS : CHAT_OFFER_MS;
  const { id: _id, at: _at, expiresAt: _exp, ...rest } = offer;   // a revised offer is a new offer, with its own id and clock
  const row = { ...rest, id: `fp-${randomUUID().slice(0, 8)}`, at: now.toISOString(), expiresAt: new Date(now.getTime() + ttl).toISOString() };
  mkdirSync(controlledDir(env), { recursive: true });
  const tmp = `${pendingPath(env)}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tmp, JSON.stringify(row, null, 2), { mode: 0o600 });
  renameSync(tmp, pendingPath(env));
  return row;
}

/** The live offer, or null when there is none or it has expired. */
export function readPending({ now = new Date(), env = process.env } = {}) {
  try {
    const row = JSON.parse(readFileSync(pendingPath(env), "utf8"));
    return row && Date.parse(row.expiresAt) > now.getTime() && row.estimate ? row : null;
  } catch { return null; }
}

export function clearPending({ env = process.env } = {}) {
  try { unlinkSync(pendingPath(env)); } catch { /* none */ }
}

/** "~650 kcal · … Log it?" — the line that goes to Nick. */
export const offerLine = (summary, prefix = "") => `${prefix}${summary}. Log it?`;
