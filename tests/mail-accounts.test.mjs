// Several mailboxes for the mail watcher (wave 17): the accounts file and CLI, the read-only IMAP client against a local fake server,
// and orion-mail-watch end to end with a fake gog per account, a fake `security` and a fake IMAP server. No real network.
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { addGmail, addImap, normalizeAccounts, removeAccount, keychainService } from "../scripts/lib/mail/accounts.mjs";
import { fetchRecent, responseEnd } from "../scripts/lib/mail/imap-client.mjs";
import { digestLine, alertLine } from "../scripts/lib/mail/alert.mjs";
import { makeRule, ruleMatches } from "../scripts/lib/mail/prefs.mjs";
import { mailTick } from "../scripts/lib/mail/tick.mjs";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
const NOW = new Date(2026, 10, 2, 14, 0);
const at = (minutes) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const rowsOf = (path) => existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const SECRET = "yahoo-app-pw-test-only";

// ---- accounts config (pure)

test("accounts: the default is the one Gmail; adds label themselves, reject duplicates and junk, never hold a password", () => {
  assert.deepEqual(normalizeAccounts(null).map((a) => a.id), ["gmail"]);
  const two = addGmail(normalizeAccounts(null), "Second@Gmail.com");
  assert.deepEqual(two.at(-1), { id: "gmail-2", kind: "gmail", address: "second@gmail.com", label: "Gmail (second)" });
  const three = addImap(two, "nick@yahoo.com");
  assert.deepEqual(three.at(-1), { id: "yahoo", kind: "imap", address: "nick@yahoo.com", label: "Yahoo", host: "imap.mail.yahoo.com", port: 993 });
  assert.throws(() => addGmail(three, "second@gmail.com"), /already added/);
  assert.throws(() => addImap(three, "me@weird.example"), /--host/);
  assert.throws(() => addImap(three, "me@weird.example", { host: "bad host!" }), /--host/);
  assert.throws(() => addImap(three, "me@weird.example", { host: "imap.weird.example", port: 99999 }), /port/);
  assert.throws(() => addGmail(three, "not an address"), /email/);
  assert.equal(removeAccount(three, "nick@yahoo.com").list.length, 2);
  assert.equal(removeAccount(three, "nope").removed, 0);
  assert.doesNotMatch(JSON.stringify(three), /password|secret/i);
  assert.equal(normalizeAccounts([{ id: "x", kind: "imap", address: "a@b.co", host: "imap.b.co", port: "abc" }, { id: "ok", kind: "gmail", address: "a@b.co" }]).length, 1, "a bad row is dropped");
  assert.equal(keychainService("Nick@Yahoo.com"), "orion-mail-imap:nick@yahoo.com");
});

test("alerts name the account only when the item carries one; mixed digests name each", () => {
  const m = (n, account) => ({ messageId: `m${n}`, fromName: `Sam P${n}`, fromAddress: `s${n}@gmail.com`, domain: "gmail.com", subject: "lunch friday", snippet: "", ...(account ? { account } : {}) });
  assert.match(alertLine(m(1, "Yahoo")), /^Yahoo: Sam P1 emailed about lunch friday/);
  assert.match(alertLine(m(1)), /^Sam P1 emailed/);
  assert.match(digestLine([m(1, "Yahoo"), m(2, "Yahoo")]), /^Yahoo: 2 emails worth a look: Sam P1 about lunch friday; Sam P2/);
  assert.match(digestLine([m(1, "Yahoo"), m(2, "Gmail")]), /^2 emails worth a look: Sam P1 \(Yahoo\) about lunch friday; Sam P2 \(Gmail\) about/);
});

test("a rule given an account applies to that account only; without one it is global", () => {
  const item = { fromAddress: "deals@shop.com", fromName: "Shop", domain: "shop.com", subject: "sale", snippet: "", accountId: "yahoo" };
  const global = makeRule({ action: "mute", kind: "sender", value: "deals@shop.com" });
  const scoped = makeRule({ action: "mute", kind: "sender", value: "deals@shop.com", account: "yahoo" });
  assert.equal(ruleMatches(global, { ...item, accountId: "gmail" }), true);
  assert.equal(ruleMatches(scoped, item), true);
  assert.equal(ruleMatches(scoped, { ...item, accountId: "gmail" }), false);
  assert.notEqual(global.id, scoped.id);
});

