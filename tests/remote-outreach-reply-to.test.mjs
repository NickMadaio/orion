// WP5 (2026-10-16), spec 3.5 and scenario 10: how a phone message links back to something ORION said first.
// Drives the real `orion-remote handle --from phone --mode chat` with a stub brain that keeps the message
// file, HOME pointed at a temp directory (outreach.jsonl and outreach-consumed.json live in it).
import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const REMOTE = join(dirname(dirname(fileURLToPath(import.meta.url))), "scripts/orion-remote");
const MIN = 60000;
const ago = (minutes) => new Date(Date.now() - minutes * MIN).toISOString();
const ASK = { askId: "ask-1", type: "blank", window: { date: "2026-10-16", start: "14:00", end: null } };

async function lab(rows = []) {
  const home = await mkdtemp(join(tmpdir(), "orion-reply-to-"));
  const dir = join(home, ".openclaw/orion-controlled");
  await mkdir(join(home, ".openclaw/workspace"), { recursive: true });
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "outreach.jsonl"), rows.map((r) => `${JSON.stringify(r)}\n`).join(""));
  const keep = join(home, "kept.txt");
  const brain = join(home, "fake-openclaw");
  await writeFile(brain, `#!/bin/bash\nprev=""\nfor a in "$@"; do [ "$prev" = "--message-file" ] && cp "$a" "${keep}"; prev="$a"; done\necho '{"runId":"r1","status":"ok","result":{"payloads":[{"text":"Noted.","mediaUrl":null}]}}'\n`);
  await chmod(brain, 0o755);
  const env = { PATH: process.env.PATH, HOME: home, ORION_REMOTE_ALLOW: "phone", ORION_BRAIN_BIN: brain };
  const turn = async (words = "gym", replyTo) => {
    await rm(keep, { force: true });
    const args = [REMOTE, "handle", "--from", "phone", "--mode", "chat", ...(replyTo ? ["--reply-to", replyTo] : []), "--", words];
    const done = await exec(process.execPath, args, { env }).then(() => 0, (e) => e.code ?? 1);
    const text = await readFile(keep, "utf8").catch(() => "");
    return { text, done };
  };
  return { home, dir, turn, cleanup: () => rm(home, { recursive: true, force: true }) };
}
const row = (id, minutes, extra = {}) => ({ id, at: ago(minutes), text: `Question ${id}`, kind: "question", channel: "phone", ...extra });

test("--reply-to finds the ask by id, even 80 minutes later, and names the ask", async () => {
  const t = await lab([row("reach-a", 80, { text: "What are you up to? I'll log it.", ask: ASK }), row("reach-b", 5)]);
  try {
    const { text } = await t.turn("gym", "reach-a");
    assert.match(text, /What are you up to\? I'll log it\./);
    assert.match(text, /80 min ago/);
    assert.match(text, /blank ask about 14:00-now/);
    assert.ok(!text.includes("Question reach-b"), "the newer row is not attached when an id is given");
  } finally { await t.cleanup(); }
});

test("without an id, a 30-minute-old plain row is not attached", async () => {
  const t = await lab([row("reach-p", 30)]);
  try { assert.ok(!(await t.turn()).text.includes("Question reach-p")); } finally { await t.cleanup(); }
});

test("without an id, a 60-minute-old ask row is attached (90-minute window)", async () => {
  const t = await lab([row("reach-q", 60, { ask: ASK })]);
  try { assert.match((await t.turn()).text, /Question reach-q/); } finally { await t.cleanup(); }
});

test("an ask older than 90 minutes is not attached, and the old 6-hour list is gone", async () => {
  const t = await lab([row("reach-old", 95, { ask: ASK }), row("reach-older", 200), row("reach-oldest", 300)]);
  try {
    const { text } = await t.turn();
    for (const id of ["reach-old", "reach-older", "reach-oldest"]) assert.ok(!text.includes(`Question ${id}`), id);
  } finally { await t.cleanup(); }
});

test("a recent plain row is attached once, then never again", async () => {
  const t = await lab([row("reach-r", 10)]);
  try {
    assert.match((await t.turn("sure")).text, /Question reach-r/);
    assert.ok(!(await t.turn("and another thing")).text.includes("Question reach-r"));
  } finally { await t.cleanup(); }
});

test("only the single latest row rides along, and held rows never do", async () => {
  const t = await lab([row("reach-1", 15), row("reach-2", 8), row("reach-h", 2, { channel: "hold" })]);
  try {
    const { text } = await t.turn("yes");
    assert.match(text, /Question reach-2/);
    assert.ok(!text.includes("Question reach-1"));
    assert.ok(!text.includes("Question reach-h"));
  } finally { await t.cleanup(); }
});

test("a turn that happened after the row means it is not his answer", async () => {
  const t = await lab([row("reach-s", 20)]);
  try {
    await writeFile(join(t.dir, "outreach-consumed.json"), JSON.stringify({ lastTurnAt: Date.now() - 5 * MIN, ids: [] }));
    assert.ok(!(await t.turn()).text.includes("Question reach-s"));
  } finally { await t.cleanup(); }
});

test("an unknown --reply-to falls back to the timed rule; a bad one is refused", async () => {
  const t = await lab([row("reach-t", 10)]);
  try {
    assert.match((await t.turn("ok", "reach-nope")).text, /Question reach-t/);
    const refused = await t.turn("ok", "bad id; rm -rf");
    assert.notEqual(refused.done, 0);
    assert.equal(refused.text, "", "the brain was never asked");
  } finally { await t.cleanup(); }
});

test("the last question in watch.json counts for 90 minutes, not 6 hours", async () => {
  const day = new Date(Date.now() - 4 * 3600000).toLocaleDateString("en-CA");
  for (const [minutes, shown] of [[60, true], [120, false]]) {
    const t = await lab();
    try {
      await writeFile(join(t.dir, "watch.json"), JSON.stringify({ [day]: { lastQuestion: "Did you eat?", lastQuestionAt: ago(minutes) } }));
      assert.equal((await t.turn("yes")).text.includes("Did you eat?"), shown, `${minutes} min`);
    } finally { await t.cleanup(); }
  }
});
