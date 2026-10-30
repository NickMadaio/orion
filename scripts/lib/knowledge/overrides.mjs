// knowledge-overrides.json: Nick's own edits to the knowledge graph (rename, merge, hide, delete, note). They always win:
// every rebuild extracts from the sources and then applies these, so a fact he deleted cannot come back on its own.
//
// The Swift app (KnowledgeOverrides.swift) applies the same rules on load, so an edit shows before the next rebuild.
// Two implementations are tolerable only because tests/fixtures/knowledge/overrides is read by BOTH test suites.
//
// Order, and why: merges first (an edit to the merged-away id would otherwise be lost), then deletes, then node edits,
// then edges are re-pointed, de-duplicated and edited by their post-merge id (the id the view showed him).
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "../awareness/io.mjs";

export const FILE = "knowledge-overrides.json";
export const SCHEMA = "orion.knowledge-overrides.v1";

/** Kinds whose direction means nothing; their id orders the two ends so A–B and B–A are one edge. */
const SYMMETRIC = new Set(["said-together"]);

export function edgeId({ from, to, kind }) {
  const [a, b] = SYMMETRIC.has(kind) && to < from ? [to, from] : [from, to];
  return `${a}>${b}:${kind}`;
}

export function readOverrides(dir) {
  const file = readJson(join(dir, FILE));
  return normalise(file);
}

export function writeOverrides(dir, overrides, now = new Date()) {
  writeJsonAtomic(dir, FILE, { schema: SCHEMA, updatedAt: now.toISOString(), ...normalise(overrides) });
}

function normalise(file) {
  const plain = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  return { nodes: plain(plain(file).nodes), edges: plain(plain(file).edges) };
}

/** Follow mergeInto to its end; a cycle or a missing target means "not merged". */
function resolveMerge(id, nodeEdits, ids) {
  const seen = new Set([id]);
  let current = id;
  for (let hop = 0; hop < 16; hop++) {
    const next = nodeEdits[current]?.mergeInto;
    if (typeof next !== "string" || !ids.has(next)) return current === id ? id : (ids.has(current) ? current : id);
    if (seen.has(next)) return id;
    seen.add(next);
    current = next;
  }
  return id;
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const appendUnique = (list, extra, same) => extra.reduce((acc, item) => (acc.some((x) => same(x, item)) ? acc : [...acc, item]), list);

function mergeNodes(nodes, targetOf) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes.flatMap((node) => {
    if (targetOf.get(node.id) !== node.id) return [];
    const absorbed = nodes.filter((n) => n.id !== node.id && targetOf.get(n.id) === node.id);
    if (!absorbed.length) return [node];
    const aliases = [...new Set([...(node.aliases ?? []), ...absorbed.flatMap((n) => [n.label, ...(n.aliases ?? [])])])]
      .filter((a) => a && a !== node.label).sort();
    return [{
      ...byId.get(node.id),
      aliases,
      facts: appendUnique(node.facts ?? [], absorbed.flatMap((n) => n.facts ?? []), (x, y) => x.text === y.text),
      sources: appendUnique(node.sources ?? [], absorbed.flatMap((n) => n.sources ?? []), sameJson),
    }];
  });
}

function editNode(node, edit) {
  if (!edit) return node;
  return {
    ...node,
    ...(typeof edit.label === "string" && edit.label.trim() ? { label: edit.label.trim() } : {}),
    ...(edit.hidden === true ? { hidden: true } : {}),
    ...(typeof edit.note === "string" && edit.note.trim() ? { note: edit.note.trim() } : {}),
  };
}

function editEdge(edge, edit) {
  if (!edit) return edge;
  return {
    ...edge,
    ...(typeof edit.reason === "string" && edit.reason.trim() ? { reason: edit.reason.trim() } : {}),
    ...(edit.hidden === true ? { hidden: true } : {}),
    ...(typeof edit.note === "string" && edit.note.trim() ? { note: edit.note.trim() } : {}),
  };
}

/** Re-point, drop self-loops, and collapse duplicates — preferring the edge that was already between those two ends. */
function remapEdges(edges, targetOf) {
  const moved = edges.map((e, index) => {
    const from = targetOf.get(e.from) ?? e.from, to = targetOf.get(e.to) ?? e.to;
    const next = { ...e, from, to };
    return { edge: { ...next, id: edgeId(next) }, index, remapped: from !== e.from || to !== e.to };
  }).filter(({ edge }) => edge.from !== edge.to);
  const kept = new Map();
  for (const item of moved) {
    const prior = kept.get(item.edge.id);
    if (!prior || (prior.remapped && !item.remapped)) kept.set(item.edge.id, item);
  }
  return [...kept.values()].sort((a, b) => (a.edge.id < b.edge.id ? -1 : a.edge.id > b.edge.id ? 1 : a.index - b.index)).map((x) => x.edge);
}

/**
 * @returns {{ graph, applied }} a new graph (the input is never mutated) and how many of his edits took effect.
 * Idempotent: applying the same overrides to the result changes nothing.
 */
export function applyOverrides(graph, overrides) {
  const { nodes: nodeEdits, edges: edgeEdits } = normalise(overrides);
  const ids = new Set(graph.nodes.map((n) => n.id));
  let applied = 0;
  const targetOf = new Map(graph.nodes.map((n) => [n.id, resolveMerge(n.id, nodeEdits, ids)]));
  applied += [...targetOf].filter(([id, t]) => id !== t).length;
  const deleted = new Set(graph.nodes.filter((n) => nodeEdits[n.id]?.deleted === true).map((n) => n.id));
  applied += deleted.size;
  const nodes = mergeNodes(graph.nodes, targetOf)
    .filter((n) => !deleted.has(n.id))
    .map((n) => {
      const edit = nodeEdits[n.id];
      if (edit && (edit.label || edit.hidden || edit.note)) applied += 1;
      return editNode(n, edit);
    });
  const live = new Set(nodes.map((n) => n.id));
  const edges = remapEdges(graph.edges, targetOf)
    .filter((e) => live.has(e.from) && live.has(e.to))
    .filter((e) => { const gone = edgeEdits[e.id]?.deleted === true; if (gone) applied += 1; return !gone; })
    .map((e) => { const edit = edgeEdits[e.id]; if (edit && (edit.reason || edit.hidden || edit.note)) applied += 1; return editEdge(e, edit); });
  return { graph: { ...graph, nodes, edges }, applied };
}
