import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { bmArgs } from "../scripts/lib/brain/bm.mjs";
import { searchVault } from "../scripts/lib/brain/vault-search.mjs";
import { searchGraph, loadGraph } from "../scripts/lib/brain/graph-search.mjs";
import { brainSearch } from "../scripts/lib/brain/search.mjs";

const graph = {
  nodes: [
    { id: "person:self", type: "person", label: "Nick", facts: [] },
    { id: "person:maya", type: "person", label: "Maya", subtitle: "Maya Chen", facts: [{ text: "Teammate on the marketing project" }] },
    { id: "place:fenwick-gym", type: "place", label: "Fenwick Gym", facts: [{ text: "Where he lifts" }] },
    { id: "habit:gym", type: "habit", label: "gym", facts: [{ text: "90 minutes a day" }] },
  ],
  edges: [
    { id: "e1", from: "habit:gym", to: "place:fenwick-gym", kind: "happens-at", reason: "Logged there 12 times" },
    { id: "e2", from: "person:maya", to: "habit:gym", kind: "said-together", reason: "Said together: gym with Maya" },
  ],
};

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "brain-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const vault = join(root, "vault");
  mkdirSync(join(vault, "20 Areas"), { recursive: true });
  writeFileSync(join(vault, "20 Areas/Gym.md"), "---\ntitle: Gym\ntype: habit\n---\n\n# Gym\n- [priority] High: protected\n");
  writeFileSync(join(vault, "20 Areas/Thesis.md"), "---\ntitle: Thesis\n---\n- [topic] energy use of local models\n");
  writeFileSync(join(root, "knowledge-graph.json"), JSON.stringify(graph));
  return { root, vault };
}

test("the CLI argument shapes use the current basic-memory command names", () => {
  assert.deepEqual(bmArgs.search("gym").slice(0, 3), ["tool", "search", "gym"]);
  assert.equal(bmArgs.read("Gym")[1], "read");
  assert.equal(bmArgs.context("Gym")[1], "context");
  assert.deepEqual(bmArgs.recent().slice(0, 3), ["tool", "project", "recent"]);
  for (const args of Object.values(bmArgs).map((f) => f === bmArgs.write ? f({ title: "t", directory: "d", noteType: "note", content: "c" }) : f === bmArgs.append ? f("t", "c") : f("x"))) {
    assert.ok(!args.some((a) => /-note$|build-context|recent-activity/.test(a)), `old command in ${args}`);
  }
});

test("vault search ranks title matches first and shows matching lines", (t) => {
  const { vault } = fixture(t);
  const r = searchVault(vault, "gym");
  assert.equal(r[0].title, "Gym");
  assert.match(r[0].excerpt, /protected/);
  assert.equal(searchVault(vault, "thesis topic")[0].title, "Thesis");
  assert.deepEqual(searchVault(vault, "zebra"), []);
});

test("graph search finds people, places and connections", () => {
  const people = searchGraph(graph, "who is maya");
  assert.equal(people[0].title, "Maya");
  assert.match(people[0].connections.join(), /gym/);
  const places = searchGraph(graph, "fenwick");
  assert.equal(places[0].title, "Fenwick Gym");
  assert.match(places[0].connections.join(), /Logged there 12 times/);
  assert.deepEqual(searchGraph(null, "gym"), []);
});

test("a failing or slow ranked search never fails the lookup", async (t) => {
  const { vault } = fixture(t);
  const out = await brainSearch("quokka", { graph, vaultDir: vault, ranked: async () => { throw new Error("No such command"); } });
  assert.match(out, /Nothing in the brain matches/);
  const hit = await brainSearch("gym", { graph, vaultDir: vault, ranked: async () => { throw new Error("boom"); } });
  assert.match(hit, /Gym/);
  assert.match(hit, /Fenwick Gym/);
});

test("orion-brain search CLI answers from fixtures in well under 3 s", (t) => {
  const { root, vault } = fixture(t);
  const started = Date.now();
  const out = execFileSync(process.execPath, [new URL("../scripts/orion-brain", import.meta.url).pathname, "search", "maya"], {
    encoding: "utf8", timeout: 3000, env: { ...process.env, ORION_CONTROLLED_DIR: root, ORION_BRAIN_VAULT: vault, HOME: root },
  });
  assert.ok(Date.now() - started < 3000);
  assert.match(out, /Maya Chen|Maya/);
  assert.match(out, /knowledge graph/);
  assert.equal(loadGraph(root).nodes.length, 4);
});
