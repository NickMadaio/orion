// The V3 experiment ledger (handoff §13.6): one JSON line per run or decision,
// append-only, outside Git. "If a result is not in the ledger, it did not happen."
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)
import { appendFileSync, mkdirSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export const V3_DIR = process.env.ORION_V3_DIR || join(homedir(), ".openclaw/orion-controlled/evals/v3");
export const LEDGER = join(V3_DIR, "ledger.jsonl");

export function appendLedger(entry, file = LEDGER) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

export function readLedger(file = LEDGER) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}
