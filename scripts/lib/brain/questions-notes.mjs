// ORION's own notes (wave 12 L1, 2026-11-02): "obv he can create, edit, delete his own notes".
//
// Provenance is a tag on the line itself, so it survives any copy of the vault: a learned bullet ORION wrote on his own
// account (an answer to one of his questions, or `orion-brain learn --own`) ends in " #orion" before its date:
//
//   - [guess] probably lifts on tuesdays #orion (2026-11-02)
//
// Only those lines may be edited or unlearned by ORION (orion-brain edit / unlearn). Nick's ANSWER to one of ORION's questions is
// his words, not ORION's: it carries #answer instead (fixer, 2026-11-02), is read and recalled like any fact, and only Nick can
// change it, through the guarded forget. An [answer] line is never ORION's own even if an older build tagged it #orion.
//
//   - [answer] Who is Sam? → my gym buddy #answer (2026-11-02)
//
// A line without the tag is Nick's (he
// asked ORION to keep it) or the system's (seeded observations, USER.md, the journal) and stays code-only: forgetting it
// still needs his own words (knowledge-run.ts). Unlearning archives like `forget --apply`, so nothing is ever lost outright.
import { appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { archiveEntries, displayText, listEntries } from "./forget.mjs";

export const OWN_TAG = "#orion";
export const ANSWER_TAG = "#answer";
const OWN = /\s#orion(?=\s|$)/;
const ANSWER_LINE = /^\s*-\s+(?:\d{4}-\d{2}-\d{2}\s*[—–-]\s*|\d{1,2}:\d{2}(?:\s*[AP]M)?\s*[—–-]\s*)?\[answer\]|\s#answer(?=\s|$)/i;
export const NICK_NOTE = "20 Areas/Me/Nick.md";
export const nickNotePath = (vaultDir) => join(vaultDir, NICK_NOTE);

export const isOwn = (raw) => OWN.test(String(raw)) && !ANSWER_LINE.test(String(raw));
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const day = (d) => new Date(d).toLocaleDateString("en-CA");

/** One learned bullet, the shape orion-brain learn writes; `own` adds ORION's provenance tag, `answer` Nick's answer tag. */
export const learnedLine = (category, text, date, { own = false, answer = false } = {}) =>
  `- [${category}] ${text}${answer ? ` ${ANSWER_TAG}` : own ? ` ${OWN_TAG}` : ""} (${date})`;

/**
 The note with `line` at the end of its LAST "## Learned" section (before whatever heading follows it, e.g. "## Relations"); a new
 section at the end only when the note has none. Never a second header: appending "## Learned" whenever a check missed it is how the
 live Nick note grew seven of them (wave 12, coordinator finding).
*/
export function appendLearned(note, line) {
  const lines = String(note ?? "").replace(/\s+$/, "").split("\n");
  if (lines.length === 1 && lines[0] === "") return `## Learned\n${line}\n`;
  const start = lines.reduce((at, l, i) => (/^##\s+Learned\b/i.test(l) ? i : at), -1);
  if (start < 0) return `${lines.join("\n")}\n\n## Learned\n${line}\n`;
  const next = lines.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l));
  let end = next < 0 ? lines.length : next;
  while (end - 1 > start && lines[end - 1].trim() === "") end -= 1;   // after the section's last bullet, not its trailing blank lines
  return `${[...lines.slice(0, end), line, ...lines.slice(end)].join("\n")}\n`;
}

const titleOf = (text) => text.match(/^---\n[\s\S]*?^title:\s*(.+?)\s*$[\s\S]*?^---/m)?.[1]?.replace(/^["']|["']$/g, "");
function* mdFiles(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* mdFiles(p);
    else if (e.name.endsWith(".md")) yield p;
  }
}

/** The note file for a title on disk: its frontmatter title, else its file name (case-insensitive), or null. */
export function findNoteFile(vaultDir, title) {
  const want = String(title).trim().toLowerCase();
  let byName = null;
  for (const path of mdFiles(vaultDir)) {
    const text = readOr(path, "");
    if (titleOf(text)?.toLowerCase() === want) return path;
    if (!byName && basename(path, ".md").toLowerCase() === want) byName = path;
  }
  return byName;
}

/** Add a learned line to an existing note on disk (under its one "## Learned" header). Null when the note does not exist. */
export function learnIntoNote(vaultDir, title, line) {
  const path = findNoteFile(vaultDir, title);
  if (!path) return null;
  writeAtomic(path, appendLearned(readOr(path, ""), line));
  return { path, line };
}

const writeAtomic = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.own.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
};
const readOr = (path, fallback) => { try { return readFileSync(path, "utf8"); } catch { return fallback; } };
const NEW_NOTE = "---\ntitle: Nick\ntype: person\npermalink: 20-areas-me/nick\n---\n\n# Nick\n";

/** His answer, kept in his Nick note as HIS line (#answer, never #orion). The recall path (memory-facts.ts learnedLines) reads it back. */
export function foldAnswer({ vaultDir, fact, date }) {
  const text = clean(fact, 480).replace(/\s#(?:orion|answer)\b/gi, " ").trim();   // a typed tag must not change whose line it is
  if (!text) throw new Error("nothing to keep");
  const path = nickNotePath(vaultDir);
  const line = learnedLine("answer", text, date, { answer: true });
  writeAtomic(path, appendLearned(readOr(path, NEW_NOTE), line));
  return { written: true, path, line };
}

/** ORION's own entries, with the ids forget/unlearn/edit use and their words without the tag. */
export function ownEntries(dirs) {
  return listEntries(dirs).filter((e) => isOwn(e.raw)).map((e) => ({ ...e, text: e.text.replace(OWN, "").trim() }));
}

/** Archive ORION's own entries by id. Ids that name Nick's or system entries are refused, unknown ids are missing. */
export function unlearnOwn(dirs, ids, now = new Date()) {
  const all = listEntries(dirs);
  const known = new Set(all.map((e) => e.id));
  const own = new Set(all.filter((e) => isOwn(e.raw)).map((e) => e.id));
  const mine = ids.filter((id) => own.has(id));
  const result = mine.length ? archiveEntries(dirs, mine, now) : { archived: [], missing: [] };
  return {
    archived: result.archived.map((a) => ({ ...a, text: String(a.text).replace(OWN, "").trim() })),
    refused: ids.filter((id) => known.has(id) && !own.has(id)),
    missing: ids.filter((id) => !known.has(id) || result.missing.includes(id)),
  };
}

const idOf = (file, raw) => createHash("sha1").update(`${file}\n${raw}`).digest("hex").slice(0, 10);

/**
 The edited line in its own store's shape, so listing still finds it (fixer: a USER.md or journal line rewritten as a vault bullet
 vanished). vault "- [cat] text #orion (today)"; USER.md "- today — [Label: ]text #orion"; journal "- <same time> — [[auto] ]text #orion".
*/
function rewrittenLine(entry, text, now) {
  const raw = entry.raw;
  if (entry.store === "vault") return learnedLine(raw.match(/^-\s+\[([\w -]{1,30})\]/)?.[1] ?? "note", text, day(now), { own: true });
  const user = raw.match(/^-\s+\d{4}-\d{2}-\d{2}\s*([—–-])\s*((?:[A-Z][a-z]{2,20}:\s+)?)/);
  if (user) return `- ${day(now)} ${user[1]} ${user[2]}${text} ${OWN_TAG}`;
  const journal = raw.match(/^-\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)\s*([—–-])\s*((?:\[[\w -]{1,30}\]\s+)?)/i);
  if (journal) return `- ${journal[1]} ${journal[2]} ${journal[3]}${text} ${OWN_TAG}`;
  throw new Error(`${entry.id} is in a shape ORION cannot rewrite safely; nothing was changed`);
}

/** Rewrite one of ORION's own entries in place, keeping its category and tag, dated today. The old line is archived. */
export function editOwn(dirs, id, newText, now = new Date()) {
  const entry = listEntries(dirs).find((e) => e.id === id);
  if (!entry) throw new Error(`no saved entry ${id}`);
  if (!isOwn(entry.raw)) throw new Error(`${id} is not one of ORION's own notes; only Nick can change it`);
  const text = clean(newText, 480);
  if (!text) throw new Error("the new text is empty");
  const raw = rewrittenLine(entry, text, now);
  const base = entry.store === "vault" ? dirs.vaultDir : dirs.workspaceDir;
  const path = join(base, entry.file);
  const lines = readOr(path, "").split("\n");
  if (lines[entry.index] !== entry.raw) throw new Error(`${id} changed while it was being edited; nothing was changed`);
  mkdirSync(dirs.controlledDir, { recursive: true });
  appendFileSync(join(dirs.controlledDir, "memory-archive.jsonl"), `${JSON.stringify({ id, store: entry.store, file: entry.file, line: entry.index + 1, raw: entry.raw, archivedAt: now.toISOString(), editedTo: idOf(`${entry.store}:${entry.file}`, raw) })}\n`);
  writeAtomic(path, lines.map((l, i) => (i === entry.index ? raw : l)).join("\n"));
  return { edited: { id: idOf(`${entry.store}:${entry.file}`, raw), text }, previous: { id, text: displayText(entry.raw).replace(OWN, "").trim() } };
}