// ---- the IMAP client against a local fake server

function fakeImap({ password = SECRET, messages = [], greet = true, uidvalidity = 77 } = {}) {
  const log = [];
  const server = net.createServer((sock) => {
    if (greet) sock.write("* OK fake imap ready\r\n");
    let buf = "";
    sock.on("error", () => {});
    sock.on("data", (c) => {
      buf += c;
      for (let i = buf.indexOf("\r\n"); i >= 0; i = buf.indexOf("\r\n")) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        const [tag, verb, ...args] = line.split(" ");
        log.push(`${verb} ${args.slice(0, verb === "LOGIN" ? 0 : 6).join(" ")}`.trim());
        if (verb === "LOGIN") sock.write(args[1] === `"${password}"` ? `${tag} OK logged in\r\n` : `${tag} NO [AUTHENTICATIONFAILED] bad\r\n`);
        else if (verb === "EXAMINE") sock.write(`* 3 EXISTS\r\n* OK [UIDVALIDITY ${uidvalidity}] ok\r\n${tag} OK [READ-ONLY] done\r\n`);
        else if (verb === "UID" && args[0] === "SEARCH") sock.write(`* SEARCH ${messages.map((m) => m.uid).join(" ")}\r\n${tag} OK done\r\n`);
        else if (verb === "UID" && args[0] === "FETCH") {
          const wanted = args[1].split(",").map(Number);
          for (const m of messages.filter((x) => wanted.includes(x.uid))) {
            const head = `From: ${m.from}\r\nSubject: ${m.subject}\r\nDate: Mon, 2 Nov 2026 13:00:00 -0500\r\n${m.unsub ? "List-Unsubscribe: <x>\r\n" : ""}\r\n`;
            const body = m.body ?? "";
            sock.write(`* ${m.uid} FETCH (UID ${m.uid} BODY[HEADER.FIELDS (FROM SUBJECT)] {${Buffer.byteLength(head)}}\r\n${head} BODY[TEXT]<0> {${Buffer.byteLength(body)}}\r\n${body})\r\n`);
          }
          sock.write(`${tag} OK done\r\n`);
        } else if (verb === "LOGOUT") { sock.write(`* BYE\r\n${tag} OK bye\r\n`); sock.end(); }
        else sock.write(`${tag} BAD unknown\r\n`);
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, log, port: server.address().port, set: (m) => { messages = m; } })));
}
const MSG = (uid, extra = {}) => ({ uid, from: "Sam Person <sam@gmail.com>", subject: "lunch friday?", body: "are you free for lunch", ...extra });

test("imap client: logs in, opens read-only, searches, fetches with PEEK, never changes anything, and parses literals", async () => {
  const fake = await fakeImap({ messages: [MSG(5), MSG(6, { body: "line one\r\nline two" })] });
  try {
    const rows = await fetchRecent({ host: "127.0.0.1", port: fake.port, plain: true, user: "nick@yahoo.com", password: SECRET, since: new Date(Date.UTC(2026, 10, 1)), isSeen: (k) => k === "77.5" });
    assert.deepEqual(rows.map((r) => r.key), ["77.6"], "a seen message is not fetched");
    assert.match(rows[0].headers.toString(), /Subject: lunch friday\?/);
    assert.equal(rows[0].snippet.toString(), "line one\r\nline two");
    await new Promise((r) => setTimeout(r, 100));   // the LOGOUT is sent as the session closes
    const verbs = fake.log.map((l) => l.split(" ")[0] + (l.startsWith("UID") ? ` ${l.split(" ")[1]}` : ""));
    assert.deepEqual(verbs, ["LOGIN", "EXAMINE", "UID SEARCH", "UID FETCH", "LOGOUT"]);
    assert.ok(fake.log.some((l) => /^UID FETCH/.test(l)));
    assert.ok(!fake.log.some((l) => /STORE|SELECT|COPY|EXPUNGE|APPEND|DELETE/.test(l)));
  } finally { fake.server.close(); }
});

