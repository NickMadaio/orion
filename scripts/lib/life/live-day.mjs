// Nick's real day as life-loop blocks (2026-09-29): Apple Calendar through the
// Mac bridge, classified into the kinds the planner reasons about. Calendar
// events are fixed; only what ORION booked itself (study, side-project and
// focus blocks it created) is movable. Read-only.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { ignoredEvent } from "./config.mjs";

const run = promisify(execFile);
// The installed copy first (launchd- and app-started processes cannot read ~/Desktop), then the build.
// ORION_BRIDGE_BIN: a stand-in bridge for tests (the same override calendar-write honours).
const BRIDGE = process.env.ORION_BRIDGE_BIN || ([join(homedir(), ".openclaw/orion-remote/bin/orion-mac-bridge"),
                join(homedir(), "Desktop/ORION/native/OrionMacBridge/.build/release/orion-mac-bridge")].find((p) => existsSync(p))
  ?? join(homedir(), "Desktop/ORION/native/OrionMacBridge/.build/release/orion-mac-bridge"));

export const localDate = (at) => at.toLocaleDateString("en-CA");
const minuteOf = (at) => at.getHours() * 60 + at.getMinutes();

export function classify(title) {
  const t = title.toLowerCase();
  if (/\b(lecture|seminar|lab|workshop|tutorial|class)\b|\b(cs|econ|mktg)\d{3,4}\b/.test(t)) return "class";
  if (/^due\b|\bquiz|exam|deadline|submission\b/.test(t)) return "deadline";
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
      const kind = e.orion && /^[a-z_]+$/.test(e.orion) ? e.orion : classify(title);
      const endMinute = localDate(end) === date ? minuteOf(end) : 1440;
      const fixed = kind === "class" || kind === "deadline" || !movable(title, e.orion || null);
      return { id: `cal-${i}-${String(e.identifier ?? i).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24) || i}`,
               title: title.slice(0, 120), kind, date, start: minuteOf(start),
               end: Math.max(minuteOf(start) + 1, endMinute), fixed, source: e.orion ? "orion" : "calendar",
               calendarId: e.identifier ?? null };
    })
    .sort((a, b) => a.start - b.start);
}

export async function calendarEvents() {
  const request = JSON.stringify({ id: "life", action: "list_upcoming_calendar_events", payload: {} });
  const { stdout } = await run("/bin/sh", ["-c", `printf '%s\\n' '${request}' | "${BRIDGE}"`], { timeout: 30000, maxBuffer: 8 << 20 });
  const line = stdout.split("\n").find((l) => l.trim().startsWith("{"));
  const parsed = line ? JSON.parse(line) : null;
  if (!parsed?.ok) throw new Error(parsed?.error ?? "the calendar bridge did not answer");
  return JSON.parse(parsed.result.events_json ?? "[]").filter((e) => !ignoredEvent(e.title));
}

export async function liveDay(date) {
  return toBlocks(await calendarEvents(), date);
}
