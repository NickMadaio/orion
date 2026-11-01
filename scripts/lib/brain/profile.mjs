// Who Nick is, from the stable records first (wave 6, 2026-11-01; gate run-1101003318 per-who-am-i-c).
//
// "what do you know about me and my routine" searched the brain for "routine" and read back sleep times and a club night,
// leaving out his classes, the daily gym, the side-project hour and where he lives. Those are not search hits, they are his
// standing setup, and each has a record: the knowledge graph (classes he takes, where he lives and commutes, what he builds,
// the planning priorities), life-config.json (the gym anchor's minutes and days, the side-project minimum) and the identity
// line of his "Nick" note. This collects them as data, stable facts and trivia apart, so the reply can lead with the first.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { displayText } from "./forget.mjs";

/** Bullets under "## Learned" in his Nick note, as plain text. */
const learnedLinesOf = (note) => {
  let inLearned = false;
  return String(note).split("\n").flatMap((line) => {
    if (/^##\s/.test(line)) { inLearned = /^##\s+Learned\b/i.test(line); return []; }
    return inLearned && /^-\s+\S/.test(line) ? [strip(displayText(line))] : [];
  }).filter(Boolean);
};

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const readText = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const strip = (s) => String(s ?? "").replace(/[.\s]+$/, "").trim();

const edgesFrom = (graph, kinds) => {
  if (!graph) return [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return graph.edges.filter((e) => e.from === "person:self" && kinds.includes(e.kind)).map((e) => ({ edge: e, node: byId.get(e.to) })).filter((x) => x.node);
};
const factOf = (graph, id) => graph?.nodes.find((n) => n.id === id)?.facts?.[0]?.text;
const observation = (note, tag) => strip(note.match(new RegExp(`^-\\s+\\[${tag}\\]\\s+(.+)$`, "mi"))?.[1]);

/** @returns {{ name, school, classes: string[], gym, sideProject, priorities, home, commute, builds: string[], working: string[], trivia: string[], learned: string[] }} */
export function buildProfile({ graph = null, lifeConfig = null, nickNote = "" } = {}) {
  const self = graph?.nodes.find((n) => n.id === "person:self");
  const name = strip(self?.subtitle ?? self?.facts?.[0]?.text?.replace(/^Name:\s*/, "")) || "";
  const identity = observation(nickNote, "identity");
  const school = strip(edgesFrom(graph, ["studies-at"])[0]?.edge.reason?.replace(/^School:\s*/, "")) || identity;
  const classes = edgesFrom(graph, ["takes"]).filter((x) => x.node.type === "course").map((x) => x.node.subtitle ? `${x.node.label} (${x.node.subtitle})` : x.node.label);
  const gymAnchor = (lifeConfig?.anchors ?? []).find((a) => a.kind === "gym");
  const gym = gymAnchor?.minutes
    ? `${gymAnchor.minutes} min ${(gymAnchor.days ?? []).length >= 7 ? "every day" : `${(gymAnchor.days ?? []).length} days a week`}${gymAnchor.rank === "must" ? " (a must, never dropped)" : ""}`
    : strip(factOf(graph, "habit:gym"));
  const sideMin = lifeConfig?.minimums?.["side project"];
  const sideProject = sideMin ? `at least ${sideMin >= 60 && sideMin % 60 === 0 ? `${sideMin / 60} hour${sideMin === 60 ? "" : "s"}` : `${sideMin} min`} a day` : "";
  // The graph keeps a fact to ~200 characters ("…"); the note's own line is whole, so a cut one gives way to it.
  const fromGraph = strip(factOf(graph, "preference:planning-priorities")?.replace(/^Planning priorities,?\s*(?:highest first)?:?\s*/i, ""));
  const fromNote = observation(nickNote, "priorities");
  const priorities = (/…$/.test(fromGraph) && fromNote) || fromGraph || fromNote;
  const homeNode = edgesFrom(graph, ["lives-in"])[0]?.node;
  const commuteEdge = edgesFrom(graph, ["commutes-to"])[0];
  const home = homeNode?.label ?? "";
  const commute = commuteEdge ? `${strip(commuteEdge.node.facts?.[0]?.text) || "a commute"} to ${commuteEdge.node.label}` : "";
  const builds = edgesFrom(graph, ["builds"]).map((x) => x.node.label);
  const working = edgesFrom(graph, ["working-on"]).map((x) => x.node.label);
  const routine = (id) => graph?.nodes.find((n) => n.id === id)?.facts?.map((f) => strip(f.text)) ?? [];
  const trivia = [...routine("routine:sleep"), ...routine("routine:wake").slice(0, 1)];
  const learned = [...new Set(learnedLinesOf(nickNote))];
  return { name, school, classes, gym, sideProject, priorities, home, commute, builds, working, trivia, learned };
}

/** Reads the three records from disk; a missing one leaves its fields empty, never invented. */
export function loadProfile({ controlledDir, vaultDir }) {
  return buildProfile({
    graph: readJson(join(controlledDir, "knowledge-graph.json")),
    lifeConfig: readJson(join(controlledDir, "life-config.json")),
    nickNote: readText(join(vaultDir, "20 Areas", "Me", "Nick.md")),
  });
}
