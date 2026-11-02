// What ORION has saved about Nick, line by line, and a reversible way to forget one (wave 6, 2026-11-01).
//
// Gate run-1101003318 kno-forget-v/c: "get rid of the stuff you saved about frozen" ran a note search, leaked its error and
// deleted nothing, because nothing could. Saved memories live in three places, each one bullet per line:
//   - the brain vault: bullets under a "## Learned" heading (orion-brain learn writes them, mostly into the "Nick" note);
//   - workspace USER.md: dated single-line bullets ("- 2026-10-31 — …", orion-remember --user);
//   - workspace memory/<day>.md: timed bullets ("- 09:31 PM — …", orion-remember and the journal).
// Forgetting archives: the line leaves its file and goes, with where it came from, into orion-controlled/memory-archive.jsonl,
// so `restore` can put it back. Nothing is ever deleted outright, and only whole single-line entries are touched.
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const STOP = new Set([
  "the", "and", "that", "this", "those", "these", "about", "with", "from", "for", "you", "your", "yours", "my", "mine", "me",
  "saved", "save", "saving", "noted", "note", "notes", "remembered", "remember", "memory", "memories", "entry", "entries", "line",
  "lines", "fact", "facts", "thing", "things", "stuff", "something", "anything", "everything", "random", "junk", "earlier", "one",
  "ones", "said", "told", "say", "tell", "some", "all", "any", "was", "were", "had", "has", "have", "her", "his", "him", "them",
  "they", "it", "its", "what", "which", "who", "nick", "pls", "please", "abt", "bout", "just", "again", "thingy", "bit",
]);
const stem = (w) => (w.length > 5 ? w.replace(/(?:ing|ed|es|s|e)$/, "") : w.replace(/(?:s)$/, ""));
/** Content words of a phrase, stemmed: "introducing carol to something" -> ["introduc", "carol"]. */
export const keyStems = (text) => [...new Set((String(text).toLowerCase().replace(/(\w)-(\w)/g, "$1$2").match(/[a-z0-9]+/g) ?? [])
  .filter((w) => w.length >= 3 && !STOP.has(w)).map(stem))];

/** Every query stem appears in the entry (as a word prefix either way, so "introducing" finds "introduce"). */
export function entryMatches(entryText, query) {
  const want = keyStems(query);
  if (!want.length) return false;
  const have = (String(entryText).toLowerCase().replace(/(\w)-(\w)/g, "$1$2").match(/[a-z0-9]+/g) ?? []).map(stem);
  return want.every((q) => have.some((h) => h.startsWith(q) || (h.length >= 4 && q.startsWith(h))));
}

/** The words of a saved line, without its bullet, category tag, timestamp or trailing date. */
export const displayText = (raw) => String(raw).replace(/^\s*-\s+/, "")
  .replace(/^\d{4}-\d{2}-\d{2}\s*[—–-]\s*/, "").replace(/^\d{1,2}:\d{2}(?:\s*[AP]M)?\s*[—–-]\s*/i, "")
  .replace(/^\[auto\]\s*/i, "").replace(/^\[[\w -]{1,30}\]\s*/, "").replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, "").replace(/\s+#orion$/, "").trim();   // #orion: ORION's own line (questions-notes.mjs)

const idOf = (file, raw) => createHash("sha1").update(`${file}\n${raw}`).digest("hex").slice(0, 10);
const continues = (next) => /^\s{2,}\S/.test(next ?? "");

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".md")) yield p;
  }
}

const safeRead = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

function vaultEntries(vaultDir) {
  const out = [];
  for (const abs of walk(vaultDir)) {
    const text = safeRead(abs);
    if (text === null || !/^##\s+Learned\b/im.test(text)) continue;
    const rel = relative(vaultDir, abs);
    const title = text.match(/^title:\s*(.+)$/m)?.[1]?.trim() || rel.replace(/\.md$/, "").split("/").pop();
    let inLearned = false;
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (/^##\s/.test(line)) { inLearned = /^##\s+Learned\b/i.test(line); return; }
      if (inLearned && /^-\s+\S/.test(line) && !continues(lines[i + 1])) out.push({ store: "vault", file: rel, raw: line, index: i, where: `your "${title}" note` });
    });
  }
  return out;
}

function workspaceEntries(workspaceDir) {
  const out = [];
  const userMd = safeRead(join(workspaceDir, "USER.md"));
  if (userMd !== null) {
    const lines = userMd.split("\n");
    lines.forEach((line, i) => {
      if (/^-\s+\d{4}-\d{2}-\d{2}\s*[—–-]\s*\S/.test(line) && !continues(lines[i + 1])) out.push({ store: "workspace", file: "USER.md", raw: line, index: i, where: "your profile (USER.md)" });
    });
  }
  let days = [];
  try { days = readdirSync(join(workspaceDir, "memory")).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort(); } catch { days = []; }
  for (const f of days) {
    const text = safeRead(join(workspaceDir, "memory", f));
    if (text === null) continue;
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (/^-\s+\d{1,2}:\d{2}(?:\s*[AP]M)?\s*[—–-]\s*\S/i.test(line) && !continues(lines[i + 1])) out.push({ store: "workspace", file: `memory/${f}`, raw: line, index: i, where: `your journal for ${f.slice(0, 10)}` });
    });
  }
  return out;
}

