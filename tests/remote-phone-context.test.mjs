// r8b2 (2026-10-16): the phone message shrinks under local routing (was ~18.6k chars, 14.9k tokens).
// Drives the real `orion-remote handle --from phone --mode chat` with a stub brain that keeps the
// message file, HOME pointed at a temp directory.
import test from "node:test";
import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { compactPhoneMessage, localRoutingOn, MARKER } from "../scripts/lib/remote/phone-context.mjs";

const exec = promisify(execFile);
const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const REMOTE = join(REPO, "scripts/orion-remote");
const WORDS = "move my study block to 3 and push the gym back half an hour";
// A stand-in as big as the real SCHEDULING.md (10,085 chars), so the old path's size is honest.
const SCHEDULING = "Scheduling preference line that the old phone message inlined whole.\n".repeat(146);

async function turn({ routing, words = WORDS }) {
  const home = await mkdtemp(join(tmpdir(), "orion-phone-ctx-"));
  try {
    await mkdir(join(home, ".openclaw/workspace"), { recursive: true });
    await writeFile(join(home, ".openclaw/workspace/SCHEDULING.md"), SCHEDULING);
    if (routing) await writeFile(join(home, ".openclaw/openclaw.json"), JSON.stringify({ plugins: { entries: { "orion-control": { config: { localRouting: routing, ...(routing === "on" ? { localRoutingTestingUntil: new Date(Date.now() + 3600000).toISOString() } : {}) } } } } }));
    const keep = join(home, "kept.txt");
    const brain = join(home, "fake-openclaw");
    await writeFile(brain, `#!/bin/bash\nprev=""\nfor a in "$@"; do [ "$prev" = "--message-file" ] && cp "$a" "${keep}"; prev="$a"; done\necho '{"runId":"r1","status":"ok","result":{"payloads":[{"text":"Moved.","mediaUrl":null}]}}'\n`);
    await chmod(brain, 0o755);
    const env = { PATH: process.env.PATH, HOME: home, ORION_REMOTE_ALLOW: "phone", ORION_BRAIN_BIN: brain };
    await exec(process.execPath, [REMOTE, "handle", "--from", "phone", "--mode", "chat", "--", ...words.split(" ")], { env }).catch((e) => e);
    return await readFile(keep, "utf8");
  } finally { await rm(home, { recursive: true, force: true }); }
}

test("localRouting on: the phone message is small and still ends with Nick's words after the marker", async () => {
  const msg = await turn({ routing: "on" });
  assert.ok(msg.length < 4000, `phone message is ${msg.length} chars`);
  assert.ok(!msg.includes("Scheduling preference line"), "SCHEDULING.md is not inlined");
  assert.match(msg, /read ~\/\.openclaw\/workspace\/SCHEDULING\.md/);
  assert.match(msg, /orion-reschedule/);                 // the one-line day rule
  assert.match(msg, /No open check-ins|Open check-ins/); // check-ins
  // The plugin's userText splits on this marker (local-routing.ts MARKERS) and must find his words.
  assert.equal(msg.split(MARKER).pop().trim(), WORDS);
  assert.match(msg, /Context from the transport, not from Nick/); // the remote check's brief header
});

test("localRouting off or shadow: the full brief is kept for the cloud model", async () => {
  for (const routing of [null, "shadow"]) {
    const msg = await turn({ routing });
    assert.ok(msg.includes("Scheduling preference line"), `${routing}: SCHEDULING.md inlined`);
    assert.ok(msg.length > 12000, `${routing}: ${msg.length}`);
    assert.equal(msg.split(MARKER).pop().trim(), WORDS);
  }
});

test("a small-talk turn skips the day rules, apps and lock lines", async () => {
  const msg = await turn({ routing: "on", words: "thanks that sounds good" });
  assert.ok(msg.length < 2500, `${msg.length}`);
  assert.doesNotMatch(msg, /orion-reschedule|Orion\.app|app lock/);
});

test("nothing the transport adds contains a word the AUTHORITY gate matches", async () => {
  const cat = await readFile(join(REPO, "plugin/orion-control/src/catalog.ts"), "utf8");
  const m = cat.match(/AUTHORITY_INSTRUCTION\s*=\s*\n?\s*(\/.+\/[a-z]*)/);
  const re = new RegExp(m[1].slice(1, m[1].lastIndexOf("/")), "i");
  const every = "move extend later apps open lock show check-in done because day plan schedule class";
  const msg = compactPhoneMessage({
    text: "hi", paths: { show: "/x/orion-show", checkin: "/x/orion-checkin" },
    parts: { today: "- Later today: Study 15:00–16:00 [medium, movable].", checkins: "- No open check-ins.", apps: ["Safari"], lock: "- lock line" },
  });
  const full = compactPhoneMessage({ text: every, paths: { show: "/x/orion-show", checkin: "/x/orion-checkin" },
    parts: { today: "- x", checkins: "- y", apps: ["Safari"], lock: "- lock" } });
  for (const out of [msg, full]) assert.doesNotMatch(out.split(MARKER)[0], re);
});

test("localRoutingOn reads the plugin config and is false when unreadable", async () => {
  assert.equal(localRoutingOn("/nonexistent-home-xyz"), false);
});

// 2026-10-16 (local always, 278d75e): the plugin routes locally whenever localRouting is "on" — no acceptance gate, no testing
// window — so the phone's compact text follows the same rule (review 5 M4 mirrored the old gate).
test("localRoutingOn is true exactly when localRouting is on, whatever the window or acceptance record", async () => {
  const now = Date.parse("2026-10-16T22:00:00Z");
  const home = async (config) => {
    const h = await mkdtemp(join(tmpdir(), "phone-gate-"));
    await mkdir(join(h, ".openclaw"), { recursive: true });
    await writeFile(join(h, ".openclaw/openclaw.json"), JSON.stringify({ plugins: { entries: { "orion-control": { config } } } }));
    return h;
  };
  assert.equal(localRoutingOn(await home({ localRouting: "on" }), now), true, "on, no window, no record");
  assert.equal(localRoutingOn(await home({ localRouting: "on", localRoutingTestingUntil: "2026-10-16T20:58:39Z" }), now), true, "on, window closed");
  assert.equal(localRoutingOn(await home({ localRouting: "shadow" }), now), false, "shadow");
  assert.equal(localRoutingOn(await home({ localRouting: "off" }), now), false, "off");
});
