// Where Nick is and how to reach him (2026-10-07). See scripts/orion-presence.
// 2026-10-16: an adapter over awareness.json (scripts/lib/awareness). The old shape stays for route.mjs and its callers;
// `where` is "unknown" when nothing says (it used to default to "home", which was a guess).
import { gather } from "./facts.mjs";
import { chooseChannel } from "./route.mjs";
import { liveDay, localDate } from "../life/live-day.mjs";
import { loadConfig } from "../life/config.mjs";
import { commuteWalls } from "../life/commute.mjs";
import { homedir } from "node:os";
import { join } from "node:path";
import { quietFacts as composeQuiet } from "../awareness/facets.mjs";
import { readAwareness } from "../awareness/state.mjs";
import { readJson } from "../awareness/io.mjs";
import { readKnownPlaces } from "../awareness/places.mjs";

/**
 * Quiet hours from his sleep window (2026-10-16: the old test for a "night" sleep
 * state never matched). Quiet means inside the window AND no sign he is up: no
 * Mac input in 5 min, no phone use in 5 min. `lateAwake` is inside the window but up.
 * Composed in awareness/facets.mjs; re-exported here for its existing callers and tests.
 */
export function quietFacts({ now, dir, config, facts }) {
  return composeQuiet({ now, dir, config, facts,
    night: readJson(join(dir, "night.json")), nights: readJson(join(dir, "sleep-actual.json"))?.nights ?? [],
    signal: (readJson(join(dir, "health-log.json"))?.phoneSignals ?? []).at(-1) });
}

/** Where he is, in words: a fixed plan or travel from the calendar, else the place, else "unknown". */
function whereAndOut(aw, dir) {
  const on = aw.calendar.now?.fixed ? aw.calendar.now : null;
  if (on) return { out: true, where: `at ${on.title.replace(/ — .*$/, "")}` };
  if (aw.calendar.travelNow) return { out: true, where: aw.calendar.travelNow };
  const atHome = aw.derived.atHome;
  if (atHome === true) return { out: false, where: "home" };
  if (atHome === false) {
    const place = aw.location.placeId && readKnownPlaces(dir).find((p) => p.id === aw.location.placeId);
    return { out: true, where: place?.name ?? "out" };
  }
  return { out: false, where: "unknown" };
}

// With no awareness.json at all (the writer is not installed yet) the calendar is read directly, as before.
async function liveCalendar(now) {
  try {
    const blocks = await liveDay(localDate(now));
    const { calendarFacet } = await import("../awareness/facets.mjs");
    return calendarFacet(blocks, commuteWalls(blocks, loadConfig()), now);
  } catch { return null; }
}

export async function presence(now = new Date(), { dir = process.env.ORION_CONTROLLED_DIR || join(homedir(), ".openclaw/orion-controlled"), facts: given = null } = {}) {
  const facts = given ?? gather({ dir, now });
  let aw = readAwareness({ dir, now });
  if (aw.at === null) {
    const calendar = await liveCalendar(now);
    if (calendar) aw = { ...aw, calendar, derived: { ...aw.derived } };
  }
  const all = { ...facts, ...whereAndOut(aw, dir), ...quietFacts({ now, dir, config: loadConfig(), facts }) };
  return { ...all, ...chooseChannel(all) };
}
