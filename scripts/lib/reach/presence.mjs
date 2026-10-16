// Where Nick is and how to reach him (2026-10-07). See scripts/orion-presence.
import { gather } from "./facts.mjs";
import { chooseChannel } from "./route.mjs";
import { liveDay, localDate } from "../life/live-day.mjs";
import { loadConfig } from "../life/config.mjs";
import { commuteWalls } from "../life/commute.mjs";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isQuietNow, sleepWindowFor } from "./quiet.mjs";

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

/**
 * Quiet hours from his sleep window (2026-10-16: the old test for a "night" sleep
 * state never matched). Quiet means inside the window AND no sign he is up: no
 * Mac input in 5 min, no phone use in 5 min. `lateAwake` is inside the window but up.
 */
export function quietFacts({ now, dir, config, facts }) {
  const minute = now.getHours() * 60 + now.getMinutes();
  const date = localDate(now);
  const window = sleepWindowFor({ date, config, night: readJson(join(dir, "night.json")),
    nights: readJson(join(dir, "sleep-actual.json"))?.nights ?? [] });
  const inWindow = isQuietNow({ minute, ...window });
  const macUp = !facts.locked && !facts.displayAsleep && Number(facts.idleSeconds) < 300;
  const signal = (readJson(join(dir, "health-log.json"))?.phoneSignals ?? []).at(-1);
  const phoneUp = signal ? now - Date.parse(signal.at) >= 0 && now - Date.parse(signal.at) <= 5 * 60_000 : false;
  const awake = macUp || phoneUp;
  return { quiet: inWindow && !awake, lateAwake: inWindow && macUp };
}

export async function presence(now = new Date(), { dir = process.env.ORION_CONTROLLED_DIR || join(homedir(), ".openclaw/orion-controlled"), facts: given = null } = {}) {
  const facts = given ?? gather();
  const minute = now.getHours() * 60 + now.getMinutes();
  let out = false, where = "home";
  try {
    const blocks = await liveDay(localDate(now));
    const on = blocks.find((b) => b.fixed && b.start <= minute && b.end > minute);
    const travel = commuteWalls(blocks, loadConfig()).find((w) => w.start <= minute && w.end > minute);
    if (on) { out = true; where = `at ${on.title.replace(/ — .*$/, "")}`; }
    else if (travel) { out = true; where = travel.title; }
  } catch {}
  const all = { ...facts, out, where, ...quietFacts({ now, dir, config: loadConfig(), facts }) };
  return { ...all, ...chooseChannel(all) };
}
