/*
 The food inbox (orion-food-estimate inbox), run from orion-watch's ~5-minute tick or right after the phone link writes.

 CONTRACT (the phone app drops these into the controlled dir; fixture: tests/fixtures/food-inbox/):
   food-inbox/<id>.jpg   the photo (.jpg, .jpeg, .png, .heic or .webp; optional: a note alone is estimated from its words)
   food-inbox/<id>.json  { "id": "<id>", "at": "<ISO taken>", "note": "<what he typed, may be empty>" }
 Write the photo first and the .json LAST (atomically, via rename): the .json is the signal that the item is complete.
 <id> is [A-Za-z0-9_-]{1,64}. The watcher writes back:
   food-inbox/<id>.estimate.json  { id, ok, summary?, estimate?, error?, at }   (the phone may show it)
   food-inbox/.state.json         { done: { <id>: { at, ok } } }               (each item is estimated once)
 and sends Nick one chat message per item: "Food photo: ~650 kcal · 45P 70C 18F (…). Log it?", with the estimate
 left in food-pending.json so his "yes" in either chat logs it. Items older than a day are marked stale, not estimated.
 Never during an evaluation; at most three items per run, under food-inbox/.lock, so overlapping ticks do not double up.
*/
import { closeSync, existsSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { controlledDir } from "../clock.mjs";
import { evalMode } from "../eval-mode.mjs";
import { estimateMeal } from "./estimate.mjs";
import { readImages } from "./ollama.mjs";
import { offerLine, writePending } from "./pending.mjs";

export const INBOX_DIR = "food-inbox";
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const PHOTO_EXT = [".jpg", ".jpeg", ".png", ".heic", ".webp"];
const STALE_MS = 24 * 3600_000;
const LOCK_STALE_MS = 10 * 60_000;
export const MAX_PER_RUN = 3;

const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; } };
const writeJson = (file, value) => { const tmp = `${file}.tmp`; writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 }); renameSync(tmp, file); };

/** Complete, unprocessed items, oldest first: { id, at, note, photo? }. */
export function listNew(dir, done) {
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((n) => n.endsWith(".json") && !n.startsWith(".") && !n.endsWith(".estimate.json"))
    .map((n) => n.slice(0, -5)).filter((id) => ID.test(id) && !done[id])
    .map((id) => {
      const meta = readJson(join(dir, `${id}.json`), null);
      if (!meta || meta.id !== id) return null;
      const photo = PHOTO_EXT.map((e) => join(dir, `${id}${e}`)).find((p) => existsSync(p));
      return { id, at: typeof meta.at === "string" ? meta.at : null, note: String(meta.note ?? "").slice(0, 300), ...(photo ? { photo } : {}) };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

function takeLock(file, now) {
  try { closeSync(openSync(file, "wx")); return true; } catch {
    try { if (now - statSync(file).mtimeMs > LOCK_STALE_MS) { unlinkSync(file); closeSync(openSync(file, "wx")); return true; } } catch { /* someone else has it */ }
    return false;
  }
}

/**
 Processes the inbox once. deps: { now, env, estimate (estimateMeal), notify(text, why) → { ok } }.
 Returns { ran, items: [{ id, ok, summary?, error?, notified? }] }.
*/
export async function runInbox({ now = new Date(), env = process.env, estimate = estimateMeal, notify } = {}) {
  if (evalMode()) return { ran: false, why: "evaluation", items: [] };
  const dir = join(controlledDir(env), INBOX_DIR);
  if (!existsSync(dir)) return { ran: false, why: "no inbox", items: [] };
  const lock = join(dir, ".lock");
  if (!takeLock(lock, now.getTime())) return { ran: false, why: "another run holds the inbox", items: [] };
  try {
    const statePath = join(dir, ".state.json");
    const state = readJson(statePath, { done: {} });
    const done = { ...(state.done ?? {}) };
    const results = [];
    for (const item of listNew(dir, done).slice(0, MAX_PER_RUN)) {
      const result = await processItem(item, { now, estimate, notify, env });
      writeJson(join(dir, `${item.id}.estimate.json`), { id: item.id, at: now.toISOString(), ...result.record });
      done[item.id] = { at: now.toISOString(), ok: result.record.ok };
      writeJson(statePath, { ...state, done });
      results.push({ id: item.id, ...result.report });
    }
    return { ran: true, items: results };
  } finally { try { unlinkSync(lock); } catch { /* gone */ } }
}

async function processItem(item, { now, estimate, notify, env }) {
  const taken = item.at ? Date.parse(item.at) : Number.NaN;
  if (Number.isFinite(taken) && now.getTime() - taken > STALE_MS) return { record: { ok: false, error: "stale" }, report: { ok: false, error: "stale" } };
  let images = [];
  try { images = item.photo ? readImages([item.photo]) : []; } catch (error) { return { record: { ok: false, error: error.message }, report: { ok: false, error: error.message } }; }
  if (!images.length && !item.note) return { record: { ok: false, error: "no photo and no note" }, report: { ok: false, error: "no photo and no note" } };
  const out = await estimate({ text: item.note, images, imagePaths: item.photo ? [item.photo] : [] });
  if (!out.ok) {
    const text = `I couldn't estimate the food photo you sent: ${out.error}. Tell me what it was and I'll work it out.`;
    const sent = notify ? notify(text, `food: ${item.id}`) : { ok: false };
    return { record: { ok: false, error: out.error }, report: { ok: false, error: out.error, notified: !!sent?.ok } };
  }
  const offerText = offerLine(out.summary, "Food photo: ");
  writePending({ via: "inbox", inboxId: item.id, offerText, summary: out.summary, estimate: out.estimate,
    ...(item.note ? { text: item.note } : {}), ...(item.photo ? { photos: [item.photo] } : {}),
    ...(Number.isFinite(taken) ? { eatenAt: new Date(taken).toISOString() } : {}) }, { now, env });
  const sent = notify ? notify(offerText, `food: ${item.id}`) : { ok: false };
  return { record: { ok: true, summary: out.summary, estimate: out.estimate }, report: { ok: true, summary: out.summary, notified: !!sent?.ok } };
}
