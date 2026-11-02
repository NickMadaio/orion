#!/usr/bin/env node
/*
 What ORION learned in a workspace file, told apart from the tracked template (wave 12, 2026-11-02).

 `orion_v2_workspace_sync.sh --apply` copied plugin/workspace/USER.md over the live one, which would have wiped every line
 ORION had learned. Two shapes of learned line exist:
   - a dated one-line bullet appended at the end ("- 2026-11-02 — Preference: …"), what `orion-remember --user` writes;
   - an entry under a "## Learned" header, the shape `orion-brain learn` uses in vault notes.
 A template entry is never learned: the template's own dated bullets run over several lines, and only bullets after the
 live file's last template line count (orion-remember appends, so a learned line can only be there).

   node consolidate-learned.mjs merge <repo file> <live file>   prints the template with the live file's learned lines
   node consolidate-learned.mjs count <repo file> <live file>   prints "<learned> <template-in-step 0|1>"
*/
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DATED = /^- \d{4}-\d{2}-\d{2} [—–-] \S/;
const CONTINUED = /^\s+\S/;
const HEADER = /^#{1,6}\s/;
const LEARNED_HEADER = /^## Learned\s*$/;

/** Entries under every "## Learned" header (up to the next header), in order. */
function sectionEntries(lines) {
  const out = [];
  let inside = false;
  for (const line of lines) {
    if (HEADER.test(line)) { inside = LEARNED_HEADER.test(line); continue; }
    if (inside && line.trim()) out.push(line);
  }
  return out;
}

/** The learned lines of `live` that `repo` does not already hold. Pure. */
export function learnedLines(repo, live) {
  const repoLines = repo.split("\n");
  const known = new Set(repoLines.map((l) => l.trimEnd()));
  const lines = live.split("\n").map((l) => l.trimEnd());
  // The tail after the last line the template also has: where orion-remember's appends land.
  let anchor = -1;
  lines.forEach((l, i) => { if (l.trim() && known.has(l) && !LEARNED_HEADER.test(l)) anchor = i; });
  const bullets = lines.flatMap((l, i) => (i > anchor && DATED.test(l) && !CONTINUED.test(lines[i + 1] ?? "") && !known.has(l) ? [l] : []));
  const repoSection = new Set(sectionEntries(repoLines).map((l) => l.trimEnd()));
  const section = [...new Set(sectionEntries(lines))].filter((l) => !repoSection.has(l) && !bullets.includes(l));
  return { bullets, section };
}

/** `live` with its learned lines (and any "## Learned" header left empty by that) taken out: what the template should equal. */
export function withoutLearned(repo, live) {
  const { bullets, section } = learnedLines(repo, live);
  const drop = new Set([...bullets, ...section]);
  const kept = live.split("\n").filter((l) => !drop.has(l.trimEnd()));
  const repoHasHeader = repo.split("\n").some((l) => LEARNED_HEADER.test(l));
  const noEmptyHeaders = repoHasHeader ? kept : kept.filter((l) => !LEARNED_HEADER.test(l));
  return `${noEmptyHeaders.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

/** The template, with what was learned carried across once: bullets at the end, section entries under one "## Learned". Pure. */
export function mergeLearned(repo, live) {
  const { bullets, section } = learnedLines(repo, live);
  let out = repo.trimEnd();
  if (section.length) {
    const lines = out.split("\n");
    const at = lines.findIndex((l) => LEARNED_HEADER.test(l));
    if (at === -1) out = `${out}\n\n## Learned\n${section.join("\n")}`;
    else {
      let end = at + 1;
      while (end < lines.length && !HEADER.test(lines[end])) end++;
      while (end > at + 1 && !lines[end - 1].trim()) end--;
      out = [...lines.slice(0, end), ...section, ...lines.slice(end)].join("\n");
    }
  }
  if (bullets.length) out = `${out}\n${bullets.join("\n")}`;
  return `${out}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, repoPath, livePath] = process.argv.slice(2);
  if (!cmd || !repoPath || !livePath) { console.error("usage: consolidate-learned.mjs merge|count <repo file> <live file>"); process.exit(2); }
  const repo = readFileSync(repoPath, "utf8");
  const live = readFileSync(livePath, "utf8");
  if (cmd === "merge") process.stdout.write(mergeLearned(repo, live));
  else if (cmd === "count") {
    const { bullets, section } = learnedLines(repo, live);
    console.log(`${bullets.length + section.length} ${withoutLearned(repo, live).trimEnd() === repo.trimEnd() ? 1 : 0}`);
  } else { console.error(`unknown command: ${cmd}`); process.exit(2); }
}
