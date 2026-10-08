// A private day for running ORION's real calendar scripts (V3 handoff §6 J3).
// The scripts already honour evaluation mode through environment overrides
// (lib/eval-mode.mjs, lib/life/bridge-path.mjs and friends), so each trial gets
// its own folder: marker, sandbox calendar, pins, skips, undo, life config,
// history and patterns. Because only the child processes carry these variables,
// live ORION is never diverted — scheduling trials can run while Nick uses it.
//
// Env is passed as an object, never through a shell: on 2026-10-08 an unsplit
// env string sent orion-reschedule to the real calendar (it changed nothing).
// preflight() proves the scripts see the sandbox before a run starts.
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync, utimesSync } from "node:fs";
import { execFile } from "node:child_process";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const LIVE = join(homedir(), ".openclaw/orion-controlled");
const ROOT = join(LIVE, "evals/v3/sandboxes");
// Only scripts whose every write goes through the sandbox-aware bridge or an overridable file.
export const REAL_SCRIPTS = new Set(["orion-agenda", "orion-reschedule", "orion-tasks"]);
const SHELL = /[|;&<>`]|\$\(/;

/** Split a command like a shell would, refusing anything only a shell could do. */
export function tokenize(command) {
  const s = String(command ?? "").trim();
  const out = [];
  let cur = ""; let quote = null; let started = false;
  for (const ch of s) {
    if (quote) { if (ch === quote) quote = null; else cur += ch; continue; }
    if (ch === "'" || ch === '"') { quote = ch; started = true; continue; }
    if (/\s/.test(ch)) { if (started) { out.push(cur); cur = ""; started = false; } continue; }
    if (SHELL.test(ch) || (ch === "(" && cur.endsWith("$"))) throw new Error(`shell syntax is not allowed: ${s}`);
    cur += ch; started = true;
  }
  if (quote) throw new Error(`unclosed quote (shell syntax): ${s}`);
  if (started) out.push(cur);
  if (SHELL.test(s.replace(/'[^']*'|"[^"]*"/g, ""))) throw new Error(`shell syntax is not allowed: ${s}`);
  return out;
}

const pad = (n) => String(n).padStart(2, "0");
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const minuteOf = (iso) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };

/**
 * day: [{ title, start: "HH:MM", end: "HH:MM", fixed?, kind? }], now: "HH:MM", todos: [titles], date?: "YYYY-MM-DD".
 * Returns { dir, env, preflight(), run(command), state(), cleanup() }.
 */
export function createSandbox({ day = [], now = "12:00", todos = [], date = localDate() }) {
  mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(join(ROOT, "sbx-"));
  const iso = (hhmm) => new Date(`${date}T${hhmm}:00`).toISOString();
  const f = (name) => join(dir, name);
  const events = day.map((d, i) => ({ identifier: `seed-${i}`, title: d.title, start: iso(d.start), end: iso(d.end), ...(d.fixed ? {} : { orion: d.kind ?? "other" }) }));
  writeFileSync(f("calendar.json"), JSON.stringify({ now: iso(now), events, reminders: todos.map((title, i) => ({ identifier: `todo-${i}`, title })) }, null, 2), { mode: 0o600 });
  for (const name of ["life-config.json", "patterns.json"]) {
    if (existsSync(join(LIVE, name))) copyFileSync(join(LIVE, name), f(name)); else writeFileSync(f(name), "{}");
  }
  writeFileSync(f("eval-mode"), `orion-v3 sandbox\n`);
  const env = {
    ORION_EVAL_MARKER: f("eval-mode"), ORION_SANDBOX_CALENDAR: f("calendar.json"), ORION_RESCHEDULE_PINS: f("pins.json"),
    ORION_SKIPS_FILE: f("skips.json"), ORION_RESCHEDULE_UNDO: f("undo.json"), ORION_LIFE_CONFIG: f("life-config.json"),
    ORION_LIFE_HISTORY: f("life-history.jsonl"), ORION_PATTERNS_FILE: f("patterns.json"), ORION_CHECKIN_FILE: f("checkins.json"),
  };

  const run = (command, { timeoutMs = 60000 } = {}) => new Promise((resolve) => {
    let argv;
    try { argv = tokenize(command); } catch (error) { resolve({ stdout: `Refused: ${error.message}`, exit: null }); return; }
    const name = basename(argv[0] ?? "");
    if (!REAL_SCRIPTS.has(name)) { resolve({ stdout: `${name || "(empty)"} is not run in the sandbox`, exit: null }); return; }
    const now = new Date();
    utimesSync(env.ORION_EVAL_MARKER, now, now);
    const { ORION_BRIDGE_BIN, ...parent } = process.env;
    execFile(process.execPath, [join(SCRIPTS, name), ...argv.slice(1)], { env: { ...parent, ...env }, timeout: timeoutMs, maxBuffer: 4 << 20, cwd: dir },
      (error, stdout, stderr) => resolve({ stdout: `${stdout ?? ""}${stderr ? `\n${stderr}` : ""}`.trim(), exit: error ? (typeof error.code === "number" ? error.code : null) : 0 }));
  });

  const state = () => {
    const cal = JSON.parse(readFileSync(env.ORION_SANDBOX_CALENDAR, "utf8"));
    return {
      day: cal.events.map((e) => ({ title: e.title, start: minuteOf(e.start), end: minuteOf(e.end), id: e.identifier, fixed: !e.orion })).sort((a, b) => a.start - b.start),
      todos: (cal.reminders ?? []).filter((r) => !r.completed).map((r) => r.title),
    };
  };

  // The seeded titles must come back from orion-agenda, or the scripts are not on the sandbox.
  const preflight = async () => {
    const { stdout, exit } = await run("orion-agenda today");
    return exit === 0 && day.every((d) => stdout.includes(d.title));
  };

  return { dir, env, run, state, preflight, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
