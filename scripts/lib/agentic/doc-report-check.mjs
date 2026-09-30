#!/usr/bin/env node
/*
 The `doc-report` check: a mechanical floor under an investigation report.

 The local reviewer sees only the diff; it cannot open the tree, so it cannot
 tell a real source path from an invented one. This can. Run from the worktree
 root on one changed Markdown file, it fails when:
   - any required section heading is missing;
   - a phase packet (phase-<n>-packet.md) omits one of that phase's
     requirement ids from docs/planning/v2/PHASE_GATES.json;
   - a repository path cited BEFORE "Smallest next slice" (the sections about
     what exists) does not exist. Proposed new files live in the later
     sections and are not checked; a line that says the file is unavailable,
     missing or uncommitted is taken at its word.
 It proves the report is well-formed and grounded, never that it is right.
*/
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

const SECTIONS = ["Baseline", "Requirement matrix", "Architecture and interfaces",
  "Smallest next slice", "Test scenarios", "Gates and handoff"];
const ROOTS = "native|scripts|plugin|docs|tests|orion|backend";
const PATH = new RegExp(`(?<![\\w./-])((?:${ROOTS})/[\\w./@+-]*[\\w-])`, "g");
const EXCUSED = /unavailable|missing|absent|not present|does not exist|not at head|uncommitted|not committed|to be created|proposed|new file/i;

const file = process.argv[2];
if (!file) { console.error("usage: doc-report-check.mjs <report.md>"); process.exit(2); }
const text = readFileSync(file, "utf8");
const lines = text.split("\n");
const problems = [];

const headingAt = name => lines.findIndex(line =>
  /^#{1,6}\s/.test(line) && line.replace(/^#{1,6}\s*(\d+[.)]\s*)?/, "").trim().toLowerCase().startsWith(name.toLowerCase()));
for (const name of SECTIONS) if (headingAt(name) === -1) problems.push(`missing section heading: "${name}"`);

const phase = basename(file).match(/^phase-(\d+)-packet\.md$/)?.[1];
if (phase) {
  try {
    const gate = JSON.parse(readFileSync("docs/planning/v2/PHASE_GATES.json", "utf8")).phases?.[phase];
    for (const { id } of gate?.requirements ?? []) if (!text.includes(id)) problems.push(`requirement id not in the report: ${id}`);
  } catch (error) { problems.push(`could not read PHASE_GATES.json: ${error.message}`); }
}

const nextSlice = headingAt("Smallest next slice");
const grounded = nextSlice === -1 ? lines : lines.slice(0, nextSlice);
const missing = new Set();
for (const line of grounded) {
  if (EXCUSED.test(line)) continue;
  for (const [, raw] of line.matchAll(PATH)) {
    const path = raw.replace(/[.:]+$/, "");
    if (path.includes("*") || path.includes("<")) continue;
    if (!existsSync(path)) missing.add(path);
  }
}
for (const path of missing) problems.push(`cited path does not exist at this baseline: ${path} (fix it, or say on that line that it is unavailable)`);

if (problems.length) { console.log(problems.join("\n")); process.exit(1); }
console.log(`report is well-formed: ${SECTIONS.length} sections${phase ? `, every Phase ${phase} requirement id present` : ""}, cited paths exist`);
