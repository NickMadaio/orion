// Which app a spoken name means, by edit distance as well as by prefix: "vorsaint" is Vorssaint, "spotfy" is Spotify. Pure over a candidate list
// ([{ name, bundleId }]: the installed apps plus the running ones). Short or unrelated names resolve to nothing, never to a guess.
import { norm } from "./policy.mjs";

/** Edit distance between two strings: insert, delete, substitute, and swapping two neighbours each cost one ("discrod" is one off "discord"). */
export function editDistance(a, b) {
  let older = [], prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], older[j - 2] + 1);
    }
    older = prev; prev = row;
  }
  return prev[b.length];
}

/** How many edits a name of this length may be off by: none under 5 letters, one up to 8, two beyond. */
export const typoBudget = (len) => (len < 5 ? 0 : len < 9 ? 1 : 2);

/** True when two app names are the same word up to a typo. */
export const sameUpToTypo = (a, b) => {
  const x = norm(a), y = norm(b);
  return !!x && !!y && Math.min(x.length, y.length) >= 5 && editDistance(x, y) <= typoBudget(Math.min(x.length, y.length));
};

/** The candidate a spoken name means: exact, then the start of a name or word, then the nearest within the typo budget. null when none. */
export function resolveAppName(query, candidates) {
  const q = norm(query);
  if (q.length < 2) return null;
  const rows = candidates.filter((c) => c?.name).map((c) => ({ c, n: norm(c.name), id: norm(c.bundleId) }));
  const exact = rows.find((r) => r.n === q || (r.id && r.id === q));
  if (exact) return exact.c;
  if (q.length >= 4) {
    const startsWord = (name) => { const w = String(name).split(/[^A-Za-z0-9]+/).filter(Boolean).map((x) => x.toLowerCase()); return w.some((_, i) => w.slice(i).join("").startsWith(q)); };
    const starts = rows.filter((r) => startsWord(r.c.name)).sort((a, b) => a.n.length - b.n.length);
    if (starts.length) return starts[0].c;
  }
  const near = rows.map((r) => ({ r, d: editDistance(q, r.n) })).filter(({ r, d }) => d <= typoBudget(Math.min(q.length, r.n.length)))
    .sort((a, b) => a.d - b.d || a.r.n.length - b.r.n.length);
  return near.length ? near[0].r.c : null;
}
