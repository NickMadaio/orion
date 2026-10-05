#!/usr/bin/env node
// Stand-in for orion-projects: list from $FAKE_PROJECTS; launch spawns a short sleeper
// and records the order; $FAKE_HALT names a project whose state says it was stopped.
import { readFileSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
const [cmd, id] = process.argv.slice(2);
const list = JSON.parse(readFileSync(process.env.FAKE_PROJECTS, "utf8"));
if (cmd === "list") { console.log(JSON.stringify({ projects: list })); process.exit(0); }
if (cmd === "launch") {
  appendFileSync(process.env.FAKE_LAUNCHES, `${id}\n`);
  const dir = join(process.env.ORION_PROJECT_AGENT_ROOT, "projects", id); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify(process.env.FAKE_HALT === id ? { stopRequested: true } : { status: "completed" }));
  const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},300)"], { detached: true, stdio: "ignore" }); child.unref();
  console.log(JSON.stringify({ pid: child.pid })); process.exit(0);
}
process.exit(2);
