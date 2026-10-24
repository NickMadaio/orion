// orion-patterns routines | learn — the learned weekly routines.
//   orion-patterns routines [--json]                 what is learned, each with its evidence dates
//   orion-patterns learn [--dry-run] [--calendar]    re-mine history and write learned-routines.json (nightly; cheap, no model)
// Seams: ORION_CONTROLLED_DIR, ORION_SESSIONS_DIR, ORION_REACH_NOW (the clock).
import { controlledDir } from "../awareness/state.mjs";
import { gatherEvidence } from "./sources.mjs";
import { learnFromEvidence, explain, eveningSummary } from "./run.mjs";
import { readRoutines, writeRoutines } from "./store.mjs";
import { addDays, eveningOf } from "./time.mjs";
import { WINDOW_DAYS } from "./learn.mjs";

/** His own calendar events for the window, through the bridge (TCC needs launchd); any failure is "no calendar". */
async function calendarRows(now) {
  try {
    const { liveDayWithLogged } = await import("../life/live-day.mjs");
    const today = eveningOf(now), rows = [];
    const deadline = Date.now() + 30_000;
    for (let i = WINDOW_DAYS - 1; i >= 0 && Date.now() < deadline; i--) {
      const date = addDays(today, -i);
      try { rows.push(...(await liveDayWithLogged(date)).filter((b) => b.kind !== "commute").map((b) => ({ date, title: b.title, start: b.start, end: b.end, source: b.source, logged: !!b.logged }))); } catch { /* skip the day */ }
    }
    return rows;
  } catch { return []; }
}

export async function routinesCommand(args, { env = process.env } = {}) {
  const dir = env.ORION_CONTROLLED_DIR || controlledDir();
  const now = env.ORION_REACH_NOW ? new Date(env.ORION_REACH_NOW) : new Date();
  if (args[0] === "routines") {
    const file = readRoutines(dir);
    if (args.includes("--json")) console.log(JSON.stringify(file, null, 2));
    else console.log(`${file.at ? `Learned ${file.at}.` : "Never learned yet (orion-patterns learn)."}\n${explain(file.routines)}`);
    return 0;
  }
  try {
    const ev = gatherEvidence({ dir, now, env, calendar: args.includes("--calendar") ? await calendarRows(now) : [] });
    const { routines, evenings } = learnFromEvidence(ev, { now });
    if (args.includes("--dry-run")) {
      console.log(`Evidence: ${JSON.stringify(ev.counts)}\nEvenings seen:\n${eveningSummary(evenings)}\n\n${explain(routines)}`);
      return 0;
    }
    writeRoutines(dir, { routines, at: now.toISOString(), sources: ev.counts });
    console.log(`Learned ${routines.filter((r) => r.status === "confident").length} confident routine(s), ${routines.length} listed.`);
    return 0;
  } catch (error) {
    console.error(`orion-patterns learn failed: ${error?.message ?? error}`);
    return 1;
  }
}
