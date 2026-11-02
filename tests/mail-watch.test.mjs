// The mail watcher end to end (wave 14): orion-mail-watch with a fake gog on PATH, a fake Ollama, and the real orion-reach in an
// isolated state dir (its alerts land in that dir's outbox, never on a phone). Plus mailTick with injected fakes for the edge cases.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { mailTick } from "../scripts/lib/mail/tick.mjs";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
const NOW = new Date(2026, 10, 2, 14, 0);   // a Monday afternoon, local time: awake, not quiet hours
const rowsOf = (path) => existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const at = (minutes) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

const FAKE_GOG = `#!/usr/bin/env node
const fs = require("fs");
const state = JSON.parse(fs.readFileSync(process.env.FAKE_GOG_STATE, "utf8"));
fs.appendFileSync(process.env.FAKE_GOG_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
if (state.mode === "expired") { process.stderr.write("oauth2: invalid_grant: Token has been expired or revoked."); process.exit(1); }
const a = process.argv.slice(2);
if (a[0] === "gmail" && a[1] === "search") { console.log(JSON.stringify({ threads: state.threads })); process.exit(0); }
if (a[0] === "gmail" && a[1] === "thread" && a[2] === "get") { console.log(JSON.stringify(state.full[a[3]])); process.exit(0); }
process.stderr.write("unknown"); process.exit(2);
`;

function world() {
  const root = mkdtempSync(join(tmpdir(), "orion-mail-"));
  const dir = join(root, "ctl"); const bin = join(root, "bin"); const repo = join(root, "repo"); const home = join(root, "home");
  for (const d of [dir, bin, repo, home]) mkdirSync(d, { recursive: true });
  writeFileSync(join(repo, ".env"), "GOG_KEYRING_PASSWORD=test-only\n");
  writeFileSync(join(bin, "gog"), FAKE_GOG); chmodSync(join(bin, "gog"), 0o755);
  const iso = NOW.toISOString();
  writeFileSync(join(dir, "awareness.json"), JSON.stringify({ schema: "orion.awareness.v1", at: iso,
    session: { state: "none", at: iso, source: "socket" }, calendar: { state: "ok", now: null, next: null, at: iso },
    location: { state: "unknown", at: null }, mac: { state: "active", idleSeconds: 5, at: iso },
    audio: { mac: { route: "speakers", headphones: false, at: iso }, phone: { route: "unknown", at: null } },
    sleep: { state: "awake", inWindow: false, at: iso } }));
  writeFileSync(join(dir, "life-config.json"), JSON.stringify({ bedtime: "23:59", usualWake: "00:01" }));
  writeFileSync(join(dir, "knowledge-graph.json"), JSON.stringify({ nodes: [{ id: "course:cs2100", type: "course", label: "CS2100", facts: [{ text: "Taught by Prof. Jane Smith" }] }] }));
  const gogState = join(root, "gog.json");
  const env = (extra = {}) => ({ PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, ORION_CONTROLLED_DIR: dir, ORION_MAIL_ROOT: repo,
    ORION_AWARENESS_NO_REFRESH: "1", ORION_SESSION_SOCKET: join(home, "no.sock"), ORION_REACH_FACTS: JSON.stringify({ idleSeconds: 5, locked: false, headphones: false }),
    FAKE_GOG_STATE: gogState, FAKE_GOG_LOG: join(root, "gog.log"), ORION_MAIL_NO_MODEL: "1", ...extra });
  const setInbox = (mode, mails = []) => writeFileSync(gogState, JSON.stringify({ mode,
    threads: mails.map((m) => ({ id: m.id, date: m.date ?? "2026-11-02 13:00", from: m.from, subject: m.subject })),
    full: Object.fromEntries(mails.map((m) => [m.id, { thread: { id: m.id, messages: [{ id: `${m.id}-m`, labelIds: m.labels ?? ["INBOX"], snippet: m.snippet ?? "", body: "BODY-NEVER-READ",
      headers: { from: m.from, subject: m.subject, ...(m.unsubscribe ? { "list-unsubscribe": "<x>" } : {}) } }] } }])) }));
  return { root, dir, env, setInbox, gogLog: () => rowsOf(join(root, "gog.log")) };
}

const run = (w, args, extra) => new Promise((resolve) => {
  const child = spawn(process.execPath, [join(SCRIPTS, "orion-mail-watch"), ...args], { env: w.env(extra) });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (c) => { stdout += c; }); child.stderr.on("data", (c) => { stderr += c; });
  child.on("close", (status) => resolve({ status, stdout, stderr }));
});

