// What a thing in Nick's knowledge is linked to (wave 6, 2026-11-01; gate run-1101003318 kno-connections-c).
//
// "show me everything linked to CS2100" read the CS2100 note back (teacher, rooms, exam rules) instead of its links. The links
// already exist in two places, and this reads both as relations, never as note bodies:
//   - the knowledge graph scripts/orion-knowledge builds (orion-controlled/knowledge-graph.json): edges, with their kind;
//   - the brain vault's own links: a note's "## Relations" bullets ("- has_lab [[CS2101]]"), named people in role observations
//     ("- [instructor] Amil Mohanan — …"), [[wiki links]] in its body, and other notes whose relations point back at it.
// When a thing has few links, notes that mention it by name are added as "mentioned in". Nothing is invented: every row names
// where it came from.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const compact = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const ROLE = /^(?:instructor|teacher|lecturer|professor|tutor|course[_ -]?leader|leader|lab[_ -]?partner|partner|advisor|adviser|supervisor|contact|mentor|coach|manager|ta)$/i;

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

/** Every note: title, type, aliases, relations, role-named people, body links, plain text. */
export function readVault(vaultDir) {
  const notes = [];
  for (const abs of walk(vaultDir)) {
    let text;
    try { text = readFileSync(abs, "utf8"); } catch { continue; }
    const rel = relative(vaultDir, abs);
    const head = text.match(/^---\n([\s\S]*?)\n---\n/);
    const front = head?.[1] ?? "";
    const title = front.match(/^title:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") || rel.replace(/\.md$/, "").split("/").pop();
    const type = front.match(/^type:\s*(.+)$/m)?.[1]?.trim() ?? "";
    const body = text.slice(head ? head[0].length : 0);
    const relations = [];
    const roles = [];
    const mentions = [];
    let section = "";
    for (const line of body.split("\n")) {
      if (/^##\s/.test(line)) { section = line.replace(/^##\s+/, "").trim().toLowerCase(); continue; }
      const rel = section === "relations" ? line.match(/^-\s+([\w -]{1,40}?)\s+\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/) : null;
      if (rel) { relations.push({ kind: rel[1].trim(), target: rel[2].trim() }); continue; }
      const role = line.match(/^-\s+\[([\w -]{1,30})\]\s+([A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+){0,3})/);
      if (role && ROLE.test(role[1].trim())) roles.push({ kind: role[1].trim(), name: role[2].trim() });
      for (const m of line.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) mentions.push(m[1].trim());
    }
    notes.push({ title, type, file: rel, relations, roles, mentions, text: body });
  }
  return notes;
}

const words = (s) => String(s).toLowerCase().replace(/(\w)-(\w)/g, "$1$2").match(/[a-z0-9]+/g) ?? [];
const SKIP_MENTION = /^(?:source register|home|nick)$/i;

/** The note for a subject: same name ignoring case and spacing, else the shortest title that contains it. */
function findNote(notes, subject) {
  const want = compact(subject);
  if (!want) return undefined;
  return notes.find((n) => compact(n.title) === want)
    ?? notes.filter((n) => compact(n.title).includes(want)).sort((a, b) => a.title.length - b.title.length)[0];
}

function findNode(graph, subject) {
  const want = compact(subject);
  if (!graph || !want) return undefined;
  const names = (n) => [n.label, n.subtitle, ...(n.aliases ?? [])].filter(Boolean).map(compact);
  return graph.nodes.find((n) => names(n).includes(want))
    ?? graph.nodes.filter((n) => n.id !== "person:self" && names(n).some((x) => x.includes(want))).sort((a, b) => a.label.length - b.label.length)[0];
}

/** @returns {{ subject, found, title?, type?, facts: string[], links: Array<{label, kind, dir: "out"|"in", type?, via}> }} */
export function linksFor(subject, { notes = [], graph = null, mentionLimit = 5 } = {}) {
  const note = findNote(notes, subject);
  const node = findNode(graph, subject);
  const typeOf = new Map(notes.map((n) => [compact(n.title), n.type]));
  const rows = [];
  const add = (row) => {
    const key = compact(row.label);
    if (!key || (note && key === compact(note.title)) || (node && key === compact(node.label))) return;
    const at = rows.findIndex((r) => compact(r.label) === key);
    if (at >= 0) { if (!rows[at].type && row.type) rows.splice(at, 1, { ...rows[at], type: row.type }); return; }
    rows.push({ ...row, ...(row.type ? {} : typeOf.get(key) ? { type: typeOf.get(key) } : {}) });
  };
  if (note) {
    for (const r of note.relations) add({ label: r.target, kind: r.kind, dir: "out", via: "note" });
    for (const p of note.roles) add({ label: p.name, kind: p.kind, dir: "out", type: "person", via: "note" });
    const want = compact(note.title);
    for (const other of notes) {
      if (other === note) continue;
      const back = other.relations.find((r) => compact(r.target) === want);
      if (back) add({ label: other.title, kind: back.kind, dir: "in", via: "note" });
    }
    for (const m of note.mentions) if (!SKIP_MENTION.test(m.split("/").pop())) add({ label: m, kind: "mentions", dir: "out", via: "note" });
  }
  if (node && graph) {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const e of graph.edges) {
      if (e.from !== node.id && e.to !== node.id) continue;
      const other = byId.get(e.from === node.id ? e.to : e.from);
      if (other) add({ label: other.label, kind: e.kind, dir: e.from === node.id ? "out" : "in", type: other.type, via: "graph" });
    }
  }
  if ((note || node) && rows.length < 4) {
    const terms = words(subject);
    const mentioned = notes.filter((n) => n !== note && terms.length && terms.every((t) => words(`${n.title} ${n.text}`).some((w) => w.startsWith(t))))
      .sort((a, b) => a.title.length - b.title.length).slice(0, mentionLimit);
    for (const n of mentioned) add({ label: n.title, kind: "mentioned in", dir: "in", via: "note" });
  }
  const facts = (node?.facts ?? []).map((f) => f.text).filter(Boolean).slice(0, 2);
  if (!note && !node) {
    const near = nearest(subject, notes, graph);
    if (!near) return { subject, found: false, facts: [], links: [] };
    const out = linksFor(near.title, { notes, graph, mentionLimit });
    return out.found ? { ...out, subject, fallback: { from: subject, via: near.via, why: near.why } } : { subject, found: false, facts: [], links: [] };
  }
  return { subject, found: true, title: note?.title ?? node.label, type: note?.type || node?.type || "", facts, links: rows };
}

// ---- nearest node (gate run-1101020721 kno-connections-v: "the cs midterm" is no node, but CS2100 AE1 is its deadline) ----
const FILLER = new Set(["my", "the", "a", "an", "thing", "things", "stuff", "whats", "what", "related", "to", "of", "for", "about", "with", "on", "in", "and", "that", "this", "like"]);
const DEADLINE_TYPE = /^(?:assessment|deadline|exam|todo|to-do|task|assignment|quiz)$/i;
const DEADLINE_WORDS = /\b(?:deadline|due|exam|midterm|quiz|assessment|assignment|hand-?in)\b/i;
const COURSE_CODE = /^[a-z]{2,5}\s?\d{3,4}$/i;

function isCourse(t, notes, graph) {
  const note = notes.find((n) => compact(n.title) === compact(t));
  return /^(?:course|class)$/i.test(note?.type ?? "")
    || (graph?.nodes ?? []).some((n) => n.type === "course" && compact(n.label) === compact(t)) || COURSE_CODE.test(t.trim());
}
function courseOf(note, notes, graph) {
  return [...note.relations.map((r) => r.target), ...note.mentions].find((t) => isCourse(t, notes, graph));
}

// Wave 4 review finding 6: a term under 4 letters matches whole words only ("ai" never finds "aid"); a course code's letter and digit runs
// are words of their own ("cs" in "cs3001"). Each term scores how much of the word it covers, and the match as a whole must be close.
const SHORT = 4;
const MIN_QUALITY = 0.6;
const parts = (w) => [w, ...(w.match(/[a-z]+|\d+/g) ?? [])];
/** How well a term matches the best word: 1 for the whole word (or a code's letter/digit run), the covered share for a prefix, 0 for none. */
function fit(ws, t) {
  let best = 0;
  for (const w of ws) {
    if (parts(w).includes(t)) return 1;
    if (t.length >= SHORT && w.startsWith(t)) best = Math.max(best, t.length / w.length);
  }
  return best;
}

/** The note nearest a subject that is not itself a node: every word of it in the note, closely, most of them in the title. */
function nearest(subject, notes, graph) {
  const terms = words(subject).filter((t) => !FILLER.has(t));
  if (!terms.length) return undefined;
  const scored = notes.map((n) => {
    const all = words(`${n.title} ${n.text}`);
    const fits = terms.map((t) => fit(all, t));
    if (fits.some((f) => f === 0)) return null;
    if (fits.reduce((a, b) => a + b, 0) / fits.length < MIN_QUALITY) return null;
    const title = words(n.title);
    const inTitle = terms.filter((t) => fit(title, t) > 0).length;
    return { n, inTitle };
  }).filter(Boolean).sort((a, b) => b.inTitle - a.inTitle || a.n.title.length - b.n.title.length);
  const best = scored[0]?.n;
  if (!best) return undefined;
  // A class note that holds every word is the class itself; following its links would land on its lab.
  if (isCourse(best.title, notes, graph)) return { title: best.title, via: best.title, why: "title" };
  const deadline = DEADLINE_TYPE.test(best.type) || DEADLINE_WORDS.test(`${best.title} ${best.text}`);
  const course = deadline ? courseOf(best, notes, graph) : undefined;
  return course && compact(course) !== compact(best.title) ? { title: course, via: best.title, why: "class" } : { title: best.title, via: best.title, why: "title" };
}
