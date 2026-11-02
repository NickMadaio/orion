/*
 The nightly tidy-up of what ORION learned (wave 12, 2026-11-02). Code only, no model: like orion-daily, a tidier that needs
 a warm model is one that silently stops some night.

 Three stores, each with its own learned shape:
   vault notes (Nick.md …)   "- [category] text (YYYY-MM-DD)" under "## Learned"   orion-brain learn
   workspace USER.md         "- YYYY-MM-DD — text", one line                        orion-remember --user
   workspace memory/*.md     "- HH:MM AM — [auto] text"                             the episodic writer (episodic.ts)

 What it does, each step with a reason the log keeps:
   merge-headers     every "## Learned" section folded into the first (orion-brain added a header per fact: Nick.md had 7)
   drop-duplicate    the same fact again: the same set of words once normalised. The NEWER line stays. A fact that only adds or
                     changes a qualifier ("no study after 22" / "… on fridays") is a different fact, and both sides of a conflict stay
   drop-junk         only an untagged [auto] journal episode the live filter would not write (episode-filter.ts). A learned fact
                     with a category is never junk, however short ("[allergy] peanuts", "[name] Sam")
   drop-expired      only a fact explicitly marked temporary: "[temp]", "Temporary:" or " #temp" older than 14 days, or one carrying
                     the expiry marker "(until YYYY-MM-DD)" once that day has passed. Prose that says "until <date>" never lapses
   promote-episode   an [auto] line that states something standing ("naps at least 75 min ALWAYS") becomes a dated fact, ONCE: the
                     journal line's hash goes into a ledger, and a fact he forgot (memory-archive.jsonl) is never promoted back
 Removals are capped per run (`maxRemovals`); the rest are returned as `deferred`, a dry-run report for the next night.
 The template part of USER.md (multi-line entries) is never touched. Pure functions, except applyPlan.

 Wave 12 fixer (2026-11-02): the review found containment-as-duplicate dropped "likes team sports" for "likes tea", the junk
 rule dropped "[name] Sam", prose "until" expired real facts, and forgotten facts came back from the journal every night.
*/
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { episodeBody, isDurableEpisode, junkEpisodeLines } from "../../../plugin/orion-control/dist/episode-filter.js";

const DAY_MS = 86400_000;
export const TEMP_DAYS = 14;
const HEADER = /^#{1,6}\s/;
const LEARNED_HEADER = /^## Learned\s*$/;
const NOTE_FACT = /^- \[([a-z -]+)\]\s+(.*?)\s*\((?:said )?(\d{4}-\d{2}-\d{2})\)\s*$/i;
const USER_FACT = /^- (\d{4}-\d{2}-\d{2}) [—–-] (.+)$/;
const UNTIL_MARK = /\(until (\d{4}-\d{2}-\d{2})\)/i;   // the expiry marker ORION writes; prose "until <date>" is not one
const TEMP_TAG = /\s#temp(?=[\s.)]|$)/i;

const localDay = (d) => d.toLocaleDateString("en-CA");
const norm = (s) => s.toLowerCase().replace(/^(?:preference|rule|temporary|fact):\s*/, "").replace(/[^a-z0-9]+/g, " ").replace(/\b(?:nick|he|his)\b/g, " ").replace(/\s+/g, " ").trim();

/** The fact's own words, category, and date, from either shape; undefined for any other line. */
export function parseFact(line) {
  const n = line.match(NOTE_FACT);
  if (n) return { category: n[1].toLowerCase(), body: n[2], date: n[3] };
  const u = line.match(USER_FACT);
  if (u) return { category: /^temporary:/i.test(u[2]) ? "temp" : "fact", body: u[2], date: u[1] };
  return undefined;
}

/** Same fact twice: the same set of words once normalised, nothing more. Never containment or overlap: "likes tea" is inside
 *  "likes team sports", "no study after 22" is inside "… on fridays", and morning/evening share 5 of 6 words. */
export function sameFact(a, b) {
  const x = new Set(norm(a).split(" ").filter(Boolean)); const y = new Set(norm(b).split(" ").filter(Boolean));
  return x.size > 0 && x.size === y.size && [...x].every((w) => y.has(w));
}

