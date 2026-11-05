/*
 "gym 10-11pm" is booked at his time even past the day's end (the scheduler stretches the window to a start he stated), so nothing
 refuses it any more: instead he is TOLD it runs past his bedtime, and how to move it (tube audit E5, where the refusal said only
 "didn't fit"). The bedtime is read back from wake-plan.json, the file the phone and the nudges use, after every part has run, so a
 bedtime he moved in the same message is the one compared against. Nothing there: nothing is said.
*/
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ampm = (m) => { const h = Math.floor(m / 60) % 24; return `${(h + 11) % 12 + 1}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
/** That evening's "asleep by" as minutes after midnight of its day (00:00-04:59 is after midnight, so 24:00+), or undefined. */
export function plannedBedtime(stateDir, date) {
    if (!stateDir)
        return undefined;
    try {
        const doc = JSON.parse(readFileSync(join(stateDir, "wake-plan.json"), "utf8"));
        const hit = doc.bedtimes?.find((b) => b.date === ymd(date) && typeof b.sleepBy === "string");
        const m = /^(\d{2}):(\d{2})$/.exec(String(hit?.sleepBy ?? ""));
        if (!m)
            return undefined;
        const min = Number(m[1]) * 60 + Number(m[2]);
        return min < 300 ? min + 1440 : min;
    }
    catch {
        return undefined;
    }
}
/** One line for each block (end in minutes) that runs past that bedtime, or none. */
export function pastBedtimeNote(placed, bedtime) {
    if (bedtime === undefined)
        return undefined;
    const past = placed.filter((p) => p.end > bedtime);
    if (!past.length)
        return undefined;
    const names = past.map((p) => p.title.toLowerCase());
    return `${names.join(" and ")} ${past.length > 1 ? "run" : "runs"} past your ${ampm(bedtime)} bedtime, so say "move my bedtime" if you want it later`;
}
