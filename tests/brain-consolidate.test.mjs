// Wave 12 (2026-11-02): the nightly tidy-up of what ORION learned. Nick.md had seven "## Learned" headers and a duplicated creatine
// line, USER.md's learned bullets were never deduplicated, the journal's [auto] episodes were mostly prompt scaffolding, and nothing
// turned a good episode into a fact or let a temporary fact lapse. Fixtures are temp dirs; no real paths.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  consolidateNote, consolidateUser, durableEpisodes, expired, mergeLearnedHeaders, planConsolidation, applyPlan,
} from "../scripts/lib/brain/consolidate.mjs";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "orion-memory-consolidate.mjs");
const NOW = new Date("2026-11-02T12:00:00");

const NICK = `---
title: Nick
---

# Nick

## Observations
- [identity] Nick Madaio

## Relations
- builds [[ORION]]

## Learned
- [fact] DS lab partner is Priya (2026-10-16)

## Learned

## Learned
- [fact] Nick takes creatine every morning at 8 (2026-10-16)

## Learned
- [fact] Nick takes creatine every morning at 8 (2026-10-16)

## Learned
- [fact] nick takes creatine every morning at 8am (2026-10-20)
- [temp] Nick is in Rome until Sunday (2026-10-10)
- [fact] Library card renewal until 2026-10-30 (2026-10-01)
- [fact] ok (2026-10-02)
`;

const USER = `# Nick

- 2026-09-29 — **Times are 12-hour: "8:11 PM", never "20:11", and never both in
  one answer.**

Store only user-stated, durable, useful facts.
- 2026-11-01 — Preference: Nick likes gym in the evening.
- 2026-11-02 — Preference: Nick likes gym in the evening!
- 2026-10-01 — Temporary: Nick is off caffeine (until 2026-10-20).
- 2026-11-02 — Rule: Nick calls it CS2101, not "the lab".
`;

const DAY = `# 2026-10-01

## Episodes

- 02:22 PM — [auto] First, naps should be at least an hour and 15 minutes long ALWAYS.
- 02:21 PM — [auto] First, naps should be at least an hour and 15 minutes long ALWAYS!
- 02:20 PM — [auto] Answer the whole thing.) Exactly remember that part.
- 02:19 PM — [auto] actually do resume before gym
- 02:18 PM — [auto] ok

## Noted

- 10:00 AM — Nick decided to drop macro study for now
`;

