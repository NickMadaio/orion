// The orion-controlled files: places, routines, patterns, anchors, projects and the calendar.
import { SELF, cite, fact, fragment, makeEdge, makeNode, nodeId } from "./graph.mjs";
import { LABEL } from "./sources.mjs";
import { COURSE_CODE, significantWords } from "./lexicon.mjs";
import { clockOfMinutes, dayAndTime, plural } from "./format.mjs";

const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** places.json: name → commute minutes. "spit", "chapter spitalfields" and "spitalfields" are one place. */
export function placesFromCommutes(places) {
  if (!places || typeof places !== "object") return [];
  const keys = Object.keys(places).filter((k) => Number.isFinite(places[k])).sort();
  const words = (k) => k.toLowerCase().split(/\s+/);
  const related = (a, b) => places[a] === places[b]
    && words(a).some((x) => words(b).some((y) => x.length >= 3 && y.length >= 3 && (x.startsWith(y) || y.startsWith(x))));
  const groups = [];
  for (const key of keys) {
    const group = groups.find((g) => g.some((k) => related(k, key)));
    if (group) group.push(key); else groups.push([key]);
  }
  const source = cite(LABEL.controlled("places.json"));
  return groups.map((group) => {
    const singles = group.filter((k) => !/\s/.test(k)).sort((a, b) => b.length - a.length);
    const canonical = singles[0] ?? [...group].sort((a, b) => a.length - b.length)[0];
    const minutes = places[canonical];
    const node = makeNode("place", canonical, { label: titleCase(canonical),
      aliases: group.filter((k) => k !== canonical).sort(), facts: [fact(`${minutes} min commute`, source)], source });
    return fragment([node], [makeEdge(SELF, node.id, "commutes-to", `${minutes} min commute, used when planning his day`, source)]);
  });
}

export function placesKnown(file) {
  const list = Array.isArray(file?.places) ? file.places : [];
  const source = cite(LABEL.controlled("known-places.json"));
  return list.filter((p) => p?.name || p?.id).map((p) => {
    const name = String(p.name ?? p.id);
    const node = makeNode("place", name, { label: titleCase(name), facts: [fact(`A known place (${p.kind ?? "place"})`, source)], source });
    const kind = p.kind === "home" ? "lives-at" : "goes-to";
    return fragment([node], [makeEdge(SELF, node.id, kind, p.kind === "home" ? "Home" : `A ${p.kind ?? "known"} place`, source)]);
  });
}

export function homeCity(location) {
  if (!location?.place) return [];
  const source = cite(LABEL.controlled("location.json"));
  const node = makeNode("place", location.place, { facts: [fact(`Home zone ${location.home ?? "unknown"}`, source)], source });
  return [fragment([node], [makeEdge(SELF, node.id, "lives-in", `Home is ${location.place} (${location.home ?? "zone unknown"})`, source)])];
}

export function routines(file) {
  const list = Array.isArray(file?.routines) ? file.routines : [];
  const source = cite(LABEL.controlled("learned-routines.json"), { date: file?.at?.slice(0, 10) });
  return list.filter((r) => r?.id).map((r) => {
    const label = r.kind === "away-evening" ? `${r.weekdayName ?? "Some"} evenings out` : titleCase(String(r.kind ?? r.id).replace(/-/g, " "));
    const facts = [
      fact(`${clockOfMinutes(r.start)}–${clockOfMinutes(r.end)}, ${r.status ?? "learned"} (${Math.round((r.confidence ?? 0) * 100)}% confident)`, source),
      fact(`Seen ${plural(r.occurrences ?? 0, "time")}, missed ${r.misses ?? 0}; last ${r.lastHit ?? "unknown"}`, source),
    ];
    const node = makeNode("routine", r.id, { label, facts, source });
    const edges = [makeEdge(SELF, node.id, "keeps", "Learned from where his phone was on past evenings", source)];
    const nodes = [node];
    if (r.label) {
      const place = makeNode("place", r.label, { facts: [fact(`Named by ${r.labelSource ?? "him"}`, source)], source });
      nodes.push(place);
      edges.push(makeEdge(node.id, place.id, "happens-at", `${label} are at ${r.label} (${r.labelSource ?? "learned"})`, source));
    }
    return fragment(nodes, edges);
  });
}

export function anchors(config) {
  const list = Array.isArray(config?.anchors) ? config.anchors : [];
  const source = cite(LABEL.controlled("life-config.json"));
  return list.filter((a) => a?.title).map((a) => {
    const days = Array.isArray(a.days) && a.days.length === 7 ? "every day" : `${a.days?.length ?? 0} days a week`;
    const node = makeNode("habit", a.title, { facts: [fact(`A ${a.rank ?? "planned"} anchor, ${a.minutes ?? "?"} min, ${days}`, source)], source });
    return fragment([node], [makeEdge(SELF, node.id, "keeps", `Daily anchor in his plan (${a.rank ?? "planned"})`, source)]);
  });
}

