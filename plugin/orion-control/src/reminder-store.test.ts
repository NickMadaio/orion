import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { doneReminder, latestFired, snoozeReminder, updateReminders } from "./reminder-store.js";
import { readReminders } from "./ambient.js";

const T = (h: number, m = 0) => new Date(2026, 10, 4, h, m).getTime();
const rem = (over: Record<string, unknown> = {}) => ({ id: "a1", kind: "alarm" as const, label: "call mom", dueAt: T(17), createdAt: T(9), ...over });
const store = async (list: unknown[]) => { const dir = await mkdtemp(path.join(os.tmpdir(), "rstore-")); const file = path.join(dir, "reminders.json"); await writeFile(file, JSON.stringify(list)); return file; };

describe("the shared reminder store", () => {
  it("updateReminders holds the same lock directory the script side uses, and releases it", async () => {
    const file = await store([rem()]);
    await updateReminders(file, (list) => [...list, rem({ id: "a2" })]);
    expect((await readReminders(file)).map((r) => r.id)).toEqual(["a1", "a2"]);
    await expect(readFile(`${file}.lock`)).rejects.toThrow();
  });

  it("two updates at once both land", async () => {
    const file = await store([]);
    await Promise.all([1, 2, 3, 4, 5].map((n) => updateReminders(file, (list) => [...list, rem({ id: `x${n}` })])));
    expect((await readReminders(file)).length).toBe(5);
  });

  it("latestFired finds the newest delivered one within three hours, counting a snooze", () => {
    const list = [rem({ id: "a", firedAt: T(12) }), rem({ id: "b", firedAt: T(15) }), rem({ id: "c", snoozedAt: T(16) })];
    expect(latestFired(list, new Date(T(16, 30)))?.id).toBe("c");
    expect(latestFired(list, new Date(T(20)))).toBeNull();
  });

  it("snooze moves a one-off to now + minutes; a recurring one keeps its schedule and gets a one-off", async () => {
    const one = await store([rem({ firedAt: T(17) })]);
    const r = await snoozeReminder(one, "last", 10, new Date(T(17, 2)));
    expect(r.ok && r.dueAt).toBe(T(17, 12));
    const stored = (await readReminders(one))[0]!;
    expect(stored.dueAt).toBe(T(17, 12));
    expect(stored.firedAt).toBeNull();
    const rec = await store([rem({ firedAt: T(17), repeat: { days: [0, 1, 2, 3, 4, 5, 6], time: "17:00" }, dueAt: T(17) + 86400000 })]);
    await snoozeReminder(rec, "a1", 15, new Date(T(17, 1)));
    const list = await readReminders(rec);
    expect(list).toHaveLength(2);
    expect(list.some((x) => x.repeat && x.dueAt === T(17) + 86400000)).toBe(true);
    expect(list.some((x) => !x.repeat && x.dueAt === T(17, 16))).toBe(true);
  });

  it("done removes a one-off and keeps a recurring one; with nothing fired lately it says so", async () => {
    const one = await store([rem({ firedAt: T(17) })]);
    expect((await doneReminder(one, "last", new Date(T(17, 1)))).ok).toBe(true);
    expect(await readReminders(one)).toHaveLength(0);
    const rec = await store([rem({ firedAt: T(17), repeat: { days: [1], time: "17:00" } })]);
    const d = await doneReminder(rec, "last", new Date(T(17, 1)));
    expect(d.ok && d.recurring).toBe(true);
    expect(await readReminders(rec)).toHaveLength(1);
    const none = await store([rem()]);
    expect((await doneReminder(none, "last", new Date(T(12)))).ok).toBe(false);
    expect((await snoozeReminder(none, "last", 10, new Date(T(12)))).ok).toBe(false);
  });

  it("an absurd snooze is refused", async () => {
    const file = await store([rem({ firedAt: T(17) })]);
    expect((await snoozeReminder(file, "last", 0, new Date(T(17, 1)))).ok).toBe(false);
    expect((await snoozeReminder(file, "last", 5000, new Date(T(17, 1)))).ok).toBe(false);
  });
});