test("imap client: PEEK is in the fetch command; keysOnly fetches no message; a wrong password says sign-in refused without the password", async () => {
  let command = "";
  const fake = await fakeImap({ messages: [MSG(1)] });
  const orig = fake.server.listeners("connection")[0];
  fake.server.removeAllListeners("connection");
  fake.server.on("connection", (s) => { s.on("data", (c) => { if (/UID FETCH/.test(String(c))) command = String(c); }); orig(s); });
  try {
    const keys = await fetchRecent({ host: "127.0.0.1", port: fake.port, plain: true, user: "u@y.com", password: SECRET, since: new Date(), keysOnly: true });
    assert.deepEqual(keys.map((r) => r.key), ["77.1"]);
    assert.equal(command, "", "the first poll reads no message");
    await fetchRecent({ host: "127.0.0.1", port: fake.port, plain: true, user: "u@y.com", password: SECRET, since: new Date() });
    assert.match(command, /BODY\.PEEK\[HEADER\.FIELDS \(FROM SUBJECT DATE MESSAGE-ID LIST-UNSUBSCRIBE/);
    assert.match(command, /BODY\.PEEK\[TEXT\]<0\.\d+>/);
    assert.doesNotMatch(command.replace(/BODY\.PEEK/g, ""), /BODY\[/, "every body fetch is a peek");
    await assert.rejects(fetchRecent({ host: "127.0.0.1", port: fake.port, plain: true, user: "u@y.com", password: "WRONG-pw-123", since: new Date() }), (e) => /sign-in refused/.test(e.message) && !/WRONG-pw-123/.test(e.message));
  } finally { fake.server.close(); }
});

test("imap client: a server that never answers times out; plain sockets are refused for real hosts", async () => {
  const fake = await fakeImap({ greet: false });
  try {
    const started = Date.now();
    await assert.rejects(fetchRecent({ host: "127.0.0.1", port: fake.port, plain: true, user: "u@y.com", password: SECRET, since: new Date(), timeoutMs: 300 }), /didn't answer|didn't finish/);
    assert.ok(Date.now() - started < 3000);
  } finally { fake.server.close(); }
  await assert.rejects(fetchRecent({ host: "imap.mail.yahoo.com", plain: true, user: "u@y.com", password: SECRET, since: new Date() }), /localhost tests only/);
  assert.equal(responseEnd(Buffer.from("* 1 FETCH (X {4}\r\nO1 \r\n)\r\nO1 OK done\r\n"), "O1") > 20, true, "a literal that looks like a tag does not end the response");
});

// ---- per-account behaviour in mailTick (injected fakes)

function tickWorld(accounts, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "orion-mailacct-"));
  const said = [];
  return { dir, said, deps: { dir, now: NOW, ctx: { people: [], courses: ["CS2100"] }, accounts, askModel: null,
    reach: async (text, opts) => { said.push({ text, ...opts }); return { ok: true, id: `r${said.length}` }; }, ...extra } };
}
const sender = (n, extra = {}) => ({ key: `k${n}`, threadId: `t${n}`, messageId: `m${n}`, fromName: "Prof. Jane Smith", fromAddress: "j.smith@northeastern.edu", domain: "northeastern.edu",
  subject: "CS2100 midterm room", snippet: "room change", labels: [], listUnsubscribe: false, precedenceBulk: false, nickInThread: false, fromNick: false, ...extra });
const acct = (id, label, kind, box, extra = {}) => ({ id, label, kind, reconnectText: `${label} needs reconnecting`, fetchInbox: async (o) => box.fn(o), ...extra });
const later = (min) => new Date(NOW.getTime() + min * 60_000);

test("per-account dedupe: the same key in two accounts is two messages, and a seen one is never alerted twice", async () => {
  const gmail = { fn: async () => [] }; const yahoo = { fn: async () => [] };
  const { deps, said } = tickWorld([acct("gmail", "Gmail", "gmail", gmail), acct("yahoo", "Yahoo", "imap", yahoo)]);
  await mailTick(deps);   // first poll: seeds both
  gmail.fn = async () => [sender(1)];
  yahoo.fn = async () => [sender(1)];   // the very same key and message id, in another account
  const r = await mailTick({ ...deps, now: later(11) });
  assert.equal(r.fresh, 2);
  assert.match(said[0].text, /^2 emails worth a look: .*\(Gmail\).*\(Yahoo\)/);
  const again = await mailTick({ ...deps, now: later(45) });
  assert.equal(again.fresh, 0, "both are seen now");
  assert.equal(said.length, 1);
});

test("a new account's first poll only learns what is there; the old account keeps alerting meanwhile", async () => {
  const gmail = { fn: async () => [] }; const yahoo = { fn: async () => [sender(9), sender(8)] };
  const { deps, said, dir } = tickWorld([acct("gmail", "Gmail", "gmail", gmail)]);
  await mailTick(deps);
  gmail.fn = async () => [sender(1)];
  const both = [acct("gmail", "Gmail", "gmail", gmail), acct("yahoo", "Yahoo", "imap", yahoo)];
  const r = await mailTick({ ...deps, accounts: both, now: later(11) });
  assert.equal(r.fresh, 1, "yahoo's old mail was only learned");
  assert.match(said[0].text, /^Gmail: Jane Smith/);
  assert.ok(rowsOf(join(dir, "mail-seen.jsonl")).some((s) => s.key === "yahoo:k9" && s.level === "seeded"));
  assert.equal(JSON.parse(readFileSync(join(dir, "mail-state.json"), "utf8")).accounts.yahoo.seeded, true);
});

test("sign-in trouble is told once a day per account, each in its own words; the other account keeps working", async () => {
  const boom = (text) => ({ fn: async () => { throw new Error(text); } });
  const gmail = { fn: async () => [] };
  const yahoo = boom("IMAP sign-in refused: the app password was not accepted (authentication failed)");
  const g2 = boom("Gmail's sign-in expired — run `gog auth add second@gmail.com` to reconnect.");
  const accounts = [acct("gmail", "Gmail", "gmail", gmail), acct("gmail-2", "Gmail (second)", "gmail", g2),
    acct("yahoo", "Yahoo", "imap", yahoo, { reconnectText: "Yahoo needs an app password" })];
  const { deps, said } = tickWorld(accounts);
  writeFileSync(join(deps.dir, "mail-seen.jsonl"), "");
  await mailTick(deps);
  assert.deepEqual(said.map((s) => s.text).sort(), ["Gmail (second) needs reconnecting", "Yahoo needs an app password"]);
  await mailTick({ ...deps, now: later(11) });
  await mailTick({ ...deps, now: later(200) });
  assert.equal(said.length, 2, "not again the same day");
  await mailTick({ ...deps, now: new Date(2026, 10, 3, 14, 0), force: true });
  assert.equal(said.length, 4, "a day later, each again");
  const state = JSON.parse(readFileSync(join(deps.dir, "mail-state.json"), "utf8"));
  assert.equal(state.problem ?? null, null, "the healthy account is clean");
  assert.equal(state.accounts.yahoo.problem, "expired");
});

test("a network failure on one account is told to nobody; one account failing never blocks another's alerts", async () => {
  const gmail = { fn: async () => [] }; const yahoo = { fn: async () => { throw new Error("could not reach the mail server: getaddrinfo ENOTFOUND imap.mail.yahoo.com"); } };
  const { deps, said } = tickWorld([acct("gmail", "Gmail", "gmail", gmail), acct("yahoo", "Yahoo", "imap", yahoo)]);
  writeFileSync(join(deps.dir, "mail-seen.jsonl"), "");
  await mailTick(deps);
  gmail.fn = async () => [sender(1)];
  const r = await mailTick({ ...deps, now: later(11) });
  assert.match(said.at(-1).text, /^Gmail: /);
  assert.equal(said.length, 1);
  assert.equal(r.polled, true);
});

// ---- the whole thing: orion-mail-watch with fake gog (per account), fake security, fake IMAP

const FAKE_GOG = `#!/usr/bin/env node
const fs = require("fs");
const a = process.argv.slice(2);
const account = a[a.indexOf("--account") + 1];
const all = JSON.parse(fs.readFileSync(process.env.FAKE_GOG_STATE, "utf8"));
const state = all[account] || { mode: "expired" };
fs.appendFileSync(process.env.FAKE_GOG_LOG, JSON.stringify({ account, args: a }) + "\\n");
if (state.mode === "expired") { process.stderr.write("oauth2: invalid_grant: Token has been expired or revoked."); process.exit(1); }
if (a[0] === "gmail" && a[1] === "search") { console.log(JSON.stringify({ threads: state.threads })); process.exit(0); }
if (a[0] === "gmail" && a[1] === "thread" && a[2] === "get") { console.log(JSON.stringify(state.full[a[3]])); process.exit(0); }
process.stderr.write("unknown"); process.exit(2);
`;
const FAKE_SECURITY = `#!/bin/sh
[ "$FAKE_KEYCHAIN" = "have" ] && [ "$1" = "find-generic-password" ] && [ "$3" = "orion-mail-imap:nick@yahoo.com" ] && [ "$4" = "-w" ] && { echo "${SECRET}"; exit 0; }
echo "security: not found" >&2; exit 44
`;

function world(imapPort) {
  const root = mkdtempSync(join(tmpdir(), "orion-mailacct-e2e-"));
  const dir = join(root, "ctl"); const bin = join(root, "bin"); const repo = join(root, "repo"); const home = join(root, "home");
  for (const d of [dir, bin, repo, home]) mkdirSync(d, { recursive: true });
  writeFileSync(join(repo, ".env"), "GOG_KEYRING_PASSWORD=test-only\n");
  writeFileSync(join(bin, "gog"), FAKE_GOG); chmodSync(join(bin, "gog"), 0o755);
  writeFileSync(join(bin, "security"), FAKE_SECURITY); chmodSync(join(bin, "security"), 0o755);
  const iso = NOW.toISOString();
  writeFileSync(join(dir, "awareness.json"), JSON.stringify({ schema: "orion.awareness.v1", at: iso, session: { state: "none", at: iso, source: "socket" },
    calendar: { state: "ok", now: null, next: null, at: iso }, location: { state: "unknown", at: null }, mac: { state: "active", idleSeconds: 5, at: iso },
    audio: { mac: { route: "speakers", headphones: false, at: iso }, phone: { route: "unknown", at: null } }, sleep: { state: "awake", inWindow: false, at: iso } }));
  writeFileSync(join(dir, "life-config.json"), JSON.stringify({ bedtime: "23:59", usualWake: "00:01" }));
  writeFileSync(join(dir, "knowledge-graph.json"), JSON.stringify({ nodes: [{ id: "course:cs2100", type: "course", label: "CS2100", facts: [{ text: "Taught by Prof. Jane Smith" }] }] }));
  const gogState = join(root, "gog.json");
  const env = (extra = {}) => ({ PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, ORION_CONTROLLED_DIR: dir, ORION_MAIL_ROOT: repo,
    ORION_AWARENESS_NO_REFRESH: "1", ORION_SESSION_SOCKET: join(home, "no.sock"), ORION_REACH_FACTS: JSON.stringify({ idleSeconds: 5, locked: false, headphones: false }),
    FAKE_GOG_STATE: gogState, FAKE_GOG_LOG: join(root, "gog.log"), ORION_MAIL_NO_MODEL: "1", ORION_MAIL_IMAP_PLAIN: "1", FAKE_KEYCHAIN: "have", ...extra });
  const setGmail = (accounts) => writeFileSync(gogState, JSON.stringify(Object.fromEntries(Object.entries(accounts).map(([addr, { mode = "ok", mails = [] }]) => [addr, { mode,
    threads: mails.map((m) => ({ id: m.id, date: "2026-11-02 13:00", from: m.from, subject: m.subject })),
    full: Object.fromEntries(mails.map((m) => [m.id, { thread: { id: m.id, messages: [{ id: `${m.id}-m`, labelIds: ["INBOX"], snippet: m.snippet ?? "", body: "BODY-NEVER-READ", headers: { from: m.from, subject: m.subject } }] } }])) }]))));
  writeFileSync(join(dir, "mail-accounts.json"), JSON.stringify([
    { id: "gmail", kind: "gmail", address: "nmadaio08@gmail.com", label: "Gmail" },
    { id: "gmail-2", kind: "gmail", address: "second@gmail.com", label: "Gmail (second)" },
    { id: "yahoo", kind: "imap", address: "nick@yahoo.com", label: "Yahoo", host: "127.0.0.1", port: imapPort }]));
  return { root, dir, env, setGmail, gogLog: () => rowsOf(join(root, "gog.log")) };
}
const exec = (script, w, args, extra) => new Promise((resolve) => {
  const child = spawn(process.execPath, [join(SCRIPTS, script), ...args], { env: w.env(extra) });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (c) => { stdout += c; }); child.stderr.on("data", (c) => { stderr += c; });
  child.on("close", (status) => resolve({ status, stdout, stderr }));
});
const PROF = (id) => ({ id, from: "\"Prof. Jane Smith\" <j.smith@northeastern.edu>", subject: "CS2100 Midterm", snippet: "room change to West 110" });

