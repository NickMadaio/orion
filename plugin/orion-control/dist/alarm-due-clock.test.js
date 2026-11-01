// Gate run-1101020721 foc-pomodoro-break-v: an alarm resolved on the plugin clock (the sandbox's now) was described against the Mac's
// real clock, so a same-day 10:10 alarm came back as due in ~32 hours and was said as "tomorrow". "due in" is worded on pluginNow.
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ACTION_CATALOG } from "./catalog.js";
import { executeAction } from "./executors.js";
import { resetClockCache } from "./plugin-clock.js";
const step = (args) => ({ id: "alarm", action: "alarm_set", arguments: args, dependsOn: [], risk: "low", expectedEffect: "Alarm stored", verify: "reminder_stored", sourceRefs: ["user_request"], reversible: true });
const saved = process.env.ORION_CONTROLLED_DIR;
afterEach(() => { if (saved === undefined)
    delete process.env.ORION_CONTROLLED_DIR;
else
    process.env.ORION_CONTROLLED_DIR = saved; resetClockCache(); });
describe("alarm due-in on the plugin clock", () => {
    it("a sandboxed now: an alarm 10 minutes after it is due in 10 minutes, not a day and a half", async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), "alarm-clock-"));
        await writeFile(path.join(dir, "eval-mode"), "on\n");
        await writeFile(path.join(dir, "eval-calendar.json"), JSON.stringify({ now: "2030-03-04T09:00:00Z", events: [] }));
        process.env.ORION_CONTROLLED_DIR = dir;
        resetClockCache();
        const store = path.join(dir, "reminders.json");
        const out = await executeAction(ACTION_CATALOG.alarm_set, step({ at: "2030-03-04T09:10:00Z", label: "back from break" }), { roots: {}, simulatedState: new Map(), remindersPath: store });
        expect(out.mode).toBe("scheduled");
        expect(out.output.dueIn).toBe("10 minutes");
        expect(JSON.parse(await readFile(store, "utf8"))).toHaveLength(1);
    });
});
