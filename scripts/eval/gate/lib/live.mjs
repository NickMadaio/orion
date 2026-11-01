// Where the live system keeps what the app reads before a turn, and how to read it. Everything takes a
// `home` so tests can point at a scratch directory; production code passes nothing.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseRoutingMode } from "./scheduling.mjs";
import { parseOutreach } from "./outreach.mjs";

export function paths(home = homedir()) {
  const ctrl = join(home, ".openclaw/orion-controlled");
  return {
    home, ctrl,
    openclaw: join(home, ".openclaw/bin/openclaw"),
    node: join(home, ".openclaw/tools/node-v24.15.0/bin/node"),
    // The scripts the live system runs. Not the worktree's copies: a gate run must exercise what is installed.
    scripts: process.env.ORION_SCRIPTS || join(home, "Desktop/ORION/scripts"),
    inboundTurn: join(home, ".openclaw/orion-remote/scripts/orion-inbound-turn"),
    shadow: join(ctrl, "local-routing/shadow.jsonl"),
    outreach: join(ctrl, "outreach.jsonl"),
    undo: join(ctrl, "reschedule-undo.json"),
    marker: join(ctrl, "eval-mode"),
    sandboxCalendar: join(ctrl, "eval-calendar.json"),
    workspace: join(home, ".openclaw/workspace"),
    scheduling: join(home, ".openclaw/workspace/SCHEDULING.md"),
    config: join(home, ".openclaw/openclaw.json"),
    env: join(home, "Desktop/ORION/.env"),
    sessions: join(home, ".openclaw/agents/main/sessions"),
    // Where orion-brain search reads (ORION_BRAIN_VAULT, else the Obsidian vault) and the test folder the computer items may touch.
    brainVault: process.env.ORION_BRAIN_VAULT || join(home, "Documents/orionBrain"),
    canary: join(home, "Documents/zz-sweep-canary"),
    appDirs: [join(home, "Applications"), "/Applications", "/System/Applications", "/System/Cryptexes/App/System/Applications"],
  };
}

export const readText = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

/** Run a command to completion without blocking the event loop (the marker heartbeat must keep ticking). */
export function run(cmd, args, { timeoutMs = 60000, env = process.env, input } = {}) {
  return new Promise((resolve) => {
    let out = ""; let err = ""; let settled = false;
    const child = spawn(cmd, args, { env, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    const done = (r) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ stdout: out, stderr: err, ...r }); } };
    const timer = setTimeout(() => { child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 5000).unref(); done({ status: null, timedOut: true }); }, timeoutMs);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => done({ status: null, error: e.message }));
    child.on("close", (status) => done({ status }));
    if (input !== undefined) child.stdin.end(input);
  });
}

/** Nick's real focus-session state, exactly as `orion-session status --json` reports it. */
export async function sessionStatus(p = paths()) {
  const r = await run(p.node, [join(p.scripts, "orion-session"), "status", "--json"], { timeoutMs: 15000 });
  try { return JSON.parse(r.stdout); } catch { return null; }
}

export function routingMode(p = paths()) {
  try { return parseRoutingMode(JSON.parse(readText(p.config) ?? "{}")); } catch { return parseRoutingMode(null); }
}
export const schedulingRules = (p = paths()) => readText(p.scheduling);
export const outreachRows = (p = paths()) => parseOutreach(readText(p.outreach) ?? "");

/** The app's Secrets.value order: process environment, then Desktop/ORION/.env (unreadable under launchd, so launch.sh passes it in). */
export function secret(name, p = paths()) {
  const fromEnv = (process.env[name] ?? "").trim();
  if (fromEnv) return fromEnv;
  if (!existsSync(p.env)) return null;
  for (const line of (readText(p.env) ?? "").split("\n")) {
    const m = new RegExp(`^(?:export\\s+)?${name}\\s*=\\s*(.*)$`).exec(line.trim());
    if (m) return m[1].replace(/^["']|["']$/g, "").trim() || null;
  }
  return null;
}