test("mergeLearnedHeaders: one header where the first was, every entry kept in order, nothing else moved", () => {
  const out = mergeLearnedHeaders(NICK);
  assert.equal(out.match(/^## Learned$/gm).length, 1);
  assert.ok(out.indexOf("## Relations") < out.indexOf("## Learned"));
  const entries = out.slice(out.indexOf("## Learned")).split("\n").filter((l) => l.startsWith("- "));
  assert.equal(entries.length, 7);
  assert.match(out, /- \[identity\] Nick Madaio/);
  assert.equal(mergeLearnedHeaders(out), out);   // idempotent
});

test("expired: [temp] lapses after 14 days, 'until <date>' after the date, a plain fact never", () => {
  assert.equal(expired("- [temp] Nick is in Rome until Sunday (2026-10-10)", NOW), true);
  assert.equal(expired("- [temp] Nick is in Rome until Sunday (2026-10-30)", NOW), false);
  assert.equal(expired("- [fact] Library card renewal until 2026-10-30 (2026-10-01)", NOW), true);
  assert.equal(expired("- 2026-10-01 — Temporary: Nick is off caffeine (until 2026-10-20).", NOW), true);
  assert.equal(expired("- 2026-10-31 — Temporary: Nick is off caffeine.", NOW), false);
  assert.equal(expired("- [fact] DS lab partner is Priya (2026-10-16)", NOW), false);
});

test("consolidateNote: merges headers, drops duplicates and near-duplicates, junk and expired facts; says why for each", () => {
  const { text, actions } = consolidateNote(NICK, { now: NOW });
  assert.equal(text.match(/^## Learned$/gm).length, 1);
  assert.equal(text.match(/creatine/g).length, 1);
  assert.doesNotMatch(text, /Rome|Library card|\[fact\] ok/);
  assert.match(text, /Priya/);
  const kinds = actions.map((a) => a.action).sort();
  assert.deepEqual(kinds, ["drop-duplicate", "drop-duplicate", "drop-expired", "drop-expired", "drop-junk", "merge-headers"]);
  assert.ok(actions.every((a) => a.reason));
  assert.deepEqual(consolidateNote(text, { now: NOW }).actions, []);   // a second run finds nothing
});

test("consolidateNote: promoted episodes become dated facts, but not twice and not when a fact already says it", () => {
  const promote = [{ text: "First, naps should be at least an hour and 15 minutes long ALWAYS.", day: "2026-10-01" }, { text: "Nick takes creatine every morning at 8", day: "2026-10-03" }];
  const { text, actions } = consolidateNote(NICK, { now: NOW, promote });
  assert.match(text, /- \[said\] First, naps should be at least an hour and 15 minutes long ALWAYS\. \(2026-10-01\)/);
  assert.equal(actions.filter((a) => a.action === "promote-episode").length, 1);
  assert.equal(consolidateNote(text, { now: NOW, promote }).actions.filter((a) => a.action === "promote-episode").length, 0);
});

test("consolidateUser: only learned one-line bullets are touched; duplicates and expired go, the template stays", () => {
  const { text, actions } = consolidateUser(USER, { now: NOW });
  assert.match(text, /Times are 12-hour/);
  assert.equal(text.match(/gym in the evening/g).length, 1);
  assert.doesNotMatch(text, /caffeine/);
  assert.match(text, /CS2101/);
  assert.deepEqual(actions.map((a) => a.action).sort(), ["drop-duplicate", "drop-expired"]);
});

test("durableEpisodes and the journal: junk and near-duplicate [auto] lines are dropped, standing lines are promoted", () => {
  const { keep, drop } = durableEpisodes(DAY);
  assert.deepEqual(keep.map((k) => k.text), ["First, naps should be at least an hour and 15 minutes long ALWAYS."]);
  assert.equal(drop.length, 3);   // near-duplicate, scaffolding, filler ("actually do resume before gym" is kept in the journal, not promoted)
  assert.ok(drop.every((d) => d.reason));
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "consolidate-"));
  const ws = join(root, "workspace"); const vault = join(root, "vault"); const controlled = join(root, "controlled");
  mkdirSync(join(ws, "memory"), { recursive: true }); mkdirSync(join(vault, "20 Areas", "Me"), { recursive: true }); mkdirSync(controlled);
  writeFileSync(join(ws, "USER.md"), USER);
  writeFileSync(join(ws, "memory", "2026-10-01.md"), DAY);
  writeFileSync(join(vault, "20 Areas", "Me", "Nick.md"), NICK);
  const run = (...args) => spawnSync(process.execPath, [CLI, "--workspace", ws, "--vault", vault, "--controlled", controlled, "--now", NOW.toISOString(), ...args], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: root } });
  return { root, ws, vault, controlled, run };
}

test("planConsolidation + applyPlan: one plan over all three stores, backups before any write", () => {
  const f = fixture();
  const plan = planConsolidation({ workspace: f.ws, vault: f.vault, now: NOW });
  assert.ok(plan.files.length >= 3);
  const backups = join(f.controlled, "bk");
  applyPlan(plan, { backupDir: backups });
  for (const file of plan.files) assert.ok(existsSync(join(backups, file.backupName)), file.path);
  assert.equal(readFileSync(join(f.vault, "20 Areas", "Me", "Nick.md"), "utf8").match(/^## Learned$/gm).length, 1);
});

test("CLI: dry run by default writes nothing but the log; --apply writes, backs up and logs", () => {
  const f = fixture();
  const dry = f.run();
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /would change/);
  assert.match(dry.stdout, /merge-headers/);
  assert.equal(readFileSync(join(f.vault, "20 Areas", "Me", "Nick.md"), "utf8"), NICK);
  assert.equal(readFileSync(join(f.ws, "USER.md"), "utf8"), USER);
  const log = readFileSync(join(f.controlled, "consolidate.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(log.length > 0 && log.every((r) => r.dryRun === true && r.action && r.file));

  const wet = f.run("--apply");
  assert.equal(wet.status, 0, wet.stderr);
  assert.match(wet.stdout, /changed/);
  assert.notEqual(readFileSync(join(f.vault, "20 Areas", "Me", "Nick.md"), "utf8"), NICK);
  assert.match(readFileSync(join(f.vault, "20 Areas", "Me", "Nick.md"), "utf8"), /\[said\] First, naps/);
  assert.doesNotMatch(readFileSync(join(f.ws, "memory", "2026-10-01.md"), "utf8"), /Answer the whole thing/);
  const bk = readdirSync(join(f.controlled, "consolidate-backups"));
  assert.equal(bk.length, 1);
  assert.ok(readdirSync(join(f.controlled, "consolidate-backups", bk[0])).length >= 3);
  // Idempotent: the second apply changes nothing.
  assert.match(f.run("--apply").stdout, /nothing to tidy/);
});

test("orion-daily runs the tidy-up nightly with --apply (and not for a named day)", () => {
  const daily = readFileSync(join(dirname(CLI), "orion-daily"), "utf8");
  assert.match(daily, /if \(!argument\) \{[^\n]*"orion-memory-consolidate\.mjs"\), "--apply"\]/);
});

test("CLI: --apply during a live evaluation writes nothing", () => {
  const f = fixture();
  writeFileSync(join(f.controlled, "eval-mode"), "token");
  const out = spawnSync(process.execPath, [CLI, "--workspace", f.ws, "--vault", f.vault, "--controlled", f.controlled, "--now", NOW.toISOString(), "--apply"], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: f.root, ORION_CONTROLLED_DIR: f.controlled } });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /evaluation/);
  assert.equal(readFileSync(join(f.vault, "20 Areas", "Me", "Nick.md"), "utf8"), NICK);
});