const PROF = { id: "t-prof", from: "\"Prof. Jane Smith\" <j.smith@northeastern.edu>", subject: "CS2100 Midterm", snippet: "Hi all, room change to West 110 for Thursday's midterm" };
const PROMO = { id: "t-promo", from: "Zara <news@e.zara.com>", subject: "New arrivals: 30% off", unsubscribe: true, labels: ["CATEGORY_PROMOTIONS"] };
const ALEX = { id: "t-alex", from: "Alex Turner <alex.t@gmail.com>", subject: "hey", snippet: "long time no see" };

test("first poll learns the inbox silently and reads no thread; the next poll alerts on new important mail only, read-only", async () => {
  const w = world();
  w.setInbox("ok", [PROMO]);
  const first = await run(w, ["tick", "--json"], { ORION_NOW: at(0) });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /first poll/);
  assert.equal(w.gogLog().some((a) => a.includes("thread")), false, "no thread read on the first poll");
  w.setInbox("ok", [PROMO, PROF]);
  const early = await run(w, ["tick", "--json"], { ORION_NOW: at(5) });
  assert.match(early.stdout, /under 10 min/);
  const second = await run(w, ["tick", "--json"], { ORION_NOW: at(11) });
  assert.equal(second.status, 0, second.stderr);
  const out = JSON.parse(second.stdout);
  assert.equal(out.said, "Prof. Smith emailed about the CS2100 Midterm — 'room change to West 110 for Thursday's midterm'");
  for (const call of w.gogLog()) { assert.ok(call.includes("--readonly") && call.includes("--gmail-no-send"), JSON.stringify(call)); }
  assert.deepEqual(w.gogLog().filter((a) => a[1] === "thread").map((a) => a[3]), ["t-prof"], "only the new thread is read");
  const sent = rowsOf(join(w.dir, "outreach.jsonl"));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].tier, "low");
  assert.match(sent[0].why, /^mail: 1 important/);
  assert.equal(sent[0].kind, "info");
  const box = rowsOf(join(w.dir, "outreach-outbox.jsonl"));
  assert.equal(box[0].text, out.said, "mirrored into his chat thread");
  const alerts = rowsOf(join(w.dir, "mail-alerts.jsonl"));
  assert.equal(alerts[0].items[0].fromAddress, "j.smith@northeastern.edu");
  assert.equal(readFileSync(join(w.dir, "mail-seen.jsonl"), "utf8").includes("BODY-NEVER-READ"), false);
  assert.equal(readFileSync(join(w.dir, "mail-state.json"), "utf8").includes("BODY-NEVER-READ"), false);
});

test("an expired sign-in is told once a day, not every poll", async () => {
  const w = world();
  w.setInbox("expired");
  const a = await run(w, ["tick", "--json"], { ORION_NOW: at(0) });
  assert.equal(JSON.parse(a.stdout).said?.startsWith("Gmail needs reconnecting"), true, a.stdout + a.stderr);
  await run(w, ["tick", "--json"], { ORION_NOW: at(11) });
  await run(w, ["tick", "--json"], { ORION_NOW: at(30) });
  const told = rowsOf(join(w.dir, "outreach.jsonl")).filter((r) => /Gmail needs reconnecting/.test(r.text));
  assert.equal(told.length, 1);
  const tomorrow = await run(w, ["tick", "--json"], { ORION_NOW: new Date(2026, 10, 3, 14, 0).toISOString() });
  assert.match(JSON.parse(tomorrow.stdout).said ?? "", /Gmail needs reconnecting/);
});

