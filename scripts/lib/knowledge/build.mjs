// The knowledge graph, end to end: read the sources, extract fragments, assemble, then apply Nick's overrides last
// so his edits win on every rebuild. Pure apart from the reads in loadSources (and the calendar probe it is given).
import { SCHEMA, assemble, fragment } from "./graph.mjs";
import { loadSources, sourceReport } from "./sources.mjs";
import { extractProfile } from "./extract-profile.mjs";
import { anchors, calendar, homeCity, patterns, placesFromCommutes, placesKnown, projectsFile, routines } from "./extract-life.mjs";
import { focusSessions, frontmostApp, health, sleepTimes } from "./extract-body.mjs";
import { notesAgainst, peopleInNotes } from "./extract-daily.mjs";
import { applyOverrides, readOverrides } from "./overrides.mjs";

export function extract(src) {
  const zone = src.location?.home || "UTC";
  const profile = extractProfile(src);
  const knownCourses = assemble(profile).nodes;
  const structured = [
    ...profile,
    ...placesFromCommutes(src.places), ...placesKnown(src.knownPlaces), ...homeCity(src.location),
    ...routines(src.routines), ...anchors(src.lifeConfig), ...patterns(src.patterns), ...projectsFile(src.projects),
    ...calendar(src.calendar, { zone, knownCourses }),
    ...frontmostApp(src.focusActivity), ...focusSessions(src.focusHistory), ...sleepTimes(src.sleepActual, zone), ...health(src.health),
  ];
  const labels = new Set(assemble(structured).nodes.flatMap((n) => [n.label, ...(n.aliases ?? [])]).map((s) => s.toLowerCase()));
  const withPeople = [...structured, ...peopleInNotes(src.daily, labels)];
  return assemble([...withPeople, ...notesAgainst(src.daily, assemble(withPeople).nodes)]);
}

/**
 * @param calendarProbe () => { ok, blocks?, note? } — the live calendar; omitted or failing, glance-calendar.json is used
 * @returns the graph with `sources` (what was read) and `overrides.applied` (how many of his edits took effect)
 */
export function buildGraph({ workspaceDir, controlledDir, now = new Date(), calendarProbe } = {}) {
  const src = loadSources({ workspaceDir, controlledDir, calendarProbe });
  const extracted = extract(src);
  const { graph, applied } = applyOverrides({ schema: SCHEMA, generatedAt: now.toISOString(), ...extracted, sources: sourceReport(src) },
    readOverrides(controlledDir));
  return { ...graph, overrides: { applied } };
}

export const emptyFragment = fragment;