/** The stable id of one journal episode, as the promotion ledger keeps it. */
export const promotionHash = (day, text) => createHash("sha1").update(`${day}\n${String(text).replace(/\s+/g, " ").trim()}`).digest("hex").slice(0, 16);

/** True when a learned line has lapsed at `now`. */
export function expired(line, now) {
  const f = parseFact(line);
  if (!f) return false;
  const until = f.body.match(UNTIL_MARK)?.[1];
  if (until) return localDay(now) > until;
  if (!/^temp(?:orary)?$/.test(f.category) && !TEMP_TAG.test(f.body)) return false;
  return now.getTime() - Date.parse(`${f.date}T00:00:00`) > TEMP_DAYS * DAY_MS;
}

/** Every "## Learned" section folded into the first one's place, entries in order. Idempotent. */
export function mergeLearnedHeaders(text) {
  const lines = text.split("\n");
  const sections = [];
  let current = null;
  const rest = [];
  lines.forEach((line) => {
    if (HEADER.test(line)) {
      current = LEARNED_HEADER.test(line) ? { entries: [] } : null;
      if (current) { sections.push(current); if (sections.length === 1) rest.push("\u0000LEARNED"); return; }
    }
    if (current) { if (line.trim()) current.entries.push(line); return; }
    rest.push(line);
  });
  if (sections.length <= 1 && !text.includes("\n\n\n")) return text;
  const entries = sections.flatMap((s) => s.entries);
  const out = rest.flatMap((l) => (l === "\u0000LEARNED" ? ["## Learned", ...entries, ""] : [l]));
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

/** A removal budget shared by one run: `take(action)` is true while removals are left, else it records the action as deferred. */
export function removalBudget(max = Infinity) {
  let left = max;
  const deferred = [];
  return { deferred, take: (action) => { if (left > 0) { left -= 1; return true; } deferred.push({ ...action, deferred: true }); return false; } };
}

/** Dedupe and expiry over a list of learned lines; `at` maps back to the caller's line numbers. No junk rule here (see header). */
function tidyFacts(items, now, budget = removalBudget()) {
  const actions = [];
  const kept = [];
  for (const item of items) {
    const f = parseFact(item.line);
    if (!f) { kept.push(item); continue; }
    if (expired(item.line, now)) {
      const action = { action: "drop-expired", line: item.line, at: item.at, reason: UNTIL_MARK.test(f.body) ? "its (until …) date has passed" : `temporary, older than ${TEMP_DAYS} days` };
      if (budget.take(action)) { actions.push(action); continue; }
      kept.push(item); continue;
    }
    const twin = kept.findIndex((k) => parseFact(k.line) && sameFact(parseFact(k.line).body, f.body));
    if (twin === -1) { kept.push(item); continue; }
    const other = kept[twin];
    const otherFact = parseFact(other.line);
    // The newer one stays (in the earlier one's place); the older never wins over it.
    const newer = f.date >= otherFact.date;
    const action = newer
      ? { action: "drop-duplicate", line: other.line, at: other.at, reason: `same as the newer "${f.body}" (${f.date})` }
      : { action: "drop-duplicate", line: item.line, at: item.at, reason: `same as the newer "${otherFact.body}" (${otherFact.date})` };
    if (!budget.take(action)) { kept.push(item); continue; }
    actions.push(action);
    if (newer) kept[twin] = { ...item };
  }
  return { kept, actions };
}

/** A vault note: headers merged, facts tidied, episodes promoted into its single "## Learned". */
export function consolidateNote(text, { now, promote = [], budget = removalBudget() }) {
  const actions = [];
  const sectionCount = (text.match(/^## Learned\s*$/gm) ?? []).length;
  const merged = mergeLearnedHeaders(text);
  if (sectionCount > 1) actions.push({ action: "merge-headers", line: "## Learned", at: text.split("\n").findIndex((l) => LEARNED_HEADER.test(l)), reason: `${sectionCount} "## Learned" headers folded into one` });
  const lines = merged.split("\n");
  const start = lines.findIndex((l) => LEARNED_HEADER.test(l));
  if (start === -1 && !promote.length) return { text: merged, actions };
  let end = start + 1;
  while (start !== -1 && end < lines.length && !HEADER.test(lines[end])) end++;
  const section = start === -1 ? [] : lines.slice(start + 1, end).filter((l) => l.trim());
  // Line numbers in the file as it was: the merged section keeps every entry in its original order.
  const positions = [];
  let inside = false;
  text.split("\n").forEach((l, i) => { if (HEADER.test(l)) inside = LEARNED_HEADER.test(l); else if (inside && l.trim()) positions.push(i); });
  const { kept, actions: tidied } = tidyFacts(section.map((line, i) => ({ line, at: positions.length === section.length ? positions[i] : -1 })), now, budget);
  actions.push(...tidied);
  const promoted = [];
  const ledger = [];
  for (const p of promote) {
    const body = p.text.replace(/\s+/g, " ").trim();
    const entry = { hash: p.hash ?? promotionHash(p.day, body), day: p.day, text: body };
    if ([...kept, ...promoted].some((k) => parseFact(k.line) && sameFact(parseFact(k.line).body, body))) { ledger.push({ ...entry, outcome: "present" }); continue; }
    const line = `- [said] ${body} (${p.day})`;
    promoted.push({ line });
    ledger.push({ ...entry, outcome: "promoted" });
    actions.push({ action: "promote-episode", line, at: -1, reason: `standing statement from the ${p.day} journal` });
  }
  const body = [...kept, ...promoted].map((k) => k.line);
  const out = start === -1
    ? [...lines.slice(0, lines.length - (lines.at(-1) === "" ? 1 : 0)), "", "## Learned", ...body, ""]
    : [...lines.slice(0, start + 1), ...body, ...(end < lines.length ? [""] : []), ...lines.slice(end)];
  return { text: `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`, actions, ledger };
}

/** USER.md: only learned one-line dated bullets (no indented continuation) are deduplicated or expired. */
export function consolidateUser(text, { now, budget = removalBudget() }) {
  const lines = text.split("\n");
  const learned = lines.flatMap((line, at) => (USER_FACT.test(line) && !/^\s+\S/.test(lines[at + 1] ?? "") ? [{ line, at }] : []));
  const { actions } = tidyFacts(learned, now, budget);
  const drop = new Set(actions.map((a) => a.at));
  return { text: lines.filter((_, i) => !drop.has(i)).join("\n"), actions };
}

/** One day's journal: [auto] lines to drop (episode-filter's rule) and the standing ones worth promoting. */
export function durableEpisodes(text, budget = removalBudget()) {
  const junk = junkEpisodeLines(text).map((j) => ({ action: "drop-junk", line: j.line, at: j.index, reason: `journal: ${j.reason}` }));
  const dropped = new Set(junk.map((d) => d.at));   // junk is never promoted, removed now or deferred
  const drop = junk.filter((a) => budget.take(a));
  const keep = text.split("\n").flatMap((line, at) => {
    const body = episodeBody(line);
    return body !== undefined && !dropped.has(at) && isDurableEpisode(body) ? [{ text: body.trim(), at }] : [];
  });
  return { keep, drop };
}

const backupNameOf = (path) => path.replace(/^\/+/, "").replace(/[\\/ ]+/g, "_");

/** Every vault note with a "## Learned" section, Nick.md first (promotions go there). */
function vaultNotes(vault) {
  const me = join(vault, "20 Areas", "Me");
  const learned = join(vault, "20 Areas", "Learned");
  const list = (dir) => (existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".md")).sort().map((n) => join(dir, n)) : []);
  const notes = [...list(me), ...list(learned)].filter((p) => /^## Learned\s*$/m.test(readFileSync(p, "utf8")) || basename(p) === "Nick.md");
  return notes.sort((a, b) => (basename(b) === "Nick.md") - (basename(a) === "Nick.md"));
}

/** The whole night's plan: which files change, how, and why. Reads only.
 *  promoted   hashes already in the promotion ledger (never promoted again)
 *  forgotten  texts of facts he forgot (memory-archive.jsonl, still archived): never promoted back
 *  maxRemovals  removals this run may make; the rest come back as `deferred` (report only) */
export function planConsolidation({ workspace, vault, now, promoted = new Set(), forgotten = [], maxRemovals = Infinity }) {
  const budget = removalBudget(maxRemovals);
  const files = [];
  const ledger = [];
  const deferred = [];
  let seen = 0;
  const add = (path, before, after, actions) => {
    deferred.push(...budget.deferred.slice(seen).map((a) => ({ ...a, file: path })));
    seen = budget.deferred.length;
    if (before !== after && actions.length) files.push({ path, before, after, actions, backupName: backupNameOf(path) });
  };
  const memory = join(workspace, "memory");
  const promote = [];
  for (const name of existsSync(memory) ? readdirSync(memory).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)).sort() : []) {
    const path = join(memory, name);
    const before = readFileSync(path, "utf8");
    const { keep, drop } = durableEpisodes(before, budget);
    const day = name.slice(0, 10);
    for (const k of keep) {
      const hash = promotionHash(day, k.text);
      if (promoted.has(hash)) continue;
      if (forgotten.some((f) => sameFact(f, k.text))) { ledger.push({ hash, day, text: k.text, outcome: "forgotten", file: path }); continue; }
      promote.push({ text: k.text, day, hash });
    }
    const gone = new Set(drop.map((d) => d.at));
    add(path, before, before.split("\n").filter((_, i) => !gone.has(i)).join("\n"), drop);
  }
  const user = join(workspace, "USER.md");
  if (existsSync(user)) { const before = readFileSync(user, "utf8"); const r = consolidateUser(before, { now, budget }); add(user, before, r.text, r.actions); }
  vaultNotes(vault).forEach((path, i) => {
    const before = readFileSync(path, "utf8");
    const r = consolidateNote(before, { now, budget, promote: i === 0 && basename(path) === "Nick.md" ? promote : [] });
    add(path, before, r.text, r.actions);
    ledger.push(...r.ledger.map((l) => ({ ...l, file: path })));
  });
  return {
    files,
    actions: files.flatMap((f) => f.actions.map((a) => ({ ...a, file: f.path }))),
    deferred,
    ledger,
  };
}

