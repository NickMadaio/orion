import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withoutUnverifiedAlarmClaims } from "./alarm-claims.js";
const dirWith = (alarmIso) => {
    const dir = mkdtempSync(join(tmpdir(), "ac-"));
    if (alarmIso)
        writeFileSync(join(dir, "wake-plan.json"), JSON.stringify({ alarms: [{ iso: alarmIso }] }));
    return dir;
};
const now = new Date(2026, 10, 5, 2, 34);
const alarm = new Date(2026, 10, 5, 6, 30).toISOString();
describe("a stated wake-up time must be the real one", () => {
    it("drops an invented 7:45 when the alarm is 6:30", () => {
        expect(withoutUnverifiedAlarmClaims("Just checking in. You're all set for sleep until your 7:45 AM wake-up.", dirWith(alarm), now)).toBe("Just checking in.");
    });
    it("drops 'sleep well until 7:45' too (live gate 3 #99), and keeps it when it is the real alarm", () => {
        expect(withoutUnverifiedAlarmClaims("Goodnight Nick. Sleep well until 7:45 AM.", dirWith(alarm), now)).toBe("Goodnight Nick.");
        expect(withoutUnverifiedAlarmClaims("Goodnight Nick. Sleep well until 6:30 AM.", dirWith(alarm), now)).toBe("Goodnight Nick. Sleep well until 6:30 AM.");
        for (const t of ["Night mate, you're good to sleep till 7:45.", "Rest until 8 AM.", "Sleeping until 7:45 AM then."])
            expect(withoutUnverifiedAlarmClaims(t, dirWith(alarm), now), t).not.toMatch(/7:45|8 AM/);
    });
    it("keeps it", () => { expect(withoutUnverifiedAlarmClaims("Sleep well. Lecture is at 9:00 AM.", dirWith(alarm), now)).toBe("Sleep well. Lecture is at 9:00 AM."); });
    it("keeps the real time, however it is written", () => {
        for (const t of ["6:30 AM", "6:30 am", "06:30"])
            expect(withoutUnverifiedAlarmClaims(`You're up at ${t} for your alarm.`, dirWith(alarm), now), t).toContain(t);
    });
    it("drops any stated alarm time when no alarm is set", () => {
        expect(withoutUnverifiedAlarmClaims("Sleep well. Your alarm is at 7:45 AM.", dirWith(), now)).toBe("Sleep well.");
        expect(withoutUnverifiedAlarmClaims("Sleep well. Your alarm is at 7:45 AM.", undefined, now)).toBe("Sleep well.");
    });
    it("leaves sentences that are not about the alarm, and alarm talk with no time", () => {
        expect(withoutUnverifiedAlarmClaims("Your lecture is at 9:00 AM. Your alarm is on.", dirWith(alarm), now)).toBe("Your lecture is at 9:00 AM. Your alarm is on.");
    });
});
