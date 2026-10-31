// Search of the knowledge graph (orion-controlled/knowledge-graph.json, built by scripts/orion-knowledge):
// people, places, courses, routines and how they connect.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tokens } from "./vault-search.mjs";

export function loadGraph(controlledDir) {
  try {
    const g = JSON.parse(readFileSync(join(controlledDir, "knowledge-graph.json"), "utf8"));
    return Array.isArray(g?.nodes) && Array.isArray(g?.edges) ? g : null;
  } catch { return null; }
}

const haystack = (n) => [n.label, n.subtitle, ...(n.aliases ?? []), n.type, ...(n.facts ?? []).map((f) => f.text)].filter(Boolean).join(" ").toLowerCase();

/** @returns [{ title, type, facts: string[], connections: string[], score }] best first */
export function searchGraph(graph, query, { limit = 5 } = {}) {
  const terms = tokens(query);
  if (!graph || !terms.length) return [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const scored = [];
  for (const n of graph.nodes) {
    if (n.id === "person:self") continue;
    const names = [n.label, n.subtitle, ...(n.aliases ?? [])].filter(Boolean).join(" ").toLowerCase();
    const inName = terms.filter((t) => names.includes(t)).length;
    const inAll = terms.filter((t) => haystack(n).includes(t)).length;
    if (!inAll) continue;
    scored.push({ n, score: inName * 20 + inAll * 5 });
  }
  return scored.sort((a, b) => b.score - a.score || (a.n.id < b.n.id ? -1 : 1)).slice(0, limit).map(({ n, score }) => {
    const connections = graph.edges.filter((e) => e.from === n.id || e.to === n.id).slice(0, 6).map((e) => {
      const other = byId.get(e.from === n.id ? e.to : e.from);
      return `${other?.label ?? "?"} (${e.kind})${e.reason ? `: ${e.reason}` : ""}`;
    });
    return { title: n.label, type: n.type, facts: (n.facts ?? []).slice(0, 6).map((f) => f.text), connections, score };
  });
}