test("watcher end to end: three accounts, a fake gog per account, a fake IMAP server; labelled alerts, per-account dedupe, read-only, no secret anywhere", async () => {
  const fake = await fakeImap({ messages: [MSG(1, { from: "Barista <hi@cafe.com>", subject: "your receipt", unsub: true })] });
  const w = world(fake.port);
  try {
    w.setGmail({ "nmadaio08@gmail.com": { mails: [] }, "second@gmail.com": { mails: [] } });
    const first = await exec("orion-mail-watch", w, ["tick", "--json"], { ORION_NOW: at(0) });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /first poll/);
    assert.equal(fake.log.some((l) => l.startsWith("UID FETCH")), false, "no message read on the first poll");
    // new mail: yahoo gets a professor's note, second gmail too
    fake.set([MSG(1, { from: "Barista <hi@cafe.com>", subject: "your receipt", unsub: true }), MSG(2, { from: "\"Prof. Jane Smith\" <j.smith@northeastern.edu>", subject: "CS2100 Midterm", body: "room change to West 110" })]);
    const second = await exec("orion-mail-watch", w, ["tick", "--json"], { ORION_NOW: at(11) });
    const out = JSON.parse(second.stdout);
    assert.match(out.said, /^Yahoo: /, second.stdout + second.stderr);
    assert.match(out.said, /CS2100 Midterm/);
    assert.equal(fake.log.filter((l) => l.startsWith("UID FETCH")).length, 1);
    w.setGmail({ "nmadaio08@gmail.com": { mails: [] }, "second@gmail.com": { mails: [PROF("t-2")] } });
    const third = await exec("orion-mail-watch", w, ["tick", "--json"], { ORION_NOW: at(45) });
    assert.match(JSON.parse(third.stdout).said, /^Gmail \(second\): /, third.stdout);
    const fetchesBefore = fake.log.filter((l) => l.startsWith("UID FETCH")).length;
    const fourth = await exec("orion-mail-watch", w, ["tick", "--json"], { ORION_NOW: at(80) });
    assert.equal(JSON.parse(fourth.stdout).said, null, "nothing new, nothing said");
    assert.equal(fake.log.filter((l) => l.startsWith("UID FETCH")).length, fetchesBefore, "seen mail is not fetched again");
    // gog calls: per account, read-only
    const calls = w.gogLog();
    assert.ok(calls.some((c) => c.account === "second@gmail.com") && calls.some((c) => c.account === "nmadaio08@gmail.com"));
    for (const c of calls) assert.ok(c.args.includes("--readonly") && c.args.includes("--gmail-no-send"));
    assert.ok(!fake.log.some((l) => /STORE|SELECT|COPY|EXPUNGE|APPEND/.test(l)));
    const alerts = rowsOf(join(w.dir, "mail-alerts.jsonl"));
    assert.deepEqual(alerts.map((a) => a.items[0].account), ["Yahoo", "Gmail (second)"]);
    for (const f of readdirSync(w.dir)) { const t = readFileSync(join(w.dir, f), "utf8"); assert.equal(t.includes(SECRET) || t.includes("BODY-NEVER-READ"), false, f); }
    assert.equal((second.stdout + second.stderr + third.stdout).includes(SECRET), false);
  } finally { fake.server.close(); }
});

