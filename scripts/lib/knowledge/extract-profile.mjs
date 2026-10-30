// USER.md and MEMORY.md: who he is, what he prefers, what he is building, his courses, the people he names.
// Pattern rules only. A line that does not match a rule contributes nothing — no guessing at meaning.
import { SELF, cite, fact, fragment, makeEdge, makeNode, nodeId } from "./graph.mjs";
import { LABEL } from "./sources.mjs";
import { COURSE_CODE, appMentions, personNames } from "./lexicon.mjs";

const clean = (s) => s.replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim();
const clip = (s, n = 220) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const bulletBody = (line) => line.replace(/^\s*-\s+/, "").replace(/^\d{4}-\d{2}-\d{2}\s+—\s+/, "");

/** The bullet starting at `index` with its wrapped continuation lines. */
function paragraphAt(lines, index) {
  const out = [lines[index]];
  for (let i = index + 1; i < lines.length && lines[i].trim() && !/^\s*(-|#)/.test(lines[i]); i++) out.push(lines[i]);
  return clean(out.join(" "));
}

export function selfNode(lines) {
  const at = (lines ?? []).findIndex((l) => /^- Name:\s*\S/.test(l));
  const name = at >= 0 ? lines[at].replace(/^- Name:\s*/, "").trim() : null;
  const heading = (lines ?? []).find((l) => /^# \S/.test(l))?.slice(2).trim();
  const label = name?.split(/\s+/)[0] ?? heading ?? "You";
  return {
    ...makeNode("person", "self", { label, ...(name ? { subtitle: name } : {}),
      facts: name ? [fact(`Name: ${name}`, cite(LABEL.user, { line: at + 1 }))] : [],
      source: at >= 0 ? cite(LABEL.user, { line: at + 1 }) : undefined }),
    id: SELF,
  };
}

function courses(lines) {
  return lines.flatMap((line, i) => [...line.matchAll(COURSE_CODE)].map((m) => {
    const code = `${m[1]}${m[2]}`.toUpperCase();
    const after = line.slice(m.index + m[0].length).match(/^\s+([A-Z][a-z]{3,})\b/)?.[1];
    const source = cite(LABEL.user, { line: i + 1 });
    const node = makeNode("course", code, { aliases: after ? [after] : undefined, source });
    const why = /class/i.test(line) ? `${code} is one of his weekly classes` : `${code} is named in USER.md`;
    return fragment([node], [makeEdge(SELF, node.id, "takes", why, source)]);
  }));
}

function projects(lines) {
  return lines.flatMap((line, i) => {
    const m = line.match(/\bBuilding\s+([A-Z][\w-]+)/);
    if (!m) return [];
    const source = cite(LABEL.user, { line: i + 1 });
    const node = makeNode("project", m[1], { facts: [fact(clip(clean(bulletBody(line))), source)], source });
    return [fragment([node], [makeEdge(SELF, node.id, "builds", clip(clean(bulletBody(line)), 120), source)])];
  });
}

const PREFERENCE_LEAD = /^(Wants|Prefers|Likes|Hates|Dislikes|Never|Always|Cost matters)\b/;
const PREFERENCE_WORDS = /\b(never|always|prefers?|wants?|don't|do not|only|must)\b/i;

/** "School: Northeastern University London, …" — where he studies. */
function schools(lines) {
  return lines.flatMap((line, i) => {
    // Without the campus city, so "Northeastern University London" and "Northeastern University" are one place.
    const m = line.match(/\b((?:[A-Z][a-z]+ )+University)\b/);
    if (!m) return [];
    const source = cite(LABEL.user, { line: i + 1 });
    const node = makeNode("place", m[1], { facts: [fact(clip(clean(line)), source)], source });
    return [fragment([node], [makeEdge(SELF, node.id, "studies-at", clip(clean(line), 120), source)])];
  });
}

function preferenceLabel(body) {
  const bold = body.match(/\*\*([^*]+)\*\*/)?.[1];
  const raw = bold ?? body;
  return clean(raw).split(/[:;.]/)[0].split(/,| and /)[0].trim().slice(0, 48);
}

function preferences(lines) {
  return lines.flatMap((line, i) => {
    if (!/^\s*-\s+/.test(line)) return [];
    const body = bulletBody(line);
    // A bold lead is a preference only when it reads like one ("never", "always", "wants"); USER.md also bolds facts.
    const boldPreference = /\*\*[^*]+\*\*/.test(body) && PREFERENCE_WORDS.test(body);
    if (!boldPreference && !PREFERENCE_LEAD.test(body)) return [];
    if (/^\s*-\s+Name:/.test(line)) return [];
    const label = preferenceLabel(body);
    if (!label) return [];
    const source = cite(LABEL.user, { line: i + 1 });
    const node = makeNode("preference", label, { facts: [fact(clip(clean(bulletBody(paragraphAt(lines, i)))), source)], source });
    return [fragment([node], [makeEdge(SELF, node.id, "prefers", label, source)])];
  });
}

/** "Planning priorities, highest first: classes → sleep → gym …" — a preference, and an edge to each thing it ranks. */
function priorities(lines, courseIds) {
  return lines.flatMap((line, i) => {
    if (!/^Planning priorities/i.test(line)) return [];
    const text = paragraphAt(lines, i);
    const source = cite(LABEL.user, { line: i + 1 });
    const node = makeNode("preference", "Planning priorities", { facts: [fact(clip(text), source)], source });
    const order = text.split(/→|->/).map((s) => s.trim().toLowerCase());
    const rankOf = (word) => order.findIndex((part) => part.includes(word)) + 1;
    const targets = [
      ...(rankOf("class") ? courseIds.map((id) => [id, `Classes rank #${rankOf("class")}: fixed, never moved`]) : []),
      ...(rankOf("sleep") ? [[nodeId("health", "sleep"), `Sleep ranks #${rankOf("sleep")}`], [nodeId("routine", "sleep"), `Sleep ranks #${rankOf("sleep")}`]] : []),
      ...(rankOf("gym") ? [[nodeId("habit", "gym"), `Gym ranks #${rankOf("gym")}`]] : []),
    ];
    return [fragment([node], [makeEdge(SELF, node.id, "prefers", "How he wants a day planned", source),
      ...targets.map(([id, why]) => makeEdge(node.id, id, "ranks", why, source))])];
  });
}

/** "## What … needs from you" — the paragraph under it, as his goal for ORION. */
function goals(lines) {
  const at = lines.findIndex((l) => /^##\s+What .* needs from you/i.test(l));
  if (at < 0) return [];
  const first = lines.findIndex((l, i) => i > at && l.trim());
  if (first < 0) return [];
  const sentence = clean(lines[first]).split(/[:.]/)[0];
  const label = sentence.replace(/^Be (his|her|their|my)\s+/i, "").replace(/^\w/, (c) => c.toUpperCase());
  const source = cite(LABEL.user, { line: first + 1 });
  const node = makeNode("goal", label, { facts: [fact(clip(paragraphAt(lines, first)), source)], source });
  return [fragment([node], [makeEdge(SELF, node.id, "wants", "What he needs ORION to be", source)])];
}

function people(lines, label, known) {
  return lines.flatMap((line, i) => personNames(line, known).map((name) => {
    const source = cite(label, { line: i + 1 });
    const node = makeNode("person", name, { facts: [fact(clip(clean(bulletBody(line))), source)], source });
    return fragment([node], [makeEdge(SELF, node.id, "knows", `Named in ${label.split("/").pop()}`, source)]);
  }));
}

function apps(lines, label) {
  return lines.flatMap((line, i) => appMentions(line).map((app) => {
    const source = cite(label, { line: i + 1 });
    return fragment([makeNode("app", app, { source })], [makeEdge(SELF, nodeId("app", app), "uses", `Named in ${label.split("/").pop()}`, source)]);
  }));
}

/** MEMORY.md is about ORION, not Nick: it contributes app mentions and a lesson count on any project it names. */
function memoryFacts(lines, projectLabels) {
  const lessons = lines.filter((l) => /^- \d{4}-\d{2}-\d{2}/.test(l)).length;
  const named = projectLabels.filter((p) => lines.some((l) => new RegExp(`\\b${p}\\b`, "i").test(l)));
  const source = cite(LABEL.memory);
  return named.map((p) => fragment([makeNode("project", p, { facts: [fact(`${lessons} dated lessons in MEMORY.md`, source)], source })]));
}

export function extractProfile(src) {
  const user = src.user ?? [];
  const memory = src.memory ?? [];
  const self = fragment([selfNode(src.user)]);
  const courseFragments = courses(user);
  const courseIds = [...new Set(courseFragments.flatMap((f) => f.nodes.map((n) => n.id)))];
  const projectFragments = projects(user);
  const projectLabels = projectFragments.flatMap((f) => f.nodes.map((n) => n.label));
  const known = new Set([...courseIds, ...projectLabels.map((p) => p.toLowerCase())]);
  return [self, ...courseFragments, ...projectFragments, ...preferences(user), ...priorities(user, courseIds),
    ...goals(user), ...schools(user), ...people(user, LABEL.user, known), ...apps(user, LABEL.user), ...apps(memory, LABEL.memory),
    ...memoryFacts(memory, projectLabels)];
}
