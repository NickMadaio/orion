// The graph as fragments: each extractor returns { nodes, edges } and `assemble` folds them into one graph.
// Folding is by id, so two sources that both know about the gym produce one node with both citations.
import { edgeId } from "./overrides.mjs";

export const SCHEMA = "orion.knowledge-graph.v1";
export const TYPES = ["person", "place", "course", "project", "routine", "habit", "app", "health", "preference", "goal"];
export const SELF = "person:self";

export const slug = (text) => String(text).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "x";
export const nodeId = (type, name) => `${type}:${slug(name)}`;

/** A citation: file (relative to ~/.openclaw), optional 1-based line and date. Never an absolute path. */
export const cite = (file, { line, date } = {}) => ({ file, ...(line ? { line } : {}), ...(date ? { date } : {}) });

export const fact = (text, source) => ({ text, source });

export function makeNode(type, name, { label = name, subtitle, aliases, facts = [], source } = {}) {
  return {
    id: nodeId(type, name), type, label,
    ...(subtitle ? { subtitle } : {}),
    ...(aliases?.length ? { aliases } : {}),
    facts, sources: source ? [source] : [],
  };
}

export function makeEdge(from, to, kind, reason, source) {
  const edge = { from, to, kind, reason, source };
  return { id: edgeId(edge), ...edge };
}

export const fragment = (nodes = [], edges = []) => ({ nodes, edges });

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const union = (a = [], b = [], same = sameJson) => b.reduce((acc, x) => (acc.some((y) => same(y, x)) ? acc : [...acc, x]), a);

function foldNode(prior, next) {
  if (!prior) return next;
  const aliases = [...new Set([...(prior.aliases ?? []), ...(next.aliases ?? [])])].filter((a) => a !== prior.label).sort();
  return {
    ...prior,
    // A later source may know the proper name (the calendar's "Introduction to Marketing").
    ...(prior.subtitle || !next.subtitle ? {} : { subtitle: next.subtitle }),
    ...(aliases.length ? { aliases } : {}),
    facts: union(prior.facts, next.facts, (x, y) => x.text === y.text),
    sources: union(prior.sources, next.sources),
  };
}

const typeRank = (t) => TYPES.indexOf(t);
const byNode = (a, b) => typeRank(a.type) - typeRank(b.type) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Fold fragments into nodes and edges, sorted so the same inputs give the same bytes. Edges to unknown nodes are dropped. */
export function assemble(fragments) {
  const nodes = new Map();
  for (const n of fragments.flatMap((f) => f.nodes)) nodes.set(n.id, foldNode(nodes.get(n.id), n));
  const edges = new Map();
  for (const e of fragments.flatMap((f) => f.edges)) {
    if (!nodes.has(e.from) || !nodes.has(e.to) || e.from === e.to || edges.has(e.id)) continue;
    edges.set(e.id, e);
  }
  return {
    nodes: [...nodes.values()].sort(byNode),
    edges: [...edges.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}
