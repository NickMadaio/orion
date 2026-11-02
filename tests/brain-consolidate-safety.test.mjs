// Wave 12 fixer (2026-11-02): the reviewer blocked the nightly tidy-up because it could lose real facts. Each test is one of the
// scenarios it named: qualifiers read as duplicates, tagged short facts read as junk, prose "until <date>" read as an expiry,
// forgotten facts promoted back from the journal, a concurrent `orion-brain learn` overwritten, and unbounded removals a night.
// Fixtures are temp dirs; no real paths.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPlan, consolidateNote, consolidateUser, expired, planConsolidation, promotionHash, sameFact } from "../scripts/lib/brain/consolidate.mjs";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "orion-memory-consolidate.mjs");
const NOW = new Date("2026-11-02T12:00:00");
const note = (lines) => `---\ntitle: Nick\n---\n\n# Nick\n\n## Learned\n${lines.join("\n")}\n`;

test("sameFact: only the same words count; a fact whose qualifiers differ is never a duplicate", () => {
  assert.equal(sameFact("likes tea", "likes team sports"), false);
  assert.equal(sameFact("no study after 22", "no study after 22 on fridays"), false);
  assert.equal(sameFact("likes gym in the evening", "likes gym in the morning"), false);
  assert.equal(sameFact("Nick likes gym in the evening.", "nick likes gym in the evening!"), true);
  assert.equal(sameFact("evening gym, likes", "likes gym evening"), true);   // same word set, order aside
});

test("consolidateNote keeps both facts when one only adds a qualifier, and both sides of a conflict", () => {
  const text = note([
    "- [preference] likes tea (2026-10-01)",
    "- [preference] likes team sports (2026-10-02)",
    "- [rule] no study after 22 (2026-10-03)",
    "- [rule] no study after 22 on fridays (2026-10-04)",
    "- [preference] likes gym in the morning (2026-10-05)",
    "- [preference] likes gym in the evening (2026-10-20)",
  ]);
  const out = consolidateNote(text, { now: NOW });
  assert.deepEqual(out.actions, []);
  assert.equal(out.text, text);
});

test("consolidateNote: an exact duplicate keeps the newer line, never the older one", () => {
  const out = consolidateNote(note(["- [fact] lifts with Sam (2026-10-01)", "- [fact] Lifts with Sam! (2026-10-20)"]), { now: NOW });
  assert.match(out.text, /Lifts with Sam! \(2026-10-20\)/);
  assert.doesNotMatch(out.text, /2026-10-01/);
});

test("short facts with a category tag are never junk ([allergy] peanuts, [name] Sam)", () => {
  const text = note(["- [allergy] peanuts (2026-10-01)", "- [name] Sam (2026-10-02)", "- [fact] ok (2026-10-03)"]);
  const out = consolidateNote(text, { now: NOW });
  assert.deepEqual(out.actions, []);
  assert.match(out.text, /\[allergy\] peanuts/);
  assert.match(out.text, /\[name\] Sam/);
});

test("expired: only explicitly temporary facts lapse; prose that says 'until <date>' never does", () => {
  assert.equal(expired("- [fact] Library card renewal until 2026-10-30 (2026-10-01)", NOW), false);
  assert.equal(expired("- 2026-10-01 — Rule: no gym until 2026-10-20 means nothing to tidy", NOW), false);
  assert.equal(expired("- [fact] off caffeine (until 2026-10-20) (2026-10-01)", NOW), true);
  assert.equal(expired("- [fact] off caffeine (until 2026-11-20) (2026-10-01)", NOW), false);
  assert.equal(expired("- [fact] in Rome this week #temp (2026-10-10)", NOW), true);
  assert.equal(expired("- [fact] in Rome this week #temp (2026-10-30)", NOW), false);
  assert.equal(expired("- 2026-10-01 — Temporary: Nick is off caffeine (until 2026-10-20).", NOW), true);
});

function world({ nick, user = "# Nick\n", days = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "consolidate-safe-"));
  const ws = join(root, "workspace"); const vault = join(root, "vault"); const controlled = join(root, "controlled");
  mkdirSync(join(ws, "memory"), { recursive: true }); mkdirSync(join(vault, "20 Areas", "Me"), { recursive: true }); mkdirSync(controlled);
  writeFileSync(join(ws, "USER.md"), user);
  for (const [day, text] of Object.entries(days)) writeFileSync(join(ws, "memory", `${day}.md`), text);
  const nickPath = join(vault, "20 Areas", "Me", "Nick.md");
  writeFileSync(nickPath, nick ?? note(["- [fact] DS lab partner is Priya (2026-10-16)"]));
  const run = (...args) => spawnSync(process.execPath, [CLI, "--workspace", ws, "--vault", vault, "--controlled", controlled, "--now", NOW.toISOString(), ...args], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: root } });
  return { root, ws, vault, controlled, nickPath, run };
}

