#!/usr/bin/env node
// Live smoke test for computer use through Orion.app's relay (2026-10-31).
//
// Run AFTER installing Orion.app (with Accessibility granted), the release bridge, and building the plugin:
//
//   node scripts/eval/computer-smoke.mjs
//
// Opens TextEdit, makes a new document, types "orion test", reads it back off the screen, closes the
// document WITHOUT saving (presses "Delete" / "Don't Save" on the sheet), and quits TextEdit if it was
// not already running. Every screen step goes through the relay, never a direct spawn, so a pass proves
// Orion.app's grant, not this terminal's. Touches nothing but TextEdit. Exit 0 = pass.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "../../plugin/orion-control/dist");
const BUNDLE = "com.apple.TextEdit";
const WORDS = "orion test";

if (!existsSync(join(DIST, "computer-relay.js"))) {
  console.error(`FAIL: ${DIST} is not built. Run: (cd plugin/orion-control && npm run build)`);
  process.exit(2);
}
const relay = await import(pathToFileURL(join(DIST, "computer-relay.js")).href);
const { createMacBridge } = await import(pathToFileURL(join(DIST, "computer-bridge.js")).href);
const { flatten } = await import(pathToFileURL(join(DIST, "computer-ax.js")).href);

const paths = relay.relayPaths();
const WHY = {
  down: "the Orion app isn't running (no fresh heartbeat in computer-relay/heartbeat.json)",
  untrusted: "the Orion app is running but lacks Accessibility",
  no_bridge: "the Orion app can't find orion-mac-bridge (~/.openclaw/orion-remote/bin or the repo's release build)",
};
const state = relay.relayAppState(paths);
if (state !== "ready") {
  console.error(`FAIL: relay not ready: ${WHY[state] ?? state}`);
  process.exit(2);
}

// The relay, forced: a heartbeat flicker must not fall back to this terminal's own grant.
const forced = { state: () => "ready", send: (action, payload) => relay.relayRequest(action, payload, { paths }) };
const openOnly = async (file, args) => {
  if (file !== "/usr/bin/open") throw new Error(`smoke: refusing a direct spawn of ${file}`);
  try { execFileSync(file, [...args]); return { stdout: "", stderr: "", code: 0 }; } catch (e) { return { stdout: "", stderr: String(e.message), code: 1 }; }
};
const bridge = createMacBridge({ relay: forced, run: openOnly });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (line) => console.log(`- ${line}`);
const nodes = async () => flatten((await bridge.observe()).element);
// TextEdit auto-capitalises the first letter ("Orion test"), so the read-back ignores case.
const holdsWords = (list) => list.some((n) => (n.value ?? "").toLowerCase().includes(WORDS.toLowerCase()));

let wasRunning = true;
try { execFileSync("/usr/bin/pgrep", ["-x", "TextEdit"]); } catch { wasRunning = false; }

let passed = false;
try {
  step("opening TextEdit");
  await bridge.openApp({ name: "TextEdit", bundleId: BUNDLE });
  await sleep(1500);
  step("File > New");
  await bridge.menu(BUNDLE, ["File", "New"]);
  await sleep(1000);
  step(`typing "${WORDS}"`);
  await bridge.type(BUNDLE, WORDS);
  await sleep(500);
  const typed = await nodes();
  if (!holdsWords(typed)) throw new Error(`read-back did not find "${WORDS}" in the focused window`);
  step(`read back "${WORDS}" from the screen`);

  step("File > Close");
  await bridge.menu(BUNDLE, ["File", "Close"]);
  await sleep(1000);
  const sheet = await nodes();
  const discard = sheet.find((n) => n.role === "AXButton" && /^(Delete|Don['’]t Save)$/.test(n.label ?? ""));
  if (!discard) throw new Error("the save sheet's Delete / Don't Save button was not found; the document is still open, close it by hand");
  step(`pressing "${discard.label}" (close without saving)`);
  await bridge.press(BUNDLE, { path: discard.path, role: discard.role, label: discard.label });
  // TextEdit's iCloud save sheet can take a few seconds to go after Delete, so wait for the words to leave rather than one look.
  let after = [];
  for (let tries = 0; tries < 12; tries += 1) {
    await sleep(500);
    after = await nodes().catch(() => []);
    if (!holdsWords(after)) break;
  }
  if (holdsWords(after)) throw new Error("the document still shows the typed words after closing");
  passed = true;
} catch (error) {
  console.error(`FAIL: ${error.kind ? `[${error.kind}] ` : ""}${error.message}`);
} finally {
  if (!wasRunning) {
    step("quitting TextEdit (it was not running before)");
    await bridge.menu(BUNDLE, ["TextEdit", "Quit TextEdit"]).catch((e) => console.error(`  could not quit TextEdit: ${e.message}`));
  }
}
console.log(passed ? "PASS: computer use through the Orion app relay" : "FAIL");
process.exit(passed ? 0 : 1);
