#!/usr/bin/env node
// The nightly tidy-up of what ORION learned (wave 12, 2026-11-02; scripts/lib/brain/consolidate.mjs says what and why).
// Lists what it would change (dry run, the default) or changes it (--apply), backing every file up first into
// <controlled>/consolidate-backups/<stamp>/. Every action is logged to <controlled>/consolidate.jsonl. Idempotent: a second
// --apply finds nothing. During a live evaluation (the eval-mode marker) --apply writes nothing.
// usage: node scripts/orion-memory-consolidate.mjs [--apply] [--workspace <dir>] [--vault <dir>] [--controlled <dir>] [--now <ISO>]
import { appendFileSync, mkdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyPlan, planConsolidation } from "./lib/brain/consolidate.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => { const at = args.indexOf(name); return at !== -1 && args[at + 1] ? args[at + 1] : fallback; };
const apply = args.includes("--apply");
const home = os.homedir();
const workspace = path.resolve(opt("--workspace", path.join(home, ".openclaw", "workspace")));
const vault = path.resolve(opt("--vault", process.env.ORION_BRAIN_VAULT || path.join(home, "Documents", "orionBrain")));
const controlled = path.resolve(opt("--controlled", process.env.ORION_CONTROLLED_DIR || path.join(home, ".openclaw", "orion-controlled")));
const now = new Date(opt("--now", process.env.ORION_NOW || new Date().toISOString()));
if (Number.isNaN(now.getTime())) { console.error("orion-memory-consolidate: --now is not a date"); process.exit(2); }

const short = (p) => p.replace(home, "~");
const evalLive = () => { try { return Date.now() - statSync(path.join(controlled, "eval-mode")).mtimeMs < 2 * 3600_000; } catch { return false; } };

let plan;
try {
  plan = planConsolidation({ workspace, vault, now });
} catch (error) {
  console.error(`orion-memory-consolidate: could not read the memory stores: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
if (!plan.actions.length) { console.log("orion-memory-consolidate: nothing to tidy"); process.exit(0); }

const blocked = apply && evalLive();
for (const a of plan.actions) {
  console.log(`${short(a.file)}${a.at >= 0 ? `:${a.at + 1}` : ""} ${a.action} [${a.reason}] ${a.line.slice(0, 110)}`);
}
const dryRun = !apply || blocked;
let backupDir = null;
if (!dryRun) {
  backupDir = path.join(controlled, "consolidate-backups", now.toISOString().replace(/[:.]/g, "-"));
  try { applyPlan(plan, { backupDir }); } catch (error) {
    console.error(`orion-memory-consolidate: stopped, nothing more written: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
try {
  mkdirSync(controlled, { recursive: true });
  const at = new Date().toISOString();
  appendFileSync(path.join(controlled, "consolidate.jsonl"), plan.actions.map((a) => JSON.stringify({ at, dryRun, file: short(a.file), line: a.at + 1, action: a.action, reason: a.reason, text: a.line.slice(0, 300), ...(backupDir ? { backup: short(backupDir) } : {}) })).join("\n") + "\n");
} catch { /* the log is evidence, not a precondition */ }
if (blocked) console.log("orion-memory-consolidate: an evaluation is running, so nothing was written");
console.log(`${dryRun ? "would change" : "changed"} ${plan.files.length} file(s), ${plan.actions.length} action(s)${backupDir ? `; backups in ${short(backupDir)}` : ""}`);
