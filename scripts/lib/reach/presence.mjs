// Where Nick is and how to reach him (2026-10-07). See scripts/orion-presence.
import { gather } from "./facts.mjs";
import { chooseChannel } from "./route.mjs";
import { liveDay, localDate } from "../life/live-day.mjs";
import { loadConfig } from "../life/config.mjs";
import { commuteWalls } from "../life/commute.mjs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

export async function presence(now = new Date()) {
  const facts = gather();
  const minute = now.getHours() * 60 + now.getMinutes();
  let out = false, where = "home";
  try {
    const blocks = await liveDay(localDate(now));
    const on = blocks.find((b) => b.fixed && b.start <= minute && b.end > minute);
    const travel = commuteWalls(blocks, loadConfig()).find((w) => w.start <= minute && w.end > minute);
    if (on) { out = true; where = `at ${on.title.replace(/ — .*$/, "")}`; }
    else if (travel) { out = true; where = travel.title; }
  } catch {}
  let quiet = false;
  try { quiet = JSON.parse(execFileSync(process.execPath, [join(import.meta.dirname, "../../orion-now"), "--json"], { encoding: "utf8", timeout: 8000 })).sleep?.state === "night"; } catch {}
  const all = { ...facts, out, where, quiet };
  return { ...all, ...chooseChannel(all) };
}

