/*
 The nightly tidy-up of what ORION learned (wave 12, 2026-11-02). Code only, no model: like orion-daily, a tidier that needs
 a warm model is one that silently stops some night.

 Three stores, each with its own learned shape:
   vault notes (Nick.md …)   "- [category] text (YYYY-MM-DD)" under "## Learned"   orion-brain learn
   workspace USER.md         "- YYYY-MM-DD — text", one line                        orion-remember --user
   workspace memory/*.md     "- HH:MM AM — [auto] text"                             the episodic writer (episodic.ts)

 What it does, each step with a reason the log keeps:
   merge-headers     every "## Learned" section folded into the first (orion-brain added a header per fact: Nick.md had 7)
   drop-duplicate    the same fact again, or one the other contains; the more specific (longer) one stays
   drop-junk         a fact with no content ("ok"), or an [auto] episode the live filter would not write (episode-filter.ts)
   drop-expired      "[temp]" / "Temporary:" older than 14 days, or anything "until <date>" once the date has passed
   promote-episode   an [auto] line that states something standing ("naps at least 75 min ALWAYS") becomes a dated fact
 The template part of USER.md (multi-line entries) is never touched. Pure functions; the CLI does the writing.
*/
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { episodeBody, isDurableEpisode, isFiller, junkEpisodeLines } from "../../../plugin/orion-control/dist/episode-filter.js";

const DAY_MS = 86400_000;
export const TEMP_DAYS = 14;
const HEADER = /^#{1,6}\s/;
const LEARNED_HEADER = /^## Learned\s*$/;
const NOTE_FACT = /^- \[([a-z -]+)\]\s+(.*?)\s*\((?:said )?(\d{4}-\d{2}-\d{2})\)\s*$/i;
const USER_FACT = /^- (\d{4}-\d{2}-\d{2}) [—–-] (.+)$/;
const UNTIL = /\buntil (\d{4}-\d{2}-\d{2})\b/i;

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

/** Same fact twice: equal once normalised, or one contains the other. Stricter than the episode rule on purpose:
 *  "likes gym in the evening" and "likes gym in the morning" share 5 of 6 words and are opposite facts. */
