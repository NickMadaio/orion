// Override precedence for the knowledge graph. The fixture trio in fixtures/knowledge/overrides is shared with the
// Swift app's KnowledgeOverridesTests, so the two implementations of applyOverrides cannot drift apart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyOverrides, edgeId } from "../scripts/lib/knowledge/overrides.mjs";

const dir = join(import.meta.dirname, "fixtures/knowledge/overrides");
const load = (name) => JSON.parse(readFileSync(join(dir, name), "utf8"));

test("the shared fixture: graph + overrides gives exactly the expected graph", () => {
  const { graph } = applyOverrides(load("graph.json"), load("overrides.json"));
  assert.deepEqual(graph, load("expected.json"));
});

test("applying twice changes nothing (the app re-applies on load)", () => {
  const once = applyOverrides(load("graph.json"), load("overrides.json")).graph;
  assert.deepEqual(applyOverrides(once, load("overrides.json")).graph, once);
});

test("the input graph is not mutated", () => {
  const input = load("graph.json");
  const before = JSON.stringify(input);
  applyOverrides(input, load("overrides.json"));
  assert.equal(JSON.stringify(input), before);
});

test("merge chains resolve, cycles and missing targets are ignored", () => {
  const graph = { nodes: [{ id: "a:1", type: "a", label: "1" }, { id: "a:2", type: "a", label: "2" }, { id: "a:3", type: "a", label: "3" }], edges: [] };
  const chained = applyOverrides(graph, { nodes: { "a:1": { mergeInto: "a:2" }, "a:2": { mergeInto: "a:3" } } }).graph;
  assert.deepEqual(chained.nodes.map((n) => n.id), ["a:3"]);
  const cycle = applyOverrides(graph, { nodes: { "a:1": { mergeInto: "a:2" }, "a:2": { mergeInto: "a:1" } } }).graph;
  assert.equal(cycle.nodes.length, 3);
  const missing = applyOverrides(graph, { nodes: { "a:1": { mergeInto: "a:9" } } }).graph;
  assert.equal(missing.nodes.length, 3);
});

test("edge ids are stable and symmetric kinds are unordered", () => {
  assert.equal(edgeId({ from: "b:x", to: "a:y", kind: "said-together" }), "a:y>b:x:said-together");
  assert.equal(edgeId({ from: "b:x", to: "a:y", kind: "takes" }), "b:x>a:y:takes");
});

test("a malformed overrides file is no overrides", () => {
  const graph = load("graph.json");
  assert.deepEqual(applyOverrides(graph, null).graph, graph);
  assert.deepEqual(applyOverrides(graph, { nodes: "nope", edges: 3 }).graph, graph);
});