test("a borderline mail asks the fake Ollama with strict JSON; a broken answer falls back to the rules", async () => {
  const w = world();
  const seen = [];
  let answer = '{"important": true, "why": "an old friend"}';
  const server = createServer((req, res) => { let b = ""; req.on("data", (c) => { b += c; }); req.on("end", () => { seen.push(JSON.parse(b)); res.end(JSON.stringify({ response: answer })); }); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    w.setInbox("ok", []);
    await run(w, ["tick"], { ORION_NOW: at(0) });
    w.setInbox("ok", [ALEX]);
    const r = await run(w, ["tick", "--json"], { ORION_NOW: at(11), ORION_MAIL_NO_MODEL: "", ORION_MAIL_OLLAMA_URL: url });
    assert.equal(seen.length, 1, r.stderr);
    assert.equal(seen[0].format, "json");
    assert.equal(seen[0].model, "qwen3.5:4b-q4_K_M");
    assert.doesNotMatch(seen[0].prompt, /BODY-NEVER-READ/);
    assert.equal(JSON.parse(r.stdout).verdicts[0].by, "local model");
    assert.match(JSON.parse(r.stdout).said, /^Alex Turner emailed about hey/);
    answer = "sure!";
    w.setInbox("ok", [ALEX, { ...ALEX, id: "t-alex2", subject: "lunch" }]);
    const r2 = await run(w, ["tick", "--json"], { ORION_NOW: at(50), ORION_MAIL_NO_MODEL: "", ORION_MAIL_OLLAMA_URL: url });
    assert.equal(JSON.parse(r2.stdout).verdicts[0].by, "rules (model had no answer)");
  } finally { server.close(); }
});

test("a mute rule from orion-mail-prefs silences a sender the rules would flag", async () => {
  const w = world();
  const prefs = (args) => new Promise((resolve) => { const c = spawn(process.execPath, [join(SCRIPTS, "orion-mail-prefs"), ...args], { env: w.env() }); let o = ""; c.stdout.on("data", (d) => { o += d; }); c.on("close", (s) => resolve({ s, o })); });
  assert.equal((await prefs(["add", "mute", "sender", "smith"])).s, 0);
  w.setInbox("ok", []);
  await run(w, ["tick"], { ORION_NOW: at(0) });
  w.setInbox("ok", [PROF]);
  const r = await run(w, ["tick", "--json"], { ORION_NOW: at(11) });
  assert.equal(JSON.parse(r.stdout).said, null);
  assert.equal(JSON.parse(r.stdout).verdicts[0].by, "his rule");
});

// ---- mailTick with injected fakes

function fakeDeps(dir, inbox, overrides = {}) {
  const said = [];
  return { said, deps: { dir, now: NOW, ctx: { people: [], courses: ["CS2100"] }, fetchInbox: async () => inbox(), askModel: null,
    reach: async (text, opts) => { said.push({ text, ...opts }); return { ok: true, id: `r${said.length}` }; }, ...overrides } };
}
const mail = (n, extra = {}) => ({ key: `k${n}`, threadId: `t${n}`, messageId: `m${n}`, fromName: `Sam Person${n}`, fromAddress: `sam${n}@gmail.com`, domain: "gmail.com",
  subject: "CS2100 study group tomorrow", snippet: "are you coming", labels: [], listUnsubscribe: false, precedenceBulk: false, nickInThread: false, fromNick: false, ...extra });

test("spacing across ticks: a second important mail within 30 min waits, then goes in a digest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orion-mailtick-"));
  let inbox = [];
  const { said, deps } = fakeDeps(dir, () => inbox);
  await mailTick({ ...deps });                                    // first poll: seeds nothing
  inbox = [mail(1)];
  await mailTick({ ...deps, now: new Date(NOW.getTime() + 11 * 60_000) });
  inbox = [mail(1), mail(2)];
  const held = await mailTick({ ...deps, now: new Date(NOW.getTime() + 22 * 60_000) });
  assert.equal(held.said, null);
  inbox = [mail(1), mail(2), mail(3)];
  const digest = await mailTick({ ...deps, now: new Date(NOW.getTime() + 45 * 60_000) });
  assert.equal(said.length, 2);
  assert.equal(digest.said, "2 emails worth a look: Sam Person2 about the CS2100 study group tomorrow; Sam Person3 about the CS2100 study group tomorrow.");
});

test("urgent mail skips the spacing; a reach that refuses keeps the mail waiting", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orion-mailtick-"));
  let inbox = [];
  let accept = true;
  const { said, deps } = fakeDeps(dir, () => inbox, { reach: async (text, o) => { if (!accept) return { ok: false }; said.push({ text, ...o }); return { ok: true }; } });
  await mailTick(deps);
  inbox = [mail(1)];
  await mailTick({ ...deps, now: new Date(NOW.getTime() + 11 * 60_000) });
  inbox = [mail(1), mail(2, { fromName: "Barclays", fromAddress: "no-reply@barclays.co.uk", domain: "barclays.co.uk", subject: "Your security code", snippet: "one-time passcode 123456" })];
  const urgent = await mailTick({ ...deps, now: new Date(NOW.getTime() + 22 * 60_000) });
  assert.equal(urgent.said, "Barclays emailed about your security code");
  assert.equal(said.at(-1).urgent, true);
  accept = false;
  inbox = [...inbox, mail(3)];
  const refused = await mailTick({ ...deps, now: new Date(NOW.getTime() + 60 * 60_000) });
  assert.equal(refused.said, null);
  const state = JSON.parse(readFileSync(join(dir, "mail-state.json"), "utf8"));
  assert.deepEqual(state.queue.map((q) => q.messageId), ["m3"]);
});

