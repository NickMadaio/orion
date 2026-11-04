// The reminder actions the worker can run: alarm_set with repeat / important / place, snooze, done (w19-reminders).
process.env.TZ = "Europe/London";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_CATALOG } from "./catalog.js";
import { executeAction } from "./executors.js";
const step = (action, args) => ({ id: "s", action, arguments: args, dependsOn: [], risk: "low", expectedEffect: "x", verify: "reminder_stored", sourceRefs: ["user_request"], reversible: true });
const run = async (action, args, file) => executeAction(ACTION_CATALOG[action], step(action, args), { roots: {}, simulatedState: new Map(), remindersPath: file });
const fresh = async (list = []) => { const dir = await mkdtemp(path.join(os.tmpdir(), "ract-")); const file = path.join(dir, "reminders.json"); await writeFile(file, JSON.stringify(list)); return file; };
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const future = (h) => new Date(Date.now() + h * 3600_000);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
describe("alarm_set carries the new fields", () => {
    it("stores repeat, important and place exactly as given", async () => {
        const file = await fresh();
        await run("alarm_set", { at: iso(future(5)), label: "take pills", repeat: { days: [1, 2, 3, 4, 5], time: "09:00" }, important: true }, file);
        await run("alarm_set", { at: iso(future(20)), label: "water plants", place: "home" }, file);
        const [a, b] = await read(file);
        expect(a).toMatchObject({ label: "take pills", repeat: { days: [1, 2, 3, 4, 5], time: "09:00" }, important: true });
        expect(b).toMatchObject({ label: "water plants", place: "home" });
        expect(a.important).toBe(true);
        expect("important" in b).toBe(false);
    });
    it("a malformed repeat or place is refused before anything is written", () => {
        const check = ACTION_CATALOG.alarm_set.validateArguments;
        expect(check({ at: "2030-01-01T09:00", repeat: { days: [9], time: "09:00" } })).not.toEqual([]);
        expect(check({ at: "2030-01-01T09:00", repeat: { days: [1], time: "9am" } })).not.toEqual([]);
        expect(check({ at: "2030-01-01T09:00", place: "the moon" })).not.toEqual([]);
        expect(check({ at: "2030-01-01T09:00", important: "yes" })).not.toEqual([]);
        expect(check({ at: "2030-01-01T09:00", repeat: { days: [1], time: "09:00" }, place: "home", important: false })).toEqual([]);
    });
    it("setting a reminder keeps one that already fired (done and snooze still need it) and drops only the stale", async () => {
        const now = Date.now();
        const file = await fresh([
            { id: "fired", kind: "alarm", label: "gone off", dueAt: now - 600_000, createdAt: now - 7_200_000, firedAt: now - 600_000 },
            { id: "stale", kind: "alarm", label: "slept through", dueAt: now - 600_000, createdAt: now - 7_200_000 },
            { id: "rec", kind: "alarm", label: "daily", dueAt: now + 3600_000, createdAt: now - 1000, repeat: { days: [0, 1, 2, 3, 4, 5, 6], time: "09:00" } }
        ]);
        await run("alarm_set", { at: iso(future(3)), label: "new one" }, file);
        expect((await read(file)).map((r) => r.id).sort()).toEqual(["fired", "rec", expect.any(String)].sort());
    });
});
describe("listing and cancelling see recurring and place reminders, not the ones already fired", () => {
    it("reminder_list and reminder_cancel", async () => {
        const now = Date.now();
        const file = await fresh([
            { id: "p1", kind: "alarm", label: "water plants", dueAt: now + 86_400_000, createdAt: now, place: "home" },
            { id: "f1", kind: "alarm", label: "already rang", dueAt: now - 1000, createdAt: now - 9000, firedAt: now - 1000 }
        ]);
        const listed = await run("reminder_list", {}, file);
        expect(listed.output.reminders.map((r) => r.id)).toEqual(["p1"]);
        await run("reminder_cancel", { id: "water" }, file);
        expect((await read(file)).map((r) => r.id)).toEqual(["f1"]);
    });
});
describe("reminder_snooze and reminder_done", () => {
    it("snooze 'last' moves the one that just fired", async () => {
        const now = Date.now();
        const file = await fresh([{ id: "a1", kind: "alarm", label: "call mom", dueAt: now - 60_000, createdAt: now - 3_600_000, firedAt: now - 60_000, open: now - 60_000 }]);
        const out = await run("reminder_snooze", { id: "last", minutes: 10 }, file);
        expect(out.mode).toBe("scheduled");
        const [r] = await read(file);
        expect(Math.round((r.dueAt - Date.now()) / 60_000)).toBe(10);
        expect(r.firedAt).toBeNull();
    });
    it("done removes a one-off", async () => {
        const now = Date.now();
        const file = await fresh([{ id: "a1", kind: "alarm", label: "call mom", dueAt: now - 60_000, createdAt: now - 3_600_000, firedAt: now - 60_000 }]);
        const out = await run("reminder_done", { id: "a1" }, file);
        expect(out.mode).toBe("cancelled");
        expect(await read(file)).toEqual([]);
    });
    it("with nothing fired lately both fail loudly, and the validators want an id and sane minutes", async () => {
        const file = await fresh([]);
        await expect(run("reminder_done", { id: "last" }, file)).rejects.toThrow(/nothing fired lately/);
        await expect(run("reminder_snooze", { id: "last", minutes: 10 }, file)).rejects.toThrow(/nothing fired lately/);
        expect(ACTION_CATALOG.reminder_snooze.validateArguments({ id: "last", minutes: 0 })).not.toEqual([]);
        expect(ACTION_CATALOG.reminder_snooze.validateArguments({ id: "last", minutes: 10 })).toEqual([]);
        expect(ACTION_CATALOG.reminder_done.validateArguments({ id: "" })).not.toEqual([]);
    });
});
