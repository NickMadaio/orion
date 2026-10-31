// orion-brain search: knowledge graph + vault text, instantly; Basic Memory's ranked search only when those find little,
// and its failure or timeout never fails the lookup (lookups must come back in under 3 s).
import { searchGraph } from "./graph-search.mjs";
import { searchVault } from "./vault-search.mjs";

const render = {
  graph: (r) => `## ${r.title}  (${r.type}, knowledge graph)\n${r.facts.map((f) => `- ${f}`).join("\n")}${r.connections.length ? `\nConnected: ${r.connections.join("; ")}` : ""}\n`,
  note: (r) => `## ${r.title}  (${r.file_path})\n${String(r.excerpt ?? "").slice(0, 700)}\n`,
};

/**
 * @param deps { graph, vaultDir, ranked: async (query) => [{title,file_path,excerpt}] (may throw), vaultFn }
 * @returns string
 */
export async function brainSearch(query, { graph = null, vaultDir, ranked = null, vaultFn = searchVault, enough = 3 } = {}) {
  const fromGraph = searchGraph(graph, query);
  const fromVault = vaultFn(vaultDir, query);
  let more = [];
  if (ranked && fromGraph.length + fromVault.length < enough) {
    try { more = (await ranked(query)).filter((r) => !fromVault.some((v) => v.file_path === r.file_path)); } catch { more = []; }
  }
  const parts = [...fromGraph.map(render.graph), ...[...fromVault, ...more].slice(0, 6).map(render.note)];
  return parts.length ? parts.join("\n") : `Nothing in the brain matches "${query}".`;
}