export function patterns(file) {
  if (!file) return [];
  const source = cite(LABEL.controlled("patterns.json"), { date: file.updatedAt?.slice(0, 10) });
  const out = [];
  for (const [kind, row] of Object.entries(file.byKind ?? {})) {
    if (!["gym", "study"].includes(kind) || !row) continue;
    const node = makeNode("habit", kind, { label: titleCase(kind), facts: [fact(`${row.happened ?? 0} of ${row.planned ?? 0} planned ${kind} blocks happened`, source)], source });
    out.push(fragment([node], [makeEdge(SELF, node.id, "keeps", `${row.happened ?? 0}/${row.planned ?? 0} kept`, source)]));
  }
  if (Number.isFinite(file.wake?.median)) {
    const node = makeNode("routine", "wake", { label: "Wake-up",
      facts: [fact(`Usually up around ${clockOfMinutes(file.wake.median)} (median of ${file.wake.samples ?? "?"} days)`, source)], source });
    out.push(fragment([node], [makeEdge(SELF, node.id, "keeps", "Measured from his mornings", source)]));
  }
  return out;
}

export function projectsFile(file) {
  const list = Array.isArray(file?.projects) ? file.projects : [];
  const source = cite(LABEL.controlled("projects.json"));
  return list.filter((p) => p?.id && p?.title).map((p) => {
    const milestones = (p.milestones ?? []).map((m) => fact(`${m.done ? "Done" : "Open"}: ${m.title}${m.due ? ` (due ${m.due})` : ""}`, source));
    const facts = [fact(`${titleCase(p.status ?? "tracked")} since ${p.startedOn ?? "unknown"}`, source), ...(p.note ? [fact(p.note, source)] : []), ...milestones];
    const node = makeNode("project", p.id, { label: p.title, facts, source });
    return fragment([node], [makeEdge(SELF, node.id, "working-on", `${titleCase(p.status ?? "tracked")} project`, source)]);
  });
}

// MARK: Calendar

const courseParts = (title) => {
  const m = [...String(title).matchAll(COURSE_CODE)][0];
  if (!m) return null;
  const code = `${m[1]}${m[2]}`;
  const name = String(title).slice(m.index + m[0].length).split(/\s[—–-]\s/)[0].trim();
  return { code, name };
};
const placeName = (location) => String(location).replace(/\s+\d+[A-Z]?$/, "").trim();

/** Keywords that tie a deadline to a course: its name's words and the code's subject. */
function courseKeywords(nodes) {
  return nodes.filter((n) => n.type === "course").map((n) => ({
    id: n.id,
    words: new Set([...significantWords(n.subtitle ?? "", 5), ...(n.aliases ?? []).flatMap((a) => significantWords(a, 4)), n.label.toLowerCase()]),
  }));
}

export function calendar(cal, { zone, knownCourses = [] }) {
  if (!cal) return [];
  const source = cite(cal.live ? LABEL.calendarLive : LABEL.controlled("glance-calendar.json"), { date: cal.generatedAt?.slice(0, 10) });
  const out = [];
  const courseNodes = [];
  for (const b of cal.blocks ?? []) {
    const parts = b?.kind === "class" || COURSE_CODE.test(b?.title ?? "") ? courseParts(b?.title ?? "") : null;
    COURSE_CODE.lastIndex = 0;
    if (!parts) continue;
    const course = makeNode("course", parts.code, { subtitle: parts.name || undefined, facts: [fact(`On his calendar: ${b.title}`, source)], source });
    courseNodes.push(course);
    const edges = [makeEdge(SELF, course.id, "takes", "On his calendar", source)];
    const nodes = [course];
    if (b.location) {
      const place = makeNode("place", placeName(b.location), { facts: [fact(`Where ${parts.code} meets (${b.location})`, source)], source });
      nodes.push(place);
      edges.push(makeEdge(course.id, place.id, "meets-at", `${parts.code} meets at ${b.location}`, source));
    }
    out.push(fragment(nodes, edges));
  }
  const keywords = courseKeywords([...knownCourses, ...courseNodes]);
  const goal = (title, facts) => {
    // "DUE 13:30 — Marketing (MKTG2201) submission" reads as "Marketing (MKTG2201) submission".
    const clean = String(title).replace(/^DUE\s+\d{1,2}:\d{2}\s*[—–-]\s*/i, "").trim() || String(title);
    const node = makeNode("goal", clean, { facts, source });
    const words = new Set([...significantWords(clean, 4), ...[...clean.matchAll(COURSE_CODE)].map((m) => `${m[1]}${m[2]}`.toLowerCase())]);
    const linked = keywords.filter((k) => [...k.words].some((w) => words.has(w)));
    return fragment([node], [makeEdge(SELF, node.id, "working-toward", "On his calendar or to-do list", source),
      ...linked.map((k) => makeEdge(node.id, k.id, "deadline-for", `“${clean}” is for ${k.id.split(":")[1].toUpperCase()}`, source))]);
  };
  for (const d of cal.deadlines ?? []) if (d?.title) out.push(goal(d.title, [fact(`Due ${dayAndTime(d.at, zone)}`, source)]));
  for (const t of cal.todos ?? []) {
    if (!t?.title || t.done) continue;
    out.push(goal(t.title, [fact(`Open to-do${t.due ? `, due ${dayAndTime(t.due, zone)}` : ""}${t.priority ? ` (priority ${t.priority})` : ""}`, source)]));
  }
  return out;
}

export const courseIdOf = (code) => nodeId("course", code);
