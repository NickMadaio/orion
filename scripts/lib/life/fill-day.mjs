// Fill the blanks of a day once its real plans are known (2026-09-29). Nick:
// "orion should see when i wake up … sees that i go to class, and then sees
// that my entire day after is empty. we dont want that." After he has said
// what the day actually holds, this proposes what belongs in the gaps, in his
// priority order, and always leaves some time genuinely free.
import { freeGaps } from "./gaps.mjs";
import { anchorsFrom } from "./config.mjs";

/**
 * @returns [{ title, kind, minutes, at?, before?, anchor?, rank?, tags? }] — asks for the planner, most important first.
 */
export function fillDay(blocks, { now, window, weekday, config, deadlines = [], studyPlan = null }) {
  const has = (kind, from = 0, to = 1440) => blocks.some((b) => b.kind === kind && b.end > from && b.start < to);
  const minutesOf = (kind) => blocks.filter((b) => b.kind === kind).reduce((a, b) => a + b.end - b.start, 0);
  const asks = [];
  // Study for what is coming up soonest (a quiz or exam within ten days), once a day.
  // With a ramp (deadline-ramp: more study the closer each deadline is), book
  // today's share per deadline, less what is already on the calendar.
  if (Array.isArray(studyPlan)) {
    let booked = minutesOf("study");
    for (const item of studyPlan) {
      const minutes = Math.max(0, item.minutes - booked);
      booked = Math.max(0, booked - item.minutes);
      if (minutes >= 15) asks.push({ title: `Study for ${item.title}`.slice(0, 80), kind: "study", minutes });
    }
  } else {
    const soon = deadlines.filter((d) => d.daysAway >= 0 && d.daysAway <= 10).sort((a, b) => a.daysAway - b.daysAway)[0];
    if (soon && !has("study")) asks.push({ title: `Study for ${soon.title}`.slice(0, 80), kind: "study", minutes: config.studyMinutes });
  }
  // Daily anchors (the gym): must-haves, tagged so the weight survives the calendar, and exempt from freeMinutesKept.
  for (const a of anchorsFrom(config)) {
    if (a.days.includes(weekday) && !has(a.kind)) asks.push({ title: a.title, kind: a.kind, minutes: a.minutes, rank: a.rank ?? "must", tags: ["anchor"], anchor: true });
  }
  const side = config.sideProjectMinutes - minutesOf("side_project");
  if (side >= 15) asks.push({ title: config.sideProjectLabel, kind: "side_project", minutes: side });
  if (config.dinner && !has("meal", 1020, 1290) && window.end >= 1140) asks.push({ title: "Dinner", kind: "meal", minutes: 45, at: Math.max(1110, now) });
  if (minutesOf("rest") < 30) asks.push({ title: "Break", kind: "rest", minutes: 30 });
  // No wind-down when a real plan runs through bedtime (a night out): he winds down after it.
  const lateFixed = blocks.some((b) => b.fixed && b.end > window.end - config.windDownMinutes);
  if (config.windDownMinutes > 0 && window.end >= 1260 && !lateFixed && !blocks.some((b) => /wind down/i.test(b.title))) {
    asks.push({ title: "Wind down", kind: "rest", minutes: config.windDownMinutes, at: window.end - config.windDownMinutes });
  }
  // Keep some time genuinely free: stop asking once what is left would drop below it.
  let free = freeGaps(blocks, { start: Math.max(window.start, now), end: window.end }, { minimum: 15 }).reduce((a, g) => a + g.end - g.start, 0);
  free -= asks.filter((a) => a.anchor).reduce((sum, a) => sum + a.minutes, 0);
  const kept = [];
  for (const ask of asks) {
    if (!ask.anchor && free - ask.minutes < config.freeMinutesKept) continue;
    kept.push(ask); if (!ask.anchor) free -= ask.minutes;
  }
  return kept;
}
