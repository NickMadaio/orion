// The only reader of live history for routine learning. Read-only, tolerant: a missing file is "no evidence".
// Seams: ORION_CONTROLLED_DIR (controlled dir), ORION_SESSIONS_DIR (gateway transcripts).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readJson } from "../awareness/io.mjs";
import { readKnownPlaces, matchPlace } from "../awareness/places.mjs";
import { readLedger } from "../curiosity/ledger.mjs";
import { fixesOf, sleepCells, cellOf } from "./episodes.mjs";
import { ownWords } from "./statements.mjs";
import { readAnswers } from "./store.mjs";
import { localDate, minuteOf } from "./time.mjs";
import { WINDOW_DAYS } from "./learn.mjs";

export const sessionsDir = (env = process.env) => env.ORION_SESSIONS_DIR || join(homedir(), ".openclaw/agents/main/sessions");
const ANSWER_WINDOW_MS = 90 * 60_000;

const jsonl = (path) => { try { return readFileSync(path, "utf8").split("\n").flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } }); } catch { return []; } };

export const homeKnownIn = (places) => (places ?? []).some((p) => p.id === "home" || p.kind === "home");

/** Home test: the known home place only; a learned guess (where the phone charges overnight) only when no home is known. */
export function homeTest(places, fixes) {
  const atHome = (f) => { const p = matchPlace({ lat: f.lat, lon: f.lon }, places); return !!p && (p.id === "home" || p.kind === "home"); };
  if (homeKnownIn(places)) return atHome;
  const cells = new Set(sleepCells(fixes));
  return (f) => atHome(f) || cells.has(`${f.lat.toFixed(3)},${f.lon.toFixed(3)}`);
}

/** A known place's name for a coarse cell (only when one place sits in it), else null. */
export const placeNamer = (places) => (cell) => {
  const hits = (places ?? []).filter((p) => Number.isFinite(p.lat) && cellOf(p.lat, p.lon) === cell && p.id !== "home");
  return hits.length === 1 ? `at ${hits[0].name ?? hits[0].id}` : null;
};

/** His messages to ORION (gateway transcripts of the last `days`), replayed eval prompts left out. */
export function readMessages(dir, { now = new Date(), days = WINDOW_DAYS } = {}) {
  if (!existsSync(dir)) return [];
  const since = now.getTime() - days * 86_400_000;
  const rows = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".jsonl") && !x.includes("trajectory"))) {
    try { if (statSync(join(dir, f)).mtimeMs < since) continue; } catch { continue; }
    for (const e of jsonl(join(dir, f))) {
      if (e?.message?.role !== "user" || Date.parse(e.timestamp) < since) continue;
      const text = ownWords(e.message.content);
      if (text) rows.push({ at: e.timestamp, text, session: f });
    }
  }
  // the same words in 3+ sessions is a replayed test script, not something he said three times
  const sessionsOf = rows.reduce((m, r) => m.set(r.text, (m.get(r.text) ?? new Set()).add(r.session)), new Map());
  return rows.filter((r) => sessionsOf.get(r.text).size < 3).map(({ at, text }) => ({ at, text }));
}

/** Answers to asks: the first message he sent within 90 min after an answered ask carries that ask's window. */
export function answersToAsks(asks, messages) {
  return (asks ?? []).filter((a) => a.answeredAt && a.window?.date && a.outcome !== "nothing").flatMap((a) => {
    const at = Date.parse(a.at);
    const reply = messages.filter((m) => Date.parse(m.at) > at && Date.parse(m.at) <= at + ANSWER_WINDOW_MS).sort((x, y) => Date.parse(x.at) - Date.parse(y.at))[0];
    return reply ? [{ ...reply, window: a.window, askId: a.askId }] : [];
  });
}

/** When he woke, per date (minutes): WHOOP first, else the phone's "up". */
export function wakesOf({ nights = [], sleepLog = [] }) {
  const out = {};
  const put = (iso) => { const t = new Date(iso); if (Number.isNaN(t.getTime())) return; const d = localDate(t), m = minuteOf(t); if (m >= 180 && m < 15 * 60 && !(out[d] <= m)) out[d] = m; };
  nights.forEach((n) => put(n?.wokeAt));
  sleepLog.filter((e) => e?.event === "up").forEach((e) => put(e.at));
  return out;
}

const NIGHT_OUT_TITLE = /\b(club|clubbing|party|pub|bar|rave|drinks|gig|concert|night out)\b/i;
/** Evening calendar events whose title says night out: corroboration only ({ date, label, start, end }). */
export const nightOutEvents = (rows) => (rows ?? []).filter((r) => r?.date && Number.isFinite(r.start) && r.start >= 17 * 60 && NIGHT_OUT_TITLE.test(String(r.title ?? "")))
  .map((r) => ({ date: r.date, label: String(r.title).match(NIGHT_OUT_TITLE)[1].toLowerCase(), start: r.start, end: r.end }));

const label = (title) => String(title ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Everything the learner reads, in one object. `calendar`: optional [{ date, title, start, end, source }] rows of his own events.
 * @returns { fixes, isHome, placeName, sessions, activities, wakes, messages, asks, answers, counts }
 */
export function gatherEvidence({ dir, now = new Date(), env = process.env, calendar = [] }) {
  const health = readJson(join(dir, "health-log.json")) ?? {};
  const places = readKnownPlaces(dir);
  const fixes = fixesOf(health.phoneSignals);
  const sessions = jsonl(join(dir, "focus-history.jsonl")).filter((r) => Number(r.servedFocusSeconds) >= 20 * 60)
    .map((r) => ({ start: r.startedAt, end: r.endedAt })).filter((s) => !Number.isNaN(Date.parse(s.start)) && !Number.isNaN(Date.parse(s.end)));
  const logged = jsonl(join(dir, "logged.jsonl")).filter((r) => r.date && Number.isFinite(r.start) && Number.isFinite(r.end))
    .map((r) => ({ date: r.date, label: label(r.title), start: r.start, end: r.end, source: "logged" }));
  // The calendar is what was PLANNED, never what he did: it only corroborates a night out (an evening event titled club, party...)
  const corroborations = nightOutEvents(calendar);
  const messages = readMessages(sessionsDir(env), { now });
  const asks = readLedger(dir).asks;
  return {
    fixes, isHome: homeTest(places, fixes), homeKnown: homeKnownIn(places), placeName: placeNamer(places), sessions,
    activities: logged.filter((a) => a.label), corroborations,
    wakes: wakesOf({ nights: readJson(join(dir, "sleep-actual.json"))?.nights ?? [], sleepLog: health.sleepLog ?? [] }),
    sleeps: (readJson(join(dir, "sleep-actual.json"))?.nights ?? []).map((n) => n?.fellAsleep).filter((t) => !Number.isNaN(Date.parse(t))),
    messages, askReplies: answersToAsks(asks, messages), answers: readAnswers(dir),
    counts: { fixes: fixes.length, sessions: sessions.length, logged: logged.length, calendar: corroborations.length, messages: messages.length },
  };
}