export const isRemoval = (a) => /^drop-/.test(a.action);
const writeAtomic = (path, text) => { const tmp = `${path}.${process.pid}.consolidate.tmp`; writeFileSync(tmp, text); renameSync(tmp, path); };

/**
 Writes the plan, every file copied into `backupDir` first; nothing is written if a backup fails. Each file is read again just
 before its write and left alone if it changed since planning (a concurrent `orion-brain learn` must never be lost: the next run
 plans from the new text). Writes are tmp + rename. With `ledgerPath`, promotions in written files, and episodes found already
 present or forgotten, go into the promotion ledger so the same journal line is never promoted twice.
*/
export function applyPlan(plan, { backupDir, ledgerPath } = {}) {
  mkdirSync(backupDir, { recursive: true });
  for (const f of plan.files) copyFileSync(f.path, join(backupDir, f.backupName));
  const written = [];
  const skipped = [];
  for (const f of plan.files) {
    let current;
    try { current = readFileSync(f.path, "utf8"); } catch { skipped.push(f.path); continue; }
    if (current !== f.before) { skipped.push(f.path); continue; }
    writeAtomic(f.path, f.after);
    written.push(f.path);
  }
  const rows = (plan.ledger ?? []).filter((l) => l.outcome !== "promoted" || written.includes(l.file));
  if (ledgerPath && rows.length) {
    const at = new Date().toISOString();
    mkdirSync(dirname(ledgerPath), { recursive: true });
    appendFileSync(ledgerPath, rows.map((r) => JSON.stringify({ at, hash: r.hash, day: r.day, outcome: r.outcome, text: r.text })).join("\n") + "\n");
  }
  return { written, skipped };
}

/** Hashes already in the promotion ledger. A missing or torn ledger reads as what it can. */
export function readLedger(ledgerPath) {
  let text = "";
  try { text = readFileSync(ledgerPath, "utf8"); } catch { return new Set(); }
  return new Set(text.split("\n").flatMap((l) => { try { const h = JSON.parse(l).hash; return typeof h === "string" ? [h] : []; } catch { return []; } }));
}
