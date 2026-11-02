#!/usr/bin/env node
// Lists (dry run, default) or removes (--apply) junk "[auto]" episode lines from daily memory files, by the same
// rule the live writer uses (plugin/orion-control/src/episode-filter.ts). Idempotent: a second run finds nothing.
// usage: node scripts/orion-memory-clean.mjs [--dir <memory dir>] [--apply]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { junkEpisodeLines } from "../plugin/orion-control/dist/episode-filter.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const at = args.indexOf("--dir");
const dir = at !== -1 && args[at + 1] ? path.resolve(args[at + 1]) : path.join(os.homedir(), ".openclaw", "workspace", "memory");

let total = 0;
for (const name of readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)).sort()) {
  const file = path.join(dir, name);
  const content = readFileSync(file, "utf8");
  const junk = junkEpisodeLines(content);
  if (junk.length === 0) continue;
  total += junk.length;
  for (const j of junk) console.log(`${name}:${j.index + 1} [${j.reason}] ${j.line.slice(0, 110)}`);
  if (apply) {
    const drop = new Set(junk.map((j) => j.index));
    writeFileSync(file, content.split("\n").filter((_, i) => !drop.has(i)).join("\n"));
  }
}
console.log(`${apply ? "removed" : "would remove"} ${total} line(s) in ${dir}`);