test("watcher end to end: missing app password and an expired second Gmail are each told once a day; the first Gmail works on", async () => {
  const w = world(1);
  w.setGmail({ "nmadaio08@gmail.com": { mails: [] }, "second@gmail.com": { mode: "expired" } });
  const env = { FAKE_KEYCHAIN: "none" };
  const a = await exec("orion-mail-watch", w, ["tick", "--json"], { ...env, ORION_NOW: at(0) });
  assert.equal(a.status, 0, a.stderr);
  await exec("orion-mail-watch", w, ["tick", "--json"], { ...env, ORION_NOW: at(11) });
  await exec("orion-mail-watch", w, ["tick", "--json"], { ...env, ORION_NOW: at(40) });
  const told = rowsOf(join(w.dir, "outreach.jsonl")).map((r) => r.text);
  assert.equal(told.filter((t) => /^Yahoo needs an app password/.test(t)).length, 1, told.join(" | "));
  assert.equal(told.filter((t) => /^Gmail \(second\) needs reconnecting.*gog auth add second@gmail\.com/.test(t)).length, 1, told.join(" | "));
  assert.equal(told.filter((t) => /^Gmail needs reconnecting/.test(t)).length, 0);
  await exec("orion-mail-watch", w, ["tick", "--json"], { ...env, ORION_NOW: new Date(2026, 10, 3, 14, 0).toISOString() });
  assert.equal(rowsOf(join(w.dir, "outreach.jsonl")).filter((r) => /needs/.test(r.text)).length, 4, "told again a day later");
});

