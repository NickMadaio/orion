// The questions ORION keeps for Nick (wave 12 L1, 2026-11-02): "for things he's unclear of he can make his own notes to ask me
// about things". One row per question in orion-controlled/questions.jsonl (eval-questions.jsonl during a sandboxed evaluation):
//
//   { id, q, why, topic, priority, by: "orion", created, status, askedAt, askCount, askedVia, askedText,
//     answer, answeredAt, fact, droppedWhy, resolvedWith, updated }
//
//   status   open → asked → answered | dropped | resolved. "asked" is still open: it waits for his reply.
//   topic    person | preference | routine | fact | other
//   priority high | normal | low; the proactive ask takes the highest, oldest first, at most one a day.
//
// Everything here is pure (rows in, new rows out) except readQuestions/updateQuestions, which lock and tmp+rename the file.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const FILE = "questions.jsonl";
export const EVAL_FILE = "eval-questions.jsonl";
export const OPEN_CAP = 20;
/** Asked this many times with no answer: never asked again by the proactive path (he can still see it and answer). */
export const IGNORED_LIMIT = 3;
export const TOPICS = ["person", "preference", "routine", "fact", "other"];
export const PRIORITIES = ["high", "normal", "low"];
const RANK = { high: 0, normal: 1, low: 2 };
const OPEN = new Set(["open", "asked"]);
// Credential shapes are never stored (the same rule orion-remember follows).
const SECRET = /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b|-----BEGIN [A-Z ]*PRIVATE KEY/;
const MAX_Q = 240, MAX_WHY = 240, MAX_ANSWER = 400;

const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const localDay = (d) => new Date(d).toLocaleDateString("en-CA");

const STOP = new Set(["the", "a", "an", "is", "are", "was", "does", "do", "did", "what", "whats", "who", "whos", "which", "when", "where",
  "how", "he", "his", "him", "nick", "nicks", "s", "to", "of", "in", "on", "at", "for", "and", "or", "it", "that", "this", "you", "your", "my"]);
