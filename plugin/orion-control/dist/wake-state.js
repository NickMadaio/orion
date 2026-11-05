/*
 His next wake alarm, from the files that actually hold it, verified before ORION states it (w20 routegate, L2 in the tube audit).

 wake-flow said "Your wake alarm is still set for Mon 07:00" from wake-request.json while the real alarm was 05:50 in wake-plan.json:
 the request file is a one-off that nothing deletes once it has rung, so it was weeks old (setAt 2026-10-19). Two sources hold an alarm:
   wake-plan.json     the plan's alarms (what the phone schedules); an alarm counts only while it is still ahead
   wake-request.json  a one-off from orion-wake; it counts only while its time is still ahead (a past one is stale and ignored)
 The next alarm is the earliest of the two that is still ahead (the same rule scripts/lib/reach/morning.mjs alarmClock uses). Nothing ahead: undefined,
 and the caller says nothing about an alarm instead of guessing.
*/
import { readFileSync } from "node:fs";
import { join } from "node:path";
const readJson = (file) => { try {
    return JSON.parse(readFileSync(file, "utf8"));
}
catch {
    return undefined;
} };
const ahead = (t, now) => Number.isFinite(t) && t - now.getTime() >= 60_000;
export function nextWake(stateDir, now) {
    if (!stateDir)
        return undefined;
    const found = [];
    const plan = readJson(join(stateDir, "wake-plan.json"));
    for (const a of plan?.alarms ?? []) {
        const t = typeof a?.iso === "string" ? Date.parse(a.iso) : NaN;
        if (a?.off !== true && ahead(t, now))
            found.push({ at: new Date(t), source: "plan" });
    }
    const req = readJson(join(stateDir, "wake-request.json"));
    const rt = typeof req?.at === "string" ? Date.parse(req.at) : NaN;
    if (ahead(rt, now))
        found.push({ at: new Date(rt), source: "request" });
    return found.sort((a, b) => a.at.getTime() - b.at.getTime())[0];
}
const ymd = (d) => d.toLocaleDateString("en-CA");
/** "today at 5:50 AM", "tomorrow at 5:50 AM", "Friday at 9:00 AM". */
export function spokenWake(at, now) {
    const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (ymd(at) === ymd(now))
        return `today at ${time}`;
    if (ymd(at) === ymd(tomorrow))
        return `tomorrow at ${time}`;
    return `${at.toLocaleDateString("en-GB", { weekday: "long" })} at ${time}`;
}
