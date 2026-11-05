// w20 round 6 (gate 4 #3 #11 #13 #43 #81): half-past forms without a preposition, "back to <clock>" sets, a clock never shifts, both halves of wake + bedtime.
import { describe, expect, it } from "vitest";
import { readBedtimeChange as r } from "./bedtime-read.js";
import { readSleepTurn } from "./sleep-plan-read.js";
const time = (s) => { const c = r(s); return c && "time" in c ? c.time : undefined; };
const NOW = new Date(2026, 10, 5, 22, 30);
describe("bedtime: 'half 11' and a clock with no preposition (#11 #13 #81)", () => {
    it.each([
        ["my bedtime is half 11 every night now", "23:30", "always"],
        ["bedtime tonight is half 11", "23:30", "tonight"],
        ["bedtime tonight only, ten to midnight", "23:50", "tonight"],
        ["bedtime tonight midnight", "00:00", "tonight"],
        ["make bedtime tonight midnight", "00:00", "tonight"],
        ["bedtime tonight only quarter to 12", "23:45", "tonight"],
        ["bedtime every night now half 11", "23:30", "always"],
        ["bedtime half 11 every night", "23:30", "always"],
        ["bedtime tonight is half 12", "00:30", "tonight"],
        ["my bedtime is 11:15 every night now", "23:15", "always"],
        ["bedtime tonight only 11:40", "23:40", "tonight"],
    ])("%s", (said, t, scope) => { expect(r(said)).toEqual({ time: t, scope }); });
});
describe("alarm: a clock after 'to' sets, an amount shifts (#3)", () => {
    it.each([
        ["put my alarm back to half 6", "06:30"], ["move my alarm back to 7", "07:00"], ["push my alarm back to quarter to 8", "07:45"],
        ["bring my alarm up to 6:15", "06:15"], ["pull my alarm forward to half 5", "05:30"], ["put my alarm back to 7:15", "07:15"], ["move my alarm back to quarter past 7", "07:15"],
    ])("%s", (said, t) => { expect(readSleepTurn(said, { now: NOW })).toMatchObject({ kind: "alarm", req: { kind: "set", time: t } }); });
    it.each([["put my alarm back 20", 20], ["push my alarm back 15 min", 15], ["move my alarm up half an hour", -30], ["push it back an hour", 60]])("%s still shifts", (said, m) => {
        expect(readSleepTurn(said, { now: NOW, recentAlarm: true })).toEqual({ kind: "alarm", req: { kind: "shift", minutes: m } });
    });
});
describe("wake and bedtime in one message, whichever way round (#43)", () => {
    it.each([
        "wake me at 7 tomorrow and make bedtime tonight midnight",
        "wake me at 7 tomorrow and bedtime tonight midnight",
        "set an alarm for 7 and make my bedtime tonight half 11",
        "wake me at 7 tomorrow, make bedtime tonight ten to midnight",
        "alarm at 7 tomorrow and bedtime tonight is midnight",
        "make bedtime tonight midnight and wake me at 7 tomorrow",
        "bedtime tonight is midnight, wake me at 7 tomorrow",
        "set my bedtime to half 11 tonight and wake me at 7",
    ])("%s", (said) => {
        const turn = readSleepTurn(said, { now: NOW });
        expect(turn?.kind).toBe("bedset");
        expect(turn && "alarm" in turn && turn.alarm?.kind).toBe("set");
    });
});