const stem = (w) => { const one = w.length > 3 ? w.replace(/s$/, "") : w; return one.length > 5 ? one.replace(/ing$/, "") : one; };
/** The content words of a question, stemmed: "Does Nick prefer the gym in the mornings?" -> {prefer, gym, morning}. */
export const questionWords = (q) => new Set((String(q).toLowerCase().replace(/['’]/g, "").match(/[a-z0-9]+/g) ?? [])
  .filter((w) => !STOP.has(w)).map(stem));

/** Near-identical: the same content words, or one question's words all inside the other's with at most one extra. */
export function sameQuestion(a, b) {
  const x = questionWords(a), y = questionWords(b);
  if (!x.size || !y.size) return false;
  const shared = [...x].filter((w) => y.has(w)).length;
  const [small, large] = x.size <= y.size ? [x, y] : [y, x];
  if (shared === small.size && large.size - small.size <= 1) return true;
  return shared / new Set([...x, ...y]).size >= 0.75;
}

export const openQuestions = (rows) => rows.filter((r) => OPEN.has(r.status));
const find = (rows, id) => {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`no question ${id}`);
  return row;
};
const replace = (rows, id, change) => rows.map((r) => (r.id === id ? { ...r, ...change } : r));
const idFor = (q, now) => `q-${createHash("sha1").update(`${q}\n${now.toISOString()}`).digest("hex").slice(0, 6)}`;

function checked({ q, why, topic, priority }, partial = false) {
  const out = {};
  if (q !== undefined || !partial) {
    out.q = clean(q, MAX_Q);
    if (!out.q) throw new Error("the question is empty");
  }
  if (why !== undefined) out.why = clean(why, MAX_WHY);
  if (topic !== undefined || !partial) {
    out.topic = topic === undefined ? "other" : String(topic).toLowerCase();
    if (!TOPICS.includes(out.topic)) throw new Error(`topic must be ${TOPICS.join(", ")}`);
  }
  if (priority !== undefined || !partial) {
    out.priority = priority === undefined ? "normal" : String(priority).toLowerCase();
    if (!PRIORITIES.includes(out.priority)) throw new Error(`priority must be ${PRIORITIES.join(", ")}`);
  }
  if (SECRET.test(`${out.q ?? ""} ${out.why ?? ""}`)) throw new Error("that looks like a secret; nothing was saved");
  return out;
}

/** Add a question. A near-identical open one is returned as `duplicate` instead; a full queue throws. */
export function addQuestion(rows, input, now = new Date()) {
  const fields = checked(input);
  const duplicate = openQuestions(rows).find((r) => sameQuestion(r.q, fields.q));
  if (duplicate) return { rows, duplicate };
  if (openQuestions(rows).length >= OPEN_CAP) throw new Error(`the question list is full (${OPEN_CAP} open); answer or drop one first`);
  const added = { id: idFor(fields.q, now), why: "", ...fields, by: "orion", created: now.toISOString(), status: "open", askCount: 0, askedAt: null, answer: null };
  return { rows: [...rows, added], added };
}

/** Change the words, why, topic or priority of an open question. */
export function editQuestion(rows, id, input, now = new Date()) {
  const row = find(rows, id);
  if (!OPEN.has(row.status)) throw new Error(`${id} is ${row.status}, not open`);
  return replace(rows, id, { ...checked(input, true), updated: now.toISOString() });
}

/** His answer. `fact` is the line to keep in memory: the question and what he said. */
export function answerQuestion(rows, id, answer, now = new Date()) {
  const row = find(rows, id);
  if (row.status === "answered") throw new Error(`${id} is already answered`);
  if (!OPEN.has(row.status)) throw new Error(`${id} is ${row.status}, not open`);
  const said = clean(answer, MAX_ANSWER);
  if (!said) throw new Error("the answer is empty");
  if (SECRET.test(said)) throw new Error("that looks like a secret; nothing was saved");
  const fact = `${row.q} → ${said}`;
  return { rows: replace(rows, id, { status: "answered", answer: said, answeredAt: now.toISOString(), fact }), fact, row: { ...row, answer: said, fact } };
}

export function dropQuestion(rows, id, why = "", now = new Date()) {
  const row = find(rows, id);
  if (!OPEN.has(row.status)) throw new Error(`${id} is ${row.status}, not open`);
  return replace(rows, id, { status: "dropped", droppedWhy: clean(why, MAX_WHY), updated: now.toISOString() });
}

/** Settled without asking him (ORION found out some other way). */
export function resolveQuestion(rows, id, how = "", now = new Date()) {
  const row = find(rows, id);
  if (!OPEN.has(row.status)) throw new Error(`${id} is ${row.status}, not open`);
  return replace(rows, id, { status: "resolved", resolvedWith: clean(how, MAX_ANSWER), updated: now.toISOString() });
}

/** He was asked (a push, or listed in chat). `text` is exactly what he saw, so his reply can be matched to it. */
export function markAsked(rows, id, { via = "push", text = "" } = {}, now = new Date()) {
  const row = find(rows, id);
  if (!OPEN.has(row.status)) throw new Error(`${id} is ${row.status}, not open`);
  return replace(rows, id, { status: "asked", askedAt: now.toISOString(), askCount: (row.askCount ?? 0) + 1, askedVia: via, askedText: clean(text, 400) });
}

/** He passed on it ("idk", "ask me later"): open again, its ask still counted (so a question he keeps passing on rests). */
export function skipQuestion(rows, id, now = new Date()) {
  const row = find(rows, id);
  if (!OPEN.has(row.status)) throw new Error(`${id} is ${row.status}, not open`);
  return replace(rows, id, { status: "open", skippedAt: now.toISOString() });
}

/**
 The question to ask now, or null: one a day at most. Never-asked questions before ones he let pass (so one unanswered question does
 not crowd out the rest), then the highest priority, oldest first; never one he ignored IGNORED_LIMIT times.
*/
export function nextToAsk(rows, now = new Date()) {
  const today = localDay(now);
  if (rows.some((r) => r.askedAt && localDay(r.askedAt) === today)) return null;
  return openQuestions(rows)
    .filter((r) => (r.askCount ?? 0) < IGNORED_LIMIT)
    .sort((a, b) => (a.askCount ?? 0) - (b.askCount ?? 0) || RANK[a.priority] - RANK[b.priority] || Date.parse(a.created) - Date.parse(b.created))[0] ?? null;
}

/** The question his next message may answer: asked, not answered, within `windowMs`. Newest first. */
export function awaitingAnswer(rows, now = new Date(), windowMs = 3 * 3600_000) {
  return rows.filter((r) => r.status === "asked" && r.askedAt && now - Date.parse(r.askedAt) >= 0 && now - Date.parse(r.askedAt) <= windowMs)
    .sort((a, b) => Date.parse(b.askedAt) - Date.parse(a.askedAt))[0] ?? null;
}

// ---- file ------------------------------------------------------------------------------------------------------------------

export const questionsPath = (dir, { sandboxed = false } = {}) => join(dir, sandboxed ? EVAL_FILE : FILE);

export function readQuestions(path) {
  let text;
  try { text = readFileSync(path, "utf8"); } catch { return []; }
  return text.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try { const r = JSON.parse(line); return r && typeof r.id === "string" && typeof r.q === "string" ? [r] : []; } catch { return []; }
  });
}

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function withLock(path, fn) {
  const lock = `${path}.lock`;
  for (let i = 0; i < 300; i++) {
    try { writeFileSync(lock, String(process.pid), { flag: "wx" }); }
    catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try { if (Date.now() - statSync(lock).mtimeMs > 10_000) rmSync(lock, { force: true }); } catch { /* gone already */ }
      pause(10);
      continue;
    }
    try { return fn(); } finally { rmSync(lock, { force: true }); }
  }
  return fn();
}

/** Read-change-write under a lock. `change(rows)` returns { rows, ...anything }; the rest is returned to the caller. */
export function updateQuestions(path, change) {
  mkdirSync(join(path, ".."), { recursive: true });
  return withLock(path, () => {
    const result = change(readQuestions(path));
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, result.rows.map((r) => JSON.stringify(r)).join("\n") + (result.rows.length ? "\n" : ""));
    renameSync(tmp, path);
    return result;
  });
}