export function sameFact(a, b) {
  const x = norm(a); const y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

/** True when a learned line has lapsed at `now`. */
export function expired(line, now) {
  const f = parseFact(line);
  if (!f) return false;
  const until = f.body.match(UNTIL)?.[1];
  if (until) return localDay(now) > until;
  if (!/^temp(?:orary)?$/.test(f.category)) return false;
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

/** Dedupe, junk and expiry over a list of learned lines; `index` maps back to the caller's line numbers. */
function tidyFacts(items, now) {
  const actions = [];
  const kept = [];
  for (const item of items) {
    const f = parseFact(item.line);
    if (!f) { kept.push(item); continue; }
    if (isFiller(f.body) || norm(f.body).split(" ").filter(Boolean).length < 2) { actions.push({ action: "drop-junk", line: item.line, at: item.at, reason: "no content" }); continue; }
    if (expired(item.line, now)) { actions.push({ action: "drop-expired", line: item.line, at: item.at, reason: f.body.match(UNTIL) ? "its 'until' date has passed" : `temporary, older than ${TEMP_DAYS} days` }); continue; }
    const twin = kept.findIndex((k) => parseFact(k.line) && sameFact(parseFact(k.line).body, f.body));
    if (twin === -1) { kept.push(item); continue; }
    const other = kept[twin];
    // The more specific one stays, in the earlier one's place.
    if (norm(f.body).length > norm(parseFact(other.line).body).length) {
      actions.push({ action: "drop-duplicate", line: other.line, at: other.at, reason: `contained in "${f.body}"` });
      kept[twin] = { ...item };
    } else actions.push({ action: "drop-duplicate", line: item.line, at: item.at, reason: `same as "${parseFact(other.line).body}"` });
  }
  return { kept, actions };
}

/** A vault note: headers merged, facts tidied, episodes promoted into its single "## Learned". */
export function consolidateNote(text, { now, promote = [] }) {
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
  const { kept, actions: tidied } = tidyFacts(section.map((line, i) => ({ line, at: positions.length === section.length ? positions[i] : -1 })), now);
  actions.push(...tidied);
  const promoted = [];
  for (const p of promote) {
    const body = p.text.replace(/\s+/g, " ").trim();
    if ([...kept, ...promoted].some((k) => parseFact(k.line) && sameFact(parseFact(k.line).body, body))) continue;
    const line = `- [said] ${body} (${p.day})`;
    promoted.push({ line });
    actions.push({ action: "promote-episode", line, at: -1, reason: `standing statement from the ${p.day} journal` });
  }
  const body = [...kept, ...promoted].map((k) => k.line);
  const out = start === -1
    ? [...lines.slice(0, lines.length - (lines.at(-1) === "" ? 1 : 0)), "", "## Learned", ...body, ""]
    : [...lines.slice(0, start + 1), ...body, ...(end < lines.length ? [""] : []), ...lines.slice(end)];
  return { text: `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`, actions };
}

/** USER.md: only learned one-line dated bullets (no indented continuation) are deduplicated or expired. */
export function consolidateUser(text, { now }) {
  const lines = text.split("\n");
  const learned = lines.flatMap((line, at) => (USER_FACT.test(line) && !/^\s+\S/.test(lines[at + 1] ?? "") ? [{ line, at }] : []));
  const { actions } = tidyFacts(learned, now);
  const drop = new Set(actions.map((a) => a.at));
  return { text: lines.filter((_, i) => !drop.has(i)).join("\n"), actions };
}

/** One day's journal: [auto] lines to drop (episode-filter's rule) and the standing ones worth promoting. */
export function durableEpisodes(text) {
  const drop = junkEpisodeLines(text).map((j) => ({ action: "drop-junk", line: j.line, at: j.index, reason: `journal: ${j.reason}` }));
  const dropped = new Set(drop.map((d) => d.at));
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

/** The whole night's plan: which files change, how, and why. Reads only. */
export function planConsolidation({ workspace, vault, now }) {
  const files = [];
  const add = (path, before, after, actions) => { if (before !== after && actions.length) files.push({ path, before, after, actions, backupName: backupNameOf(path) }); };
  const memory = join(workspace, "memory");
  const promote = [];
  for (const name of existsSync(memory) ? readdirSync(memory).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)).sort() : []) {
    const path = join(memory, name);
    const before = readFileSync(path, "utf8");
    const { keep, drop } = durableEpisodes(before);
    promote.push(...keep.map((k) => ({ text: k.text, day: name.slice(0, 10) })));
    const gone = new Set(drop.map((d) => d.at));
    add(path, before, before.split("\n").filter((_, i) => !gone.has(i)).join("\n"), drop);
  }
  const user = join(workspace, "USER.md");
  if (existsSync(user)) { const before = readFileSync(user, "utf8"); const r = consolidateUser(before, { now }); add(user, before, r.text, r.actions); }
  vaultNotes(vault).forEach((path, i) => {
    const before = readFileSync(path, "utf8");
    const r = consolidateNote(before, { now, promote: i === 0 && basename(path) === "Nick.md" ? promote : [] });
    add(path, before, r.text, r.actions);
  });
  return { files, actions: files.flatMap((f) => f.actions.map((a) => ({ ...a, file: f.path }))) };
}

/** Writes the plan, every file copied into `backupDir` first. Nothing is written if a backup fails. */
export function applyPlan(plan, { backupDir }) {
  mkdirSync(backupDir, { recursive: true });
  for (const f of plan.files) copyFileSync(f.path, join(backupDir, f.backupName));
  for (const f of plan.files) writeFileSync(f.path, f.after);
  return plan.files.map((f) => f.path);
}
