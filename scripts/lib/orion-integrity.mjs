#!/usr/bin/env node
/*
 Integrity of the code that runs outside the repo (Phase 48: "prevents
 unauthorized replacement or tampering").

 Two copies of ORION run from outside ~/Desktop/ORION: the Discord bridge in
 ~/.openclaw/orion-remote (launchd cannot read the Desktop) and the plugin in
 ~/.openclaw/extensions/orion-control (the gateway loads it). Until now the only
 protection was a fingerprint COMPARISON that reported drift after the fact.

 Now each sanctioned installer records a SHA-256 manifest of every installed
 file in ~/.openclaw/orion-gate/integrity/ -- the gate directory, which no
 action in ORION's tool surface can write -- and the copy is checked against it
 BEFORE it runs: the bridge by a verifier launchd starts in its place, the
 plugin at load. A mismatch refuses to run and says which file changed.

   orion-integrity.mjs record <name> <dir>   write the manifest (installers only)
   orion-integrity.mjs verify <name> <dir>   exit 0 if unchanged, 1 with the diff
   orion-integrity.mjs run <name> <dir> -- <command…>   verify, then exec

 Honest limit: this stops replacement by anything that cannot write the gate
 directory, which is everything ORION can do. A user-level attacker who can
 write that directory can rewrite the manifest too; closing that needs code
 signing, deferred with the Developer Program (see Phase 48's gate record).
*/
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, lstatSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";

export const GATE = join(process.env.ORION_GATE_DIR ?? join(homedir(), ".openclaw/orion-gate"), "integrity");
const NAME = /^[a-z0-9-]{1,40}$/;
// node_modules is hashed: dependencies decide what actually runs.
const SKIP = new Set(["__pycache__", ".DS_Store"]);

export function manifestFor(root) {
  const files = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      if (SKIP.has(entry)) continue;
      const path = join(dir, entry);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) files[relative(root, path)] = "symlink";
      else if (stat.isDirectory()) walk(path);
      else files[relative(root, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  walk(root);
  return files;
}

export function record(name, root) {
  if (!NAME.test(name)) throw new Error(`bad manifest name ${name}`);
  mkdirSync(GATE, { recursive: true, mode: 0o700 });
  const files = manifestFor(root);
  writeFileSync(join(GATE, `${name}.json`), JSON.stringify({ name, root, recordedAt: new Date().toISOString(), files }, null, 1), { mode: 0o600 });
  return Object.keys(files).length;
}

export function verify(name, root) {
  const path = join(GATE, `${name}.json`);
  if (!existsSync(path)) return { ok: false, recorded: false, changed: [], missing: [], added: [] };
  const expected = JSON.parse(readFileSync(path, "utf8")).files;
  const actual = manifestFor(root);
  const changed = Object.keys(expected).filter((file) => file in actual && actual[file] !== expected[file]);
  const missing = Object.keys(expected).filter((file) => !(file in actual));
  const added = Object.keys(actual).filter((file) => !(file in expected));
  return { ok: !changed.length && !missing.length && !added.length, recorded: true, changed, missing, added };
}

export function describe(result) {
  if (!result.recorded) return "no integrity manifest has been recorded for this copy";
  const parts = [];
  if (result.changed.length) parts.push(`changed: ${result.changed.slice(0, 5).join(", ")}`);
  if (result.missing.length) parts.push(`missing: ${result.missing.slice(0, 5).join(", ")}`);
  if (result.added.length) parts.push(`added: ${result.added.slice(0, 5).join(", ")}`);
  return parts.join("; ") || "unchanged";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, name, root, separator, ...command_] = process.argv.slice(2);
  if (!name || !root || !NAME.test(name)) { console.error("usage: record|verify|run <name> <dir> [-- command…]"); process.exit(2); }
  if (command === "record") { console.log(`recorded ${record(name, root)} file(s) for ${name}`); process.exit(0); }
  const result = verify(name, root);
  if (command === "verify") { console.log(`${name}: ${result.ok ? "unchanged since it was installed" : describe(result)}`); process.exit(result.ok ? 0 : 1); }
  if (command === "run" && separator === "--" && command_.length) {
    if (!result.ok) {
      const line = `${new Date().toISOString()} REFUSED to start ${name}: ${describe(result)}. Re-install it with its installer if the change was yours.`;
      console.error(line);
      try { appendFileSync(join(homedir(), ".openclaw/orion-controlled/integrity-alerts.log"), `${line}\n`); } catch { /* best effort */ }
      // Slow the restart loop down: launchd will start this again, and each
      // refusal should be a line in the log, not a thousand of them.
      setTimeout(() => process.exit(78), Number(process.env.ORION_INTEGRITY_REFUSE_DELAY_MS ?? 60_000));
    } else {
      const child = spawn(command_[0], command_.slice(1), { stdio: "inherit" });
      for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => child.kill(signal));
      child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
    }
  } else { console.error("usage: record|verify|run <name> <dir> [-- command…]"); process.exit(2); }
}
