// Fast, local search over the Obsidian vault's markdown (no Python start-up, no index to go stale).
// Basic Memory's own search costs ~2 s before it looks at a single note; this answers in milliseconds.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const STOP = new Set(["the", "a", "an", "of", "and", "or", "to", "is", "in", "on", "my", "what", "who", "do", "did", "i", "me", "about", "for", "with", "his", "her", "was", "are"]);
export const tokens = (q) => [...new Set(String(q).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].filter((t) => t.length > 1 && !STOP.has(t));

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".md")) yield p;
  }
}

const titleOf = (body, file) => body.match(/^title:\s*(.+)$/m)?.[1]?.trim() || file.replace(/\.md$/, "").split("/").pop();

/** @returns [{ title, file_path, excerpt, score }] best first */
export function searchVault(vaultDir, query, { limit = 6, readFile = (p) => readFileSync(p, "utf8"), files = () => walk(vaultDir) } = {}) {
  const terms = tokens(query);
  if (!terms.length) return [];
  const hits = [];
  for (const abs of files()) {
    let text;
    try { text = readFile(abs); } catch { continue; }
    const rel = relative(vaultDir, abs);
    const lower = text.toLowerCase();
    const title = titleOf(text, rel);
    const inTitle = terms.filter((t) => `${title} ${rel}`.toLowerCase().includes(t)).length;
    const inBody = terms.filter((t) => lower.includes(t));
    if (!inTitle && !inBody.length) continue;
    const count = inBody.reduce((n, t) => n + lower.split(t).length - 1, 0);
    const body = text.replace(/^---[\s\S]*?\n---\n/, "").split("\n").filter((l) => l.trim());
    const matching = body.filter((l) => terms.some((t) => l.toLowerCase().includes(t)));
    const lines = inTitle ? [...new Set([...body.slice(0, 8), ...matching])] : matching;
    hits.push({ title, file_path: rel, excerpt: lines.join("\n").slice(0, 700), score: inTitle * 20 + inBody.length * 5 + Math.min(count, 10) });
  }
  return hits.sort((a, b) => b.score - a.score || (a.title < b.title ? -1 : 1)).slice(0, limit);
}
