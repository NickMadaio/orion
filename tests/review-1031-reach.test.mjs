// 2026-10-31 review of the proactive loop: finding 2 (the closing message is never held by the hourly cap, and the Mac voice copy
// of L2 is not a second message) and finding 3 (the phone's context line names the block the way the plugin reads it).
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { allowed } from "../scripts/lib/reach/route.mjs";

const NOW = Date.parse("2026-10-30T18:05:00Z");
const row = (i, extra = {}) => ({ id: `r${i}`, at: new Date(NOW - (50 - i * 5) * 60000).toISOString(), text: `line ${i}`, channel: "phone", ...extra });

test("finding 2: six messages this hour hold an ordinary line but never the closing message", () => {
  const history = [0, 1, 2, 3, 4, 5].map((i) => row(i));
  assert.equal(allowed("Time to start: Study.", history, { now: NOW }).ok, false);
  assert.equal(allowed("Gym didn't happen at 5:00 PM. I've moved it to 9:20 PM.", history, { now: NOW, capExempt: true }).ok, true);
  assert.equal(allowed("line 5", history, { now: NOW, capExempt: true }).ok, false, "an exact repeat is still a repeat");
});

test("finding 2: the Mac voice copy of L2 is not counted as a second message", () => {
  const history = [0, 1, 2].flatMap((i) => [row(i, { askId: `ci-gym-L${i}` }), row(i + 10, { askId: `ci-gym-L${i}-voice`, channel: "mac-voice" })]);
  assert.equal(history.length, 6);
  assert.equal(allowed("Time to start: Study.", history, { now: NOW }).ok, true);
});

test("finding 3: the phone's line for a mismatch ask says `\"Gym\", planned 17:00-18:30`, the shape the plugin reads", async () => {
  const { chmod, mkdir, mkdtemp, readFile, writeFile } = await import("node:fs/promises");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const home = await mkdtemp(join((await import("node:os")).tmpdir(), "orion-askdetail-"));
  const dir = join(home, ".openclaw/orion-controlled"); await mkdir(dir, { recursive: true }); await mkdir(join(home, ".openclaw/workspace"), { recursive: true });
  const at = new Date(Date.now() - 60_000).toISOString();
  const ask = { type: "mismatch", kind: "mismatch", blockId: "cal-gym1", title: "Gym", window: { date: "2026-10-30", start: 1020, end: 1110 }, askId: "ci-gym-L0" };
  await writeFile(join(dir, "outreach.jsonl"), `${JSON.stringify({ id: "reach-1", at, text: "Time to start: Gym. Gym: 0 of the last 6 happened. Not today.", kind: "checkin", channel: "phone", ask, askId: "ci-gym-L0" })}\n`);
  const keep = join(home, "kept.txt"); const brain = join(home, "fake-openclaw");
  await writeFile(brain, `#!/bin/bash\nprev=""\nfor a in "$@"; do [ "$prev" = "--message-file" ] && cp "$a" "${keep}"; prev="$a"; done\necho '{"runId":"r1","status":"ok","result":{"payloads":[{"text":"Noted.","mediaUrl":null}]}}'\n`);
  await chmod(brain, 0o755);
  await promisify(execFile)(process.execPath, [join(import.meta.dirname, "../scripts/orion-remote"), "handle", "--from", "phone", "--mode", "chat", "--", "I'm meal prepping"],
    { env: { PATH: process.env.PATH, HOME: home, ORION_REMOTE_ALLOW: "phone", ORION_BRAIN_BIN: brain } }).catch(() => {});
  const text = await readFile(keep, "utf8");
  assert.match(text, /\(mismatch ask "Gym", planned 17:00-18:30, not started\)/);
  assert.doesNotMatch(text, /planned about/);
});

test("finding 2: orion-reach sends the closing message even when six lines reached him this hour", async () => {
  const { world, at } = await import("./incident-world.mjs");
  const w = world({ day: 30 });
  w.appendOutreach([0, 1, 2, 3, 4, 5].map((i) => ({ id: `r${i}`, at: at(30, 17, 10 + i * 5).toISOString(), text: `line ${i}`, kind: "checkin", why: "plan: x", channel: "phone" })));
  const ask = (rung) => JSON.stringify({ type: "mismatch", blockId: "cal-gym1", title: "Gym", level: 5, rung, askId: `ci-gym-${rung}` });
  const l1 = w.run("orion-reach", ["Study — still not started.", "--kind", "checkin", "--why", "plan: cal-s", "--ask", ask("L1")], 18, 5);
  assert.match(l1.stdout, /^NOT SENT: already reached him 6 times this hour/);
  const end = w.run("orion-reach", ["Gym didn't happen at 5:00 PM. I've moved it to 9:20 PM–10:50 PM.", "--kind", "checkin", "--why", "plan: cal-gym1", "--tier", "protected", "--ask", ask("END")], 18, 5);
  assert.match(end.stdout, /^Sent/, end.stdout + end.stderr);
});