const NAPS = "- 02:22 PM — [auto] First, naps should be at least an hour and 15 minutes long ALWAYS.";
const DAY = `# 2026-10-01\n\n## Episodes\n\n${NAPS}\n`;

test("a promoted fact that Nick forgets does not come back the next night (ledger + forget records)", async () => {
  const w = world({ days: { "2026-10-01": DAY } });
  assert.equal(w.run("--apply").status, 0);
  assert.match(readFileSync(w.nickPath, "utf8"), /\[said\] First, naps/);
  const ledger = readFileSync(join(w.controlled, "consolidate-promoted.jsonl"), "utf8");
  assert.match(ledger, new RegExp(promotionHash("2026-10-01", "First, naps should be at least an hour and 15 minutes long ALWAYS.")));
  // Nick forgets it through the normal path (archived to memory-archive.jsonl, gone from the note).
  const { listEntries, archiveEntries } = await import("../scripts/lib/brain/forget.mjs");
  const dirs = { vaultDir: w.vault, workspaceDir: w.ws, controlledDir: w.controlled };
  const said = listEntries(dirs).find((e) => e.store === "vault" && /naps/.test(e.text));
  archiveEntries(dirs, [said.id]);
  assert.doesNotMatch(readFileSync(w.nickPath, "utf8"), /naps/);
  const again = w.run("--apply");
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(readFileSync(w.nickPath, "utf8"), /naps/);
  // The ledger alone is enough, even if the archive is lost.
  writeFileSync(join(w.controlled, "memory-archive.jsonl"), "");
  w.run("--apply");
  assert.doesNotMatch(readFileSync(w.nickPath, "utf8"), /naps/);
});

test("forget records alone also stop a promotion (a fact he forgot before the ledger existed)", () => {
  const w = world({ days: { "2026-10-01": DAY } });
  writeFileSync(join(w.controlled, "memory-archive.jsonl"), `${JSON.stringify({ id: "abcdef0123", store: "vault", file: "20 Areas/Me/Nick.md", line: 9, raw: "- [said] First, naps should be at least an hour and 15 minutes long ALWAYS. (2026-10-01)", archivedAt: "2026-10-05T10:00:00.000Z" })}\n`);
  w.run("--apply");
  assert.doesNotMatch(readFileSync(w.nickPath, "utf8"), /naps/);
});

test("applyPlan: a file changed since planning (a concurrent orion-brain learn) is left alone, and written via tmp+rename", () => {
  const nick = note(["- [fact] DS lab partner is Priya (2026-10-16)", "- [fact] DS lab partner is Priya (2026-10-17)"]);
  const w = world({ nick });
  const plan = planConsolidation({ workspace: w.ws, vault: w.vault, now: NOW });
  assert.equal(plan.files.length, 1);
  appendFileSync(w.nickPath, "- [fact] lifts with Sam on tuesdays (2026-11-02)\n");   // the learn lands between plan and write
  const out = applyPlan(plan, { backupDir: join(w.controlled, "bk") });
  assert.deepEqual(out.written, []);
  assert.deepEqual(out.skipped, [w.nickPath]);
  const after = readFileSync(w.nickPath, "utf8");
  assert.match(after, /lifts with Sam on tuesdays/);
  assert.equal(after.match(/Priya/g).length, 2);   // untouched: next night's plan sees the new text
});

test("CLI --apply: at most 10 removals a night, the rest is a dry-run report; every removal logged with its full text", () => {
  const long = "x".repeat(400);
  const lines = Array.from({ length: 14 }, (_, i) => `- [fact] repeated fact number ${i} ${long} (2026-10-01)`);
  const nick = note([...lines, ...lines.map((l) => l.replace("2026-10-01", "2026-10-02"))]);
  const w = world({ nick });
  const out = w.run("--apply");
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /10 removal/);
  assert.match(out.stdout, /4 more .*next night|deferred/i);
  const after = readFileSync(w.nickPath, "utf8");
  assert.equal(after.split("\n").filter((l) => l.startsWith("- [fact]")).length, 18);
  const log = readFileSync(join(w.controlled, "consolidate.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const applied = log.filter((r) => r.action === "drop-duplicate" && r.dryRun === false);
  const deferred = log.filter((r) => r.action === "drop-duplicate" && r.dryRun === true);
  assert.equal(applied.length, 10);
  assert.equal(deferred.length, 4);
  assert.ok(applied.every((r) => r.text.length > 400 && r.text.endsWith("(2026-10-01)") && r.backup));
  // The next night finishes the job.
  w.run("--apply");
  assert.equal(readFileSync(w.nickPath, "utf8").split("\n").filter((l) => l.startsWith("- [fact]")).length, 14);
});

test("consolidateUser: a dated rule mentioning 'until <date>' in prose stays", () => {
  const user = "# Nick\n- 2026-10-01 — Rule: Nick wants ORION not to book anything until 2026-10-20 has passed on fridays.\n";
  assert.deepEqual(consolidateUser(user, { now: NOW }).actions, []);
});