test("a sandboxed run uses the eval- files and never touches the real ones", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orion-mailtick-"));
  const { deps } = fakeDeps(dir, () => [mail(1)]);
  await mailTick({ ...deps, sandboxed: true });
  assert.equal(existsSync(join(dir, "eval-mail-seen.jsonl")), true);
  assert.equal(existsSync(join(dir, "mail-seen.jsonl")), false);
  assert.equal(existsSync(join(dir, "mail-state.json")), false);
});

test("the hook: orion-watches' tick runs the mail watcher, and `mail off` stops it", async () => {
  const w = world();
  w.setInbox("ok", [PROF]);
  const tick = (args) => new Promise((resolve) => { const c = spawn(process.execPath, [join(SCRIPTS, "orion-watches"), ...args], { env: w.env({ ORION_NOW: at(0) }) }); let o = ""; c.stderr.on("data", (d) => { o += d; }); c.on("close", (s) => resolve({ s, o })); });
  assert.equal((await tick(["tick"])).s, 0);
  assert.equal(existsSync(join(w.dir, "mail-seen.jsonl")), true, "the watcher ran and seeded what was there");
  assert.equal((await tick(["mail", "off"])).s, 0);
  const before = readFileSync(join(w.dir, "mail-state.json"), "utf8");
  await tick(["tick"]);
  assert.equal(readFileSync(join(w.dir, "mail-state.json"), "utf8"), before);
});

test("orion-mail-prefs: list, add with an inferred kind, remove, me; bad input saves nothing", async () => {
  const w = world();
  const prefs = (...args) => new Promise((resolve) => { const c = spawn(process.execPath, [join(SCRIPTS, "orion-mail-prefs"), ...args], { env: w.env() }); let o = ""; let e = ""; c.stdout.on("data", (d) => { o += d; }); c.stderr.on("data", (d) => { e += d; }); c.on("close", (s) => resolve({ s, o, e })); });
  assert.match((await prefs("list")).o, /No mail rules yet/);
  const add = JSON.parse((await prefs("add", "mute", "linkedin.com", "--json")).o);
  assert.deepEqual([add.rule.action, add.rule.kind, add.rule.value], ["mute", "domain", "linkedin.com"]);
  assert.match((await prefs("add", "boost", "job", "offers")).o, /Will always alert on topic "job offers"/);
  assert.match((await prefs("list")).o, /Mail rules \(2\):[\s\S]*not important {2}domain: linkedin\.com[\s\S]*always tell {2}topic: job offers/);
  assert.equal((await prefs("add", "hide", "x")).s, 2);
  assert.equal((await prefs("remove", "nothing-like-this")).s, 3);
  assert.match((await prefs("remove", add.rule.id)).o, /Removed 1 rule/);
  assert.match((await prefs("me", "add", "Nick@School.edu")).o, /nick@school\.edu/);
  assert.equal((await prefs("me", "add", "not-an-address")).s, 2);
  const file = JSON.parse(readFileSync(join(w.dir, "mail-prefs.json"), "utf8"));
  assert.deepEqual(file.rules.map((r) => r.value), ["job offers"]);
  assert.deepEqual(file.me, ["nick@school.edu"]);
});

test("at most four model calls per poll; the rest fall back to the rules", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orion-mailtick-"));
  let inbox = [];
  let asked = 0;
  const borderline = (n) => mail(n, { subject: "hey", snippet: "long time" });
  const { deps } = fakeDeps(dir, () => inbox, { askModel: async () => { asked += 1; return { important: false, why: "chat" }; } });
  await mailTick(deps);
  inbox = [1, 2, 3, 4, 5, 6].map(borderline);
  const r = await mailTick({ ...deps, now: new Date(NOW.getTime() + 11 * 60_000) });
  assert.equal(asked, 4);
  assert.deepEqual(r.verdicts.map((v) => v.by), ["local model", "local model", "local model", "local model", "rules (model had no answer)", "rules (model had no answer)"]);
});

test("during an evaluation the watcher does not poll at all", async () => {
  const w = world();
  w.setInbox("ok", [PROF]);
  writeFileSync(join(w.dir, "eval-mode"), "");
  const r = await run(w, ["tick", "--json"], { ORION_NOW: at(0) });
  assert.equal(JSON.parse(r.stdout).reason, "evaluation");
  assert.equal(w.gogLog().length, 0);
  assert.equal(existsSync(join(w.dir, "mail-seen.jsonl")), false);
});
