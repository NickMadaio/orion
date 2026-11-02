// The estimates ORION has offered to log and is waiting on a yes for (orion-food-estimate --offer, --entry --offer, the food inbox).
//
// CONTRACT: <controlled dir>/food-pending.json = { offers: [offer, …] }, oldest first, each kept by its own id (wave 14 review:
// one slot meant three phone photos overwrote each other). An offer:
//   { id, at: ISO offered, expiresAt: ISO, via: "chat"|"inbox", inboxId?, name, offerText, summary, meal?, target?: { entryId },
//     text?, photos?: [path], eatenAt?, estimate }
// The older single-object file is read as one offer. The plugin (food-chat.ts) reads it to bind "yes" / "the burger" / "no" /
// "it was a small one", and runs `orion-food-estimate log-pending [--pick "<words>"]`, `discard` or `--revise`; nothing else writes it.
// Never written during an evaluation (eval-mode marker): an offer made then is said, not kept, so a gate never leaves one behind.
import { readFileSync, renameSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { controlledDir } from "../clock.mjs";
import { evalMode } from "../eval-mode.mjs";

export const PENDING_FILE = "food-pending.json";
export const CHAT_OFFER_MS = 30 * 60_000;
/** A photo from the phone is answered when he next looks, so its offer waits longer. */
export const INBOX_OFFER_MS = 3 * 3600_000;
/** More than this many waiting offers is a backlog nobody will answer: the oldest go. */
const MAX_OFFERS = 6;
export const pendingPath = (env = process.env) => join(controlledDir(env), PENDING_FILE);

/** "cheeseburger and fries", "a, b +2": what the offer is called when ORION names it back. */
export function mealName(estimate) {
  const names = (estimate?.items ?? []).map((i) => String(i.name ?? "").toLowerCase()).filter(Boolean);
  return names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(" and ") || "meal";
}

function readAll(env) {
  try {
    const raw = JSON.parse(readFileSync(pendingPath(env), "utf8"));
    const offers = Array.isArray(raw?.offers) ? raw.offers : raw && typeof raw === "object" && raw.estimate ? [raw] : [];
    return offers.filter((o) => o && typeof o === "object");
  } catch { return []; }
}

const isLive = (row, now) => !!row?.estimate && Date.parse(row.expiresAt) > now.getTime();

function writeAll(offers, env) {
  mkdirSync(controlledDir(env), { recursive: true });
  const tmp = `${pendingPath(env)}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tmp, JSON.stringify({ offers }, null, 2), { mode: 0o600 });
  renameSync(tmp, pendingPath(env));
}

/**
 * Keeps an offer beside the others. `replaces`: the id of the offer this one revises (it takes that one's place). Returns the row;
 * during an evaluation nothing is written and the row carries `saved: false`.
 */
export function writePending(offer, { now = new Date(), env = process.env, replaces = null } = {}) {
  const ttl = offer.via === "inbox" ? INBOX_OFFER_MS : CHAT_OFFER_MS;
  const { id: _id, at: _at, expiresAt: _exp, saved: _saved, ...rest } = offer;   // a revised offer is a new offer, with its own id and clock
  const row = { ...rest, name: mealName(offer.estimate), id: `fp-${randomUUID().slice(0, 8)}`, at: now.toISOString(), expiresAt: new Date(now.getTime() + ttl).toISOString() };
  if (evalMode()) return { ...row, saved: false };
  const kept = readAll(env).filter((o) => isLive(o, now) && o.id !== replaces);
  writeAll([...kept, row].slice(-MAX_OFFERS), env);
  return row;
}

/** Every live offer, oldest first. */
export const livePending = ({ now = new Date(), env = process.env } = {}) => readAll(env).filter((o) => isLive(o, now));

/** One live offer: by id, else the newest; null when there is none. */
export function readPending({ now = new Date(), env = process.env, id = null } = {}) {
  const live = livePending({ now, env });
  return (id ? live.find((o) => o.id === id) : live.at(-1)) ?? null;
}

/** Drops the offers with these ids (all of them with no ids). */
export function clearPending({ env = process.env, ids = null, now = new Date() } = {}) {
  if (evalMode()) return;
  const left = ids ? readAll(env).filter((o) => isLive(o, now) && !ids.includes(o.id)) : [];
  if (left.length) { writeAll(left, env); return; }
  try { unlinkSync(pendingPath(env)); } catch { /* none */ }
}

const ORDINALS = { first: 0, "1st": 0, one: 0, second: 1, "2nd": 1, two: 1, third: 2, "3rd": 2, three: 2 };
const STOP = new Set(["the", "a", "an", "one", "log", "add", "that", "this", "it", "please", "pls", "yes", "yeah", "and", "with", "meal", "food"]);

/** Which live offers his words pick: "both" / "all of them", "the first", or the ones whose name shares a word with what he said. */
export function pickOffers(offers, said) {
  const s = String(said ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(?:both|all|every|everything)\b/.test(s)) return offers;
  if (/\blast\b/.test(s)) return offers.slice(-1);
  const ordinal = s.split(" ").map((w) => ORDINALS[w]).find((n) => n !== undefined);
  if (ordinal !== undefined && offers[ordinal] && !s.split(" ").some((w) => w.length >= 3 && !STOP.has(w) && !(w in ORDINALS))) return [offers[ordinal]];
  const want = s.split(" ").filter((w) => w.length >= 3 && !STOP.has(w));
  if (!want.length) return [];
  const stem = (w) => w.replace(/(?:es|s)$/, "");
  return offers.filter((o) => {
    const have = `${o.name ?? ""} ${o.text ?? ""} ${(o.estimate?.items ?? []).map((i) => i.name).join(" ")}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem);
    return want.some((w) => have.some((h) => h === stem(w) || (stem(w).length >= 4 && h.includes(stem(w)))));
  });
}

/** "~650 kcal · … Log it?" — the line that goes to Nick. */
export const offerLine = (summary, prefix = "") => `${prefix}${summary}. Log it?`;
