// The estimates ORION has offered to log and is waiting on a yes for (orion-food-estimate --offer, --entry --offer, the food inbox).
//
// CONTRACT: <controlled dir>/food-pending.json = { offers: [offer, …] }, oldest first, each kept by its own id (wave 14 review:
// one slot meant three phone photos overwrote each other). An offer:
//   { id, at: ISO offered, expiresAt: ISO, via: "chat"|"inbox", inboxId?, name, offerText, summary, meal?, target?: { entryId },
//     text?, photos?: [path], eatenAt?, estimate, logged?: { id } }
// `logged` marks an offer that is not waiting on a yes: the photo was already written to the health log (entry `id`) and the offer only
// stays so a reply in the next 30 minutes edits that entry in place ("Logged ~630 kcal — …. Fix anything?"). yes keeps it, no leaves it.
// The older single-object file is read as one offer. The plugin (food-chat.ts) reads it to bind "yes" / "the burger" / "no" /
// "it was a small one", and runs `orion-food-estimate log-pending [--pick "<words>"]`, `discard` or `--revise`; nothing else writes it.
// Every change is read-modify-write under food-pending.json.lock (O_EXCL, stale after 15 s, the same scheme as health-log.json's lock in
// log.mjs), because the detached inbox run and the plugin's log-pending race. Logging claims an offer (claimPending removes it under the
// lock) BEFORE it writes the meal, so the same offer id can never log twice; a failed log puts the offer back (restorePending).
// Never written during an evaluation (eval-mode marker): an offer made then is said, not kept, so a gate never leaves one behind.
import { readFileSync, renameSync, unlinkSync, writeFileSync, mkdirSync, openSync, closeSync, statSync } from "node:fs";
import { macroWords } from "./macros.mjs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { controlledDir } from "../clock.mjs";
import { evalMode } from "../eval-mode.mjs";

export const PENDING_FILE = "food-pending.json";
export const CHAT_OFFER_MS = 30 * 60_000;
/** A photo from the phone is answered when he next looks, so its offer waits longer. */
export const INBOX_OFFER_MS = 3 * 3600_000;
/** A photo already logged for him stays open to a correction this long ("it was 2 slices", "undo"). */
export const LOGGED_OFFER_MS = 30 * 60_000;
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

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Runs `body` holding the pending file's lock; waits up to 6 s, and breaks a lock older than 15 s (a crashed holder). */
export function withPendingLock(body, env = process.env) {
  const lock = `${pendingPath(env)}.lock`; const deadline = Date.now() + 6000;
  mkdirSync(controlledDir(env), { recursive: true });
  for (;;) {
    try { closeSync(openSync(lock, "wx")); break; } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try { if (Date.now() - statSync(lock).mtimeMs > 15000) unlinkSync(lock); } catch { /* raced: retry */ }
      if (Date.now() > deadline) throw new Error("the pending offers stayed busy; try again");
      sleep(15);
    }
  }
  try { return body(); } finally { try { unlinkSync(lock); } catch { /* already gone */ } }
}

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
  const ttl = offer.logged ? LOGGED_OFFER_MS : offer.via === "inbox" ? INBOX_OFFER_MS : CHAT_OFFER_MS;
  const { id: _id, at: _at, expiresAt: _exp, saved: _saved, ...rest } = offer;   // a revised offer is a new offer, with its own id and clock
  const row = { ...rest, name: mealName(offer.estimate), id: `fp-${randomUUID().slice(0, 8)}`, at: now.toISOString(), expiresAt: new Date(now.getTime() + ttl).toISOString() };
  if (evalMode()) return { ...row, saved: false };
  withPendingLock(() => {
    const kept = readAll(env).filter((o) => isLive(o, now) && o.id !== replaces);
    writeAll([...kept, row].slice(-MAX_OFFERS), env);
  }, env);
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
  withPendingLock(() => {
    const left = ids ? readAll(env).filter((o) => isLive(o, now) && !ids.includes(o.id)) : [];
    if (left.length) { writeAll(left, env); return; }
    try { unlinkSync(pendingPath(env)); } catch { /* none */ }
  }, env);
}

/** Takes these live offers out of the file and returns the ones this caller got: a second caller asking for the same id gets nothing. */
export function claimPending(ids, { env = process.env, now = new Date() } = {}) {
  if (evalMode()) return livePending({ now, env }).filter((o) => ids.includes(o.id));
  return withPendingLock(() => {
    const live = readAll(env).filter((o) => isLive(o, now));
    const got = live.filter((o) => ids.includes(o.id));
    if (got.length) clearPendingLocked(live.filter((o) => !ids.includes(o.id)), env);
    return got;
  }, env);
}

/** Puts claimed offers back (a log that failed), oldest first, without duplicating an id. */
export function restorePending(offers, { env = process.env, now = new Date() } = {}) {
  if (evalMode() || !offers.length) return;
  withPendingLock(() => {
    const have = readAll(env).filter((o) => isLive(o, now));
    const back = offers.filter((o) => !have.some((h) => h.id === o.id));
    writeAll([...have, ...back].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-MAX_OFFERS), env);
  }, env);
}

function clearPendingLocked(left, env) {
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

/** "Logged ~630 kcal — pizza slice, pineapple topping: 36P 64C 25F. Fix anything?" (verb "Updated" after a correction). */
export function loggedLine(entry, estimate, verb = "Logged") {
  const kcal = entry.calories >= 100 ? Math.round(entry.calories / 10) * 10 : entry.calories;
  const names = [...new Set((estimate?.items ?? []).map((i) => String(i.name).toLowerCase()))];
  const what = names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3} more` : names.join(", ");
  return `${verb} ~${kcal} kcal — ${what || entry.title.toLowerCase()}: ${macroWords({ p: entry.protein, c: entry.carbohydrates, f: entry.fat })}. Fix anything?`;
}

/** The newest live offer that is an already-logged photo: what a correction is about, wherever it sits among the open offers. */
export const loggedOffer = (live) => live.findLast((o) => o.logged) ?? null;
/** The offers still waiting on a yes or no (not already logged): what a bare yes or no answers. */
export const openOffers = (live) => live.filter((o) => !o.logged);