/** Every saved entry, with a stable id (same file + same line text = same id, so duplicates go together). */
export function listEntries({ vaultDir, workspaceDir }) {
  return [...(vaultDir ? vaultEntries(vaultDir) : []), ...(workspaceDir ? workspaceEntries(workspaceDir) : [])]
    .map((e) => ({ ...e, id: idOf(`${e.store}:${e.file}`, e.raw), text: displayText(e.raw) }))
    .filter((e) => e.text);
}

/** Entries matching a phrase, one row per id (identical duplicate lines count as one entry). */
export function findEntries(dirs, query) {
  const seen = new Map();
  for (const e of listEntries(dirs)) {
    if (!entryMatches(e.text, query)) continue;
    const prior = seen.get(e.id);
    seen.set(e.id, prior ? { ...prior, copies: prior.copies + 1 } : { id: e.id, text: e.text, where: e.where, copies: 1 });
  }
  return [...seen.values()];
}

const baseOf = (dirs, store) => (store === "vault" ? dirs.vaultDir : dirs.workspaceDir);
const writeAtomic = (path, text) => { const tmp = `${path}.${process.pid}.forget.tmp`; writeFileSync(tmp, text); renameSync(tmp, path); };

/** Archive the entries with these ids: their lines leave their files and are appended to memory-archive.jsonl. */
export function archiveEntries(dirs, ids, now = new Date()) {
  const wanted = new Set(ids);
  const all = listEntries(dirs).filter((e) => wanted.has(e.id));
  const byFile = new Map();
  for (const e of all) byFile.set(`${e.store}:${e.file}`, [...(byFile.get(`${e.store}:${e.file}`) ?? []), e]);
  const archived = [];
  for (const group of byFile.values()) {
    const { store, file } = group[0];
    const path = join(baseOf(dirs, store), file);
    const lines = (safeRead(path) ?? "").split("\n");
    const drop = new Set(group.filter((e) => lines[e.index] === e.raw).map((e) => e.index));
    const removed = [];
    const kept = lines.filter((line, index) => (drop.has(index) ? (removed.push({ line, index }), false) : true));
    if (!removed.length) continue;
    mkdirSync(dirs.controlledDir, { recursive: true });
    const rows = removed.map(({ line, index }) => ({ id: idOf(`${store}:${file}`, line), store, file, line: index + 1, raw: line, archivedAt: now.toISOString() }));
    appendFileSync(join(dirs.controlledDir, "memory-archive.jsonl"), rows.map((r) => `${JSON.stringify(r)}\n`).join(""));
    writeAtomic(path, kept.join("\n"));
    for (const e of group) if (!archived.some((a) => a.id === e.id)) archived.push({ id: e.id, text: e.text, where: e.where, copies: rows.filter((r) => r.id === e.id).length });
  }
  return { archived, missing: ids.filter((id) => !archived.some((a) => a.id === id)) };
}

/**
 The archive rows not yet put back, by replaying the log in order (REV6 item 5: forget, restore, forget again left the second
 archive row unreachable, because any restore marker for the id hid every row with it). A marker closes the open rows for its id
 that it names by archivedAt; a marker from before that field closes every open row for its id written before it.
*/
export function stillArchived(rows) {
  let open = [];
  for (const r of rows) {
    if (!r.restored) { open = [...open, r]; continue; }
    const named = Array.isArray(r.archivedAt) ? new Set(r.archivedAt) : null;
    open = open.filter((o) => o.id !== r.restored || (named !== null && !named.has(o.archivedAt)));
  }
  return open;
}

/** Put archived entries back where they were (at their old line, or the end of the file if it has shrunk). */
export function restoreEntries(dirs, ids, now = new Date()) {
  const archivePath = join(dirs.controlledDir, "memory-archive.jsonl");
  const rows = (safeRead(archivePath) ?? "").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const todo = stillArchived(rows).filter((r) => ids.includes(r.id));
  const restored = [];
  for (const r of [...todo].sort((a, b) => a.line - b.line)) {
    const path = join(baseOf(dirs, r.store), r.file);
    const lines = (safeRead(path) ?? "").split("\n");
    const at = Math.min(Math.max(r.line - 1, 0), lines.length);
    writeAtomic(path, [...lines.slice(0, at), r.raw, ...lines.slice(at)].join("\n"));
    if (!restored.some((x) => x.id === r.id)) restored.push({ id: r.id, text: displayText(r.raw) });
  }
  // Each marker names the archive rows it undid (their archivedAt), so a later forget of the same line is a new, open row.
  if (restored.length) appendFileSync(archivePath, restored.map((x) => `${JSON.stringify({ restored: x.id, archivedAt: [...new Set(todo.filter((r) => r.id === x.id).map((r) => r.archivedAt))], at: now.toISOString() })}\n`).join(""));
  return { restored, missing: ids.filter((id) => !restored.some((x) => x.id === id)) };
}