// ---- the CLI

test("orion-mail-accounts: list, add-gmail, add-imap prints the Keychain step, refuses passwords, remove, status", async () => {
  const fake = await fakeImap({ messages: [] });
  const w = world(fake.port);
  writeFileSync(join(w.dir, "mail-accounts.json"), "null");
  try {
    const list = await exec("orion-mail-accounts", w, ["list", "--json"]);
    assert.deepEqual(JSON.parse(list.stdout).accounts.map((a) => a.id), ["gmail"]);
    const g = await exec("orion-mail-accounts", w, ["add-gmail", "second@gmail.com"]);
    assert.equal(g.status, 0, g.stderr);
    assert.match(g.stdout, /gog auth add second@gmail\.com/);
    const y = await exec("orion-mail-accounts", w, ["add-imap", "nick@yahoo.com"]);
    assert.match(y.stdout, /security add-generic-password -s 'orion-mail-imap:nick@yahoo\.com' -a 'nick@yahoo\.com' -w\s*$/m);
    assert.doesNotMatch(y.stdout, /-w \S/, "no password on the command line");
    const saved = JSON.parse(readFileSync(join(w.dir, "mail-accounts.json"), "utf8"));
    assert.deepEqual(saved.map((a) => a.id), ["gmail", "gmail-2", "yahoo"]);
    assert.equal(saved[2].host, "imap.mail.yahoo.com");
    const before = readFileSync(join(w.dir, "mail-accounts.json"), "utf8");
    for (const bad of [["add-imap", "x@y.co", "--host", "imap.y.co", "--password", "hunter2"], ["add-imap", "x@y.co", "--host", "imap.y.co", "--password=hunter2"], ["add-gmail", "second@gmail.com"], ["add-imap", "x@y.co"], ["remove", "ghost"]]) {
      const r = await exec("orion-mail-accounts", w, bad);
      assert.ok(r.status === 2 || r.status === 3, bad.join(" "));
    }
    assert.equal(readFileSync(join(w.dir, "mail-accounts.json"), "utf8"), before, "bad calls saved nothing");
    // status: point the yahoo row at the fake server; gmail-2 is not signed in, the first Gmail is
    writeFileSync(join(w.dir, "mail-accounts.json"), JSON.stringify([...saved.slice(0, 2), { ...saved[2], host: "127.0.0.1", port: fake.port }]));
    w.setGmail({ "nmadaio08@gmail.com": { mails: [] } });
    const st = JSON.parse((await exec("orion-mail-accounts", w, ["status", "--json"])).stdout).accounts;
    assert.deepEqual(st.map((s) => s.state), ["connected", "expired", "connected"]);
    const none = JSON.parse((await exec("orion-mail-accounts", w, ["status", "--json"], { FAKE_KEYCHAIN: "none" })).stdout).accounts;
    assert.equal(none[2].state, "no-password");
    assert.match(none[2].say, /security add-generic-password/);
    const rm = await exec("orion-mail-accounts", w, ["remove", "nick@yahoo.com"]);
    assert.equal(rm.status, 0);
    assert.deepEqual(JSON.parse(readFileSync(join(w.dir, "mail-accounts.json"), "utf8")).map((a) => a.id), ["gmail", "gmail-2"]);
  } finally { fake.server.close(); }
});
