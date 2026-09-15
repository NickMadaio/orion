// Drives the plugin's OWN health.ts code path (the built dist the daemon runs),
// against the default production path — same file, same lock, different process.
import os from "node:os";
import path from "node:path";
import { writeFileSync } from "node:fs";

const mod = await import(
  path.join(os.homedir(), "Desktop/ORION/plugin/orion-control/dist/health.js")
);
const { addSupplement, defaultHealthLogPath } = mod;

const [prefix, secondsRaw, startAtRaw, outPath] = process.argv.slice(2);
const seconds = Number(secondsRaw);
const startAt = Number(startAtRaw);
const file = defaultHealthLogPath();

while (Date.now() < startAt) { /* spin to the shared start */ }

const deadline = startAt + seconds * 1000;
let issued = 0;
let threw = 0;
let firstError = "";
while (Date.now() < deadline) {
  try {
    await addSupplement(file, `${prefix}-${String(issued).padStart(5, "0")}`);
  } catch (error) {
    threw += 1;
    if (!firstError) firstError = `${error.code ?? ""} ${error.message}`.trim();
  }
  issued += 1;
}
writeFileSync(outPath, String(issued));
process.stderr.write(
  `ts:    issued ${issued} writes in ${seconds}s, ${threw} errored` +
  (firstError ? ` (first: ${firstError})` : "") + "\n"
);
