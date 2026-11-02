#!/usr/bin/env node
// The nightly tidy-up of what ORION learned (wave 12, 2026-11-02; scripts/lib/brain/consolidate.mjs says what and why).
// Lists what it would change (dry run, the default) or changes it (--apply), backing every file up first into
// <controlled>/consolidate-backups/<stamp>/. Every action is logged to <controlled>/consolidate.jsonl with the line's full text.
// At most MAX_REMOVALS lines are removed a run; the rest are reported (and logged) as a dry run, for the next night. A file that
// changed since planning (a concurrent `orion-brain learn`) is left alone. Promotions are recorded in consolidate-promoted.jsonl
// and never repeated; a fact he forgot (memory-archive.jsonl) is never promoted back. During a live evaluation (the eval-mode
// marker) --apply writes nothing.
// usage: node scripts/orion-memory-consolidate.mjs [--apply] [--workspace <dir>] [--vault <dir>] [--controlled <dir>] [--now <ISO>]
import { appendFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyPlan, isRemoval, planConsolidation, readLedger } from "./lib/brain/consolidate.mjs";
import { displayText, stillArchived } from "./lib/brain/forget.mjs";

const MAX_REMOVALS = 10;
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
const ledgerPath = path.join(controlled, "consolidate-promoted.jsonl");
/** What he forgot and has not restored: never promoted back from the journal. */
function forgottenTexts() {
  let rows = [];
  try { rows = readFileSync(path.join(controlled, "memory-archive.jsonl"), "utf8").split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }); } catch { rows = []; }
  return stillArchived(rows).map((r) => displayText(r.raw ?? "")).filter(Boolean);
}

let plan;
try {
  plan = planConsolidation({ workspace, vault, now, promoted: readLedger(ledgerPath), forgotten: forgottenTexts(), maxRemovals: MAX_REMOVALS });
} catch (error) {
  console.error(`orion-memory-consolidate: could not read the memory stores: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const blocked = apply && evalLive();
const dryRun = !apply || blocked;
if (!plan.actions.length && !plan.deferred.length) {
  if (!dryRun && plan.ledger.length) { try { applyPlan(plan, { backupDir: path.join(controlled, "consolidate-backups", "ledger-only"), ledgerPath }); } catch { /* ledger is best effort */ } }
  console.log("orion-memory-consolidate: nothing to tidy");
  process.exit(0);
}

const where = (a) => `${short(a.file)}${a.at >= 0 ? `:${a.at + 1}` : ""}`;
for (const a of plan.actions) console.log(`${where(a)} ${a.action} [${a.reason}] ${a.line.slice(0, 110)}`);
for (const a of plan.deferred) console.log(`${where(a)} ${a.action} (deferred: over the ${MAX_REMOVALS}-a-night cap) [${a.reason}] ${a.line.slice(0, 110)}`);
let backupDir = null;
let skipped = [];
if (!dryRun) {
  backupDir = path.join(controlled, "consolidate-backups", now.toISOString().replace(/[:.]/g, "-"));
  try { ({ skipped } = applyPlan(plan, { backupDir, ledgerPath })); } catch (error) {
    console.error(`orion-memory-consolidate: stopped, nothing more written: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
try {
  mkdirSync(controlled, { recursive: true });
  const at = new Date().toISOString();
  const row = (a, extra) => JSON.stringify({ at, file: short(a.file), line: a.at + 1, action: a.action, reason: a.reason, text: a.line, ...extra });
  const rows = [
    ...plan.actions.map((a) => (skipped.includes(a.file)
      ? row(a, { dryRun: true, skipped: "the file changed since planning; left for the next run" })
      : row(a, { dryRun, ...(backupDir ? { backup: short(backupDir) } : {}) }))),
    ...plan.deferred.map((a) => row(a, { dryRun: true, deferred: `over the ${MAX_REMOVALS}-removals-a-night cap` })),
  ];
  appendFileSync(path.join(controlled, "consolidate.jsonl"), `${rows.join("\n")}\n`);
} catch { /* the log is evidence, not a precondition */ }
if (blocked) console.log("orion-memory-consolidate: an evaluation is running, so nothing was written");
for (const file of skipped) console.log(`orion-memory-consolidate: ${short(file)} changed since planning; left alone for the next run`);
const done = plan.actions.filter((a) => !skipped.includes(a.file));
const removals = done.filter(isRemoval).length;
console.log(`${dryRun ? "would change" : "changed"} ${plan.files.length - skipped.length} file(s), ${done.length} action(s), ${removals} removal(s)${backupDir ? `; backups in ${short(backupDir)}` : ""}`);
if (plan.deferred.length) console.log(`${plan.deferred.length} more removal(s) over the ${MAX_REMOVALS}-a-night cap: listed above as deferred, left for the next night`);
