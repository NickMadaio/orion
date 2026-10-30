// Focus, apps, sleep and health. Health is summarised into what a person would say ("about 7 hours", "moderate
// recovery"); raw HRV and resting heart rate never enter the graph — the same boundary the health firewall keeps for
// model prompts (native/Orion/Tests/run-health-firewall-test.sh), because this file can be read by anything.
import { SELF, cite, fact, fragment, makeEdge, makeNode, nodeId } from "./graph.mjs";
import { LABEL } from "./sources.mjs";
import { COURSE_CODE, appName } from "./lexicon.mjs";
import { clockOfMinutes, medianClock, plural, round1 } from "./format.mjs";

export function frontmostApp(activity) {
  if (!activity?.app) return [];
  const source = cite(LABEL.controlled("focus-activity.json"), { date: activity.at?.slice(0, 10) });
  const app = appName(activity.app);
  const facts = [fact(`Frontmost when last sampled (${activity.at?.slice(0, 16).replace("T", " ") ?? "unknown"} UTC)`, source),
    ...(activity.workApp && appName(activity.workApp) === app ? [fact("Counted as a work app during focus", source)] : [])];
  const nodes = [makeNode("app", app, { facts, source })];
  const edges = [makeEdge(SELF, nodes[0].id, "uses", "The app he was in when ORION last looked", source)];
  if (activity.workApp && appName(activity.workApp) !== app) {
    const work = makeNode("app", appName(activity.workApp), { facts: [fact("Counted as a work app during focus", source)], source });
    nodes.push(work);
    edges.push(makeEdge(SELF, work.id, "uses", "His work app during focus", source));
  }
  return [fragment(nodes, edges)];
}

export function focusSessions(rows) {
  const list = (rows ?? []).filter((r) => Number.isFinite(r?.servedFocusSeconds) && r.dayKey);
  if (!list.length) return [];
  const source = cite(LABEL.controlled("focus-history.jsonl"), { date: list.at(-1).dayKey });
  const hours = list.reduce((s, r) => s + r.servedFocusSeconds, 0) / 3600;
  const days = list.map((r) => r.dayKey).sort();
  const node = makeNode("habit", "Focus sessions", { facts: [
    fact(`${plural(list.length, "session")}, ${round1(hours)} h of focus (${days[0]} to ${days.at(-1)})`, source),
  ], source });
  const edges = [makeEdge(SELF, node.id, "keeps", `${plural(list.length, "focus session")} logged`, source)];
  const byCourse = new Map();
  for (const r of list) {
    for (const m of String(r.task ?? "").matchAll(COURSE_CODE)) {
      const id = nodeId("course", `${m[1]}${m[2]}`);
      const prior = byCourse.get(id) ?? { seconds: 0, task: r.task, day: r.dayKey };
      byCourse.set(id, { ...prior, seconds: prior.seconds + r.servedFocusSeconds });
    }
  }
  for (const [id, v] of [...byCourse].sort()) {
    edges.push(makeEdge(node.id, id, "focused-on", `${Math.round(v.seconds / 60)} min of focus on “${v.task}”`,
      cite(LABEL.controlled("focus-history.jsonl"), { date: v.day })));
  }
  return [fragment([node], edges)];
}

export function sleepTimes(file, zone) {
  const nights = (file?.nights ?? []).filter((n) => n?.fellAsleep);
  if (!nights.length) return [];
  const source = cite(LABEL.controlled("sleep-actual.json"), { date: file.updatedAt?.slice(0, 10) });
  const asleep = medianClock(nights.map((n) => n.fellAsleep), zone);
  const woke = medianClock(nights.filter((n) => n.wokeAt).map((n) => n.wokeAt), zone);
  const facts = [fact(`Falls asleep around ${clockOfMinutes(asleep)} (median of ${plural(nights.length, "night")})`, source),
    ...(woke != null ? [fact(`Wakes around ${clockOfMinutes(woke)}`, source)] : [])];
  const node = makeNode("routine", "sleep", { label: "Sleep", facts, source });
  return [fragment([node], [makeEdge(SELF, node.id, "keeps", "Measured by his watch", source),
    makeEdge(node.id, nodeId("health", "sleep"), "measured-by", "The same nights, from the health log", source)])];
}

const recoveryBand = (r) => (r >= 67 ? "high" : r >= 34 ? "moderate" : "low");

export function health(log) {
  if (!log?.days || typeof log.days !== "object") return [];
  const source = cite(LABEL.controlled("health-log.json"), { date: log.updatedAt?.slice(0, 10) });
  const recent = Object.keys(log.days).sort().slice(-14).map((d) => ({ day: d, ...log.days[d] }));
  const out = [];
  const slept = recent.filter((d) => Number.isFinite(d.sleepHours) && d.sleepHours > 0);
  if (slept.length) {
    const avg = slept.reduce((s, d) => s + d.sleepHours, 0) / slept.length;
    const node = makeNode("health", "sleep", { label: "Sleep", facts: [fact(`${round1(avg)} h average over the last ${plural(slept.length, "logged night")}`, source)], source });
    out.push(fragment([node], [makeEdge(SELF, node.id, "tracks", "From his watch, via the health log", source)]));
  }
  const recovered = recent.filter((d) => Number.isFinite(d.recovery));
  if (recovered.length) {
    const avg = recovered.reduce((s, d) => s + d.recovery, 0) / recovered.length;
    const node = makeNode("health", "recovery", { label: "Recovery",
      facts: [fact(`${Math.round(avg)}% average over ${plural(recovered.length, "day")} — ${recoveryBand(avg)}`, source)], source });
    out.push(fragment([node], [makeEdge(SELF, node.id, "tracks", "From his watch, via the health log", source)]));
  }
  const workouts = Array.isArray(log.workouts) ? log.workouts.length : 0;
  if (workouts) out.push(fragment([makeNode("habit", "gym", { facts: [fact(`${plural(workouts, "workout")} logged`, source)], source })]));
  for (const s of Array.isArray(log.supplements) ? log.supplements : []) {
    if (!s?.name) continue;
    const node = makeNode("habit", s.name, { label: s.name.replace(/^\w/, (c) => c.toUpperCase()), facts: [fact([s.dose, s.timeOfDay].filter(Boolean).join(", ") || "A supplement he takes", source)], source });
    out.push(fragment([node], [makeEdge(SELF, node.id, "takes", "A supplement in his health log", source)]));
  }
  return out;
}
