#!/usr/bin/env node
/*
 The node half of the health-log race harness. See run-race-test.sh.

 Imports the COMPILED plugin — dist/health.js, the exact file that gets copied
 into ~/.openclaw/extensions — rather than reimplementing addSupplement. The
 point of the harness is to prove the shipped code does not lose updates, and a
 harness that carries its own copy of the logic can only prove things about the
 copy.

 Two modes, matching the Swift side:

   locked    calls the real addSupplement, lock and all.
   unlocked  replays the PRE-FIX code: read, modify, write by atomic rename,
             with nothing serialising the three steps. It is the baseline the
             fix is measured against.
*/

import { readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

// Bounded by TIME, not by a fixed count — see the note in RaceHarness/main.swift.
// With fixed counts node finished long before Swift did and spent most of the
// run racing nobody, which made the unlocked baseline look far healthier than it is.
const seconds = Number(argument("seconds", "4"));
const cap = Number(argument("cap", "100000"));
const prefix = argument("prefix", "node");
const mode = argument("mode", "locked");
const distribution = argument("dist", "");

const file = process.env.ORION_HEALTH_LOG;
if (!file) {
  console.error("ORION_HEALTH_LOG must be set");
  process.exit(2);
}

/** The pre-fix writer, kept only so the fix has a before number. */
async function unlockedAdd(name) {
  let log;
  try {
    log = JSON.parse(await readFile(file, "utf8"));
  } catch {
    log = {
      schema: "orion.health.v1",
      updatedAt: new Date(0).toISOString(),
      supplements: [],
      supplementLog: {},
      workouts: [],
    };
  }
  if (!Array.isArray(log.supplements)) log.supplements = [];
  if (log.supplements.some((entry) => entry.name === name)) return;
  log.supplements.push({ id: randomBytes(8).toString("hex"), name, dose: "", timeOfDay: "anytime" });
  log.updatedAt = new Date().toISOString();

  const temporary = `${file}.tmp-${randomBytes(4).toString("hex")}`;
  await writeFile(temporary, `${JSON.stringify(log, null, 2)}\n`);
  await rename(temporary, file);
}

const started = Date.now();
let attempted = 0;
let failures = 0;

const { addSupplement } =
  mode === "unlocked"
    ? { addSupplement: null }
    : await import(pathToFileURL(path.resolve(distribution, "health.js")).href);

const deadline = started + seconds * 1000;
while (Date.now() < deadline && attempted < cap) {
  attempted += 1;
  const name = `${prefix}-${String(attempted).padStart(5, "0")}`;
  try {
    if (mode === "unlocked") await unlockedAdd(name);
    else await addSupplement(file, name);
  } catch (error) {
    failures += 1;
    if (failures <= 3) console.error(`  node ${mode} error: ${error.message}`);
  }
}

console.log(
  JSON.stringify({
    side: "node",
    mode,
    prefix,
    attempted,
    failures,
    seconds: Math.round((Date.now() - started)) / 1000,
  }),
);
