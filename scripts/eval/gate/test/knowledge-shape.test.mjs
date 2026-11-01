// The kno-forget fixture must be in the shape a real saved entry has, or forget can never see it (gate run-1101020721).
// Real saved entries are `orion-brain learn` lines: "- [fact] <text> (<date>)" under a "## Learned" heading in a vault note
// ("Saved: X." is only what ORION says back after the learn). A fixture without that heading tests nothing real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fixturesFor } from "../tools/gen-setup.mjs";
import { knowledgeNote } from "../lib/fixtures.mjs";
import { findEntries } from "../../../lib/brain/forget.mjs";

test("the kno-forget fixture is in the real learned-entry shape, so forget finds what the scenario names", () => {
  const vault = mkdtempSync(join(tmpdir(), "gate-shape-"));
  for (const n of fixturesFor({ id: "kno-forget-v" }).knowledge) {
    const f = knowledgeNote({ brainVault: vault }, n);
    mkdirSync(dirname(f.path), { recursive: true });
    writeFileSync(f.path, f.content);
  }
  const dirs = { vaultDir: vault, workspaceDir: join(vault, "no-workspace") };
  assert.equal(findEntries(dirs, "frozen").length, 1);
  assert.equal(findEntries(dirs, "introducing carol to something").length, 1);
  for (const n of fixturesFor({ id: "kno-forget-v" }).knowledge) {
    for (const line of n.body.split("\n").filter((l) => /^-\s/.test(l))) assert.match(line, /^- \[[a-z -]+\] .+ \(\d{4}-\d{2}-\d{2}\)$/);
  }
});
