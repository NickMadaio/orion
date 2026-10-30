// memory/*.md, the daily notes: what he said on which day. Two things come out of them, both by plain matching
// against the nodes the other sources already found — a mention count on each node, and a "said together" edge
// between two things named in the same line (the line and date are the citation).
import { cite, fact, fragment, makeEdge, makeNode, nodeId, SELF } from "./graph.mjs";
import { LABEL } from "./sources.mjs";
import { personNames, significantWords } from "./lexicon.mjs";
import { plural } from "./format.mjs";

/**
 * Only lines that are his words. Two shapes qualify, and nothing else does — the notes also carry action-ledger
 * blocks ("- Run weather_now", "<!-- … -->") that are ORION's, not his:
 *   "- 08:56 PM — [auto] actually do resume before gym"                (Mac; minus injected "[ORION context: …")
 *   "- 23:41 — [iphone] Offline on the phone — Nick: … / ORION (phone): …"   (only the part before ORION answers)
 */
export const spoken = (line) => {
  const mac = line.match(/^\s*-\s+\d{1,2}:\d{2}(?:\s*[AP]M)?\s+—\s+\[auto\]\s+(.+)$/i);
  if (mac) return mac[1].trim().startsWith("[") ? null : mac[1].trim();
  const phone = line.match(/^\s*-\s+\d{1,2}:\d{2}(?:\s*[AP]M)?\s+—\s+\[iphone\].*?—\s+[A-Z][a-z]+:\s+(.+?)(?:\s+\/\s+ORION\b.*)?$/);
  return phone ? phone[1].trim() : null;
};

/** A line naming more than this many things is a list, not a relationship: it counts as mentions only. */
const MAX_NAMED_FOR_PAIRS = 4;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every way a line can name a node. Courses by code and alias, goals by their unusual words, the rest by name. */
function matchersFor(nodes) {
  return nodes.filter((n) => n.id !== SELF && n.type !== "preference" && n.type !== "health").map((n) => {
    const names = new Set([n.label, ...(n.aliases ?? [])].map((s) => s.toLowerCase()).filter((s) => s.length >= 3));
    if (n.type === "goal") for (const w of significantWords(n.label, 5)) names.add(w);
    if (n.type === "project") for (const w of significantWords(n.label, 6)) names.add(w);
    const pattern = [...names].map(escape).sort((a, b) => b.length - a.length).join("|");
    return { id: n.id, re: pattern ? new RegExp(`(^|[^a-z0-9])(${pattern})(?=$|[^a-z0-9])`, "i") : null };
  }).filter((m) => m.re);
}

const MAX_TOGETHER = 160;
const quote = (s) => (s.length > 90 ? `${s.slice(0, 89).trimEnd()}…` : s);

export function peopleInNotes(daily, knownLabels) {
  return daily.flatMap(({ name, date, lines }) => lines.flatMap((line, i) => {
    const body = spoken(line);
    if (!body) return [];
    return personNames(body, knownLabels).map((person) => {
      const source = cite(LABEL.daily(name), { line: i + 1, date });
      return fragment([makeNode("person", person, { source })], [makeEdge(SELF, nodeId("person", person), "knows", `Named in his notes on ${date}`, source)]);
    });
  }));
}

export function notesAgainst(daily, nodes) {
  const matchers = matchersFor(nodes);
  const mentions = new Map();
  const together = new Map();
  for (const { name, date, lines } of daily) {
    lines.forEach((line, i) => {
      const body = spoken(line);
      if (!body) return;
      const hits = [...new Set(matchers.filter((m) => m.re.test(body)).map((m) => m.id))].sort();
      const source = cite(LABEL.daily(name), { line: i + 1, date });
      for (const id of hits) {
        const prior = mentions.get(id);
        mentions.set(id, { days: new Set([...(prior?.days ?? []), date]), latest: prior?.latest ?? source });
      }
      const pairable = hits.length <= MAX_NAMED_FOR_PAIRS ? hits : [];
      for (let a = 0; a < pairable.length; a++) for (let b = a + 1; b < pairable.length; b++) {
        const key = `${pairable[a]}|${pairable[b]}`;
        const prior = together.get(key);
        together.set(key, { count: (prior?.count ?? 0) + 1, first: prior?.first ?? { source, body } });
      }
    });
  }
  const mentionFacts = [...mentions].map(([id, m]) => {
    const node = nodes.find((n) => n.id === id);
    return fragment([{ ...makeNode(node.type, "x", { source: m.latest }), id, label: node.label,
      facts: [fact(`Mentioned on ${plural(m.days.size, "day")} in his notes; latest ${m.latest.date}`, m.latest)] }]);
  });
  const edges = [...together].sort((x, y) => y[1].count - x[1].count || (x[0] < y[0] ? -1 : 1)).slice(0, MAX_TOGETHER)
    .map(([key, v]) => {
      const [a, b] = key.split("|");
      const times = v.count > 1 ? ` (${v.count} times; latest ${v.first.source.date})` : "";
      return makeEdge(a, b, "said-together", `Said together: “${quote(v.first.body)}”${times}`, v.first.source);
    });
  return [...mentionFacts, fragment([], edges)];
}
