// Nick's real day as life-loop blocks (2026-09-29): Apple Calendar through the
// Mac bridge, classified into the kinds the planner reasons about. Calendar
// events are fixed; only what ORION booked itself (study, side-project and
// focus blocks it created) is movable. Read-only.
import { ignoredEvent } from "./config.mjs";
// The bridge (and, during a schedule evaluation, the sandbox calendar) lives in bridge-path.
import { bridgeRequest } from "./bridge-path.mjs";
import { isSkipped } from "./skips.mjs";

export const localDate = (at) => at.toLocaleDateString("en-CA");
const minuteOf = (at) => at.getHours() * 60 + at.getMinutes();

/** What makes a title a deadline (shared: classify below, orion-agenda deadlines --json, the plugin's "what's due" read). */
export const DEADLINE_TITLE = /^due\b|\bquiz|exam|deadline|submission\b/i;

export function classify(title) {
  const t = title.toLowerCase();
  if (/\b(lecture|seminar|lab|workshop|tutorial|class)\b|\b(cs|econ|mktg)\d{3,4}\b/.test(t)) return "class";
  if (DEADLINE_TITLE.test(t)) return "deadline";
  if (/\bgym|workout|lift|run(ning)?\b/.test(t)) return "gym";
  if (/\bstudy|revise|revision|homework|problem set|reading\b/.test(t)) return "study";
  if (/\byoutube|video|edit(ing)?|content|side project|thumbnail|film(ing)?\b/.test(t)) return "side_project";
  if (/\bbreakfast|lunch|dinner|meal|cook(ing)?\b/.test(t)) return "meal";
  if (/\bnap|rest|break|relax|chill|gam(e|es|ing)|play\b/.test(t)) return "rest";
  return "other";
}

/** Plans that involve someone else, or a place and a time: never moved by ORION. */
export function isSocial(title) {
  return /\bwith\b|\bfriends?\b|\bclub|party|bar\b|pub\b|date\b|meet(ing)?\b|appointment|doctor|dentist|interview|shift\b|flight|train\b|concert|gig\b|ministry of sound|\b(?:soccer|football|rugby|basketball|volleyball|team) practice\b/i.test(title);
}

/** Things he does alone that ORION may move when the day changes. */
const MOVABLE_ALONE = /\b(study|revise|revision|homework|reading|gym|workout|run|nap|rest|break|relax|chill|gam(e|es|ing)|play|grocer(y|ies)|shopping|errands?|clean(ing)?|laundry|chores?|tidy|side project|youtube|edit(ing)?|content|video|lunch|dinner|breakfast|meal prep|cook(ing)?|sleep)\b/i;

export function movable(title, orionKind) {
  if (orionKind) return true;                 // ORION planned it itself
  if (isSocial(title)) return false;
  return MOVABLE_ALONE.test(title);
}

/** Calendar events as blocks. Fixed unless ORION planned it or it is something he does alone. */
export function toBlocks(events, date) {
  return events
    .filter((e) => e.allDay !== "true" && localDate(new Date(e.start)) === date)
    .map((e, i) => {
      const start = new Date(e.start); const end = new Date(e.end);
      const title = e.title ?? "Event";
      // ORION never plans a class or a deadline; an old block marked so is study.
      const marked = e.orion && /^[a-z_]+$/.test(e.orion) ? e.orion : null;
      const kind = marked ? (["class", "deadline"].includes(marked) ? "study" : marked) : classify(title);
      const endMinute = localDate(end) === date ? minuteOf(end) : 1440;
      // ORION's own blocks always move, whatever the title says: the to-do "DS lab"
      // was filed as a class and pinned in place over his lunch (2026-10-01).
      const fixed = e.orion ? false : kind === "class" || kind === "deadline" || !movable(title, null);
      return { id: `cal-${i}-${String(e.identifier ?? i).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24) || i}`,
               title: title.slice(0, 120), kind, date, start: minuteOf(start),
               end: Math.max(minuteOf(start) + 1, endMinute), fixed, source: e.orion ? "orion" : "calendar",
               calendarId: e.identifier ?? null };
    })
    .sort((a, b) => a.start - b.start);
}

/** The day's all-day events (q004, 2026-10-16 r8): said in a read of his day, never planned around, so never blocks. */
export function allDayTitles(events, date) {
  return events
    .filter((e) => e.allDay === "true" && localDate(new Date(e.start)) <= date && (localDate(new Date(e.start)) === date || date < localDate(new Date(e.end))))
    .map((e) => String(e.title ?? "Event").slice(0, 120));
}

export async function calendarEvents() {
  const result = await bridgeRequest("list_upcoming_calendar_events", { from: "today" });
  return JSON.parse(result.events_json ?? "[]").filter((e) => !ignoredEvent(e.title) && !isSkipped(e));
}

export async function liveDay(date) {
  return toBlocks(await calendarEvents(), date);
}
