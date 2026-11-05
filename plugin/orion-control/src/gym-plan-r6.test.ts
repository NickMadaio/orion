// w20 r6 (live gate 4 #94): "what gym session should i do today" is about what to do, not a history count.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readGym, runGym } from "./health-log.js";

describe("a gym question about what to do", () => {
  it.each(["what gym session should i do today", "which workout should i do", "what should i do at the gym today", "what gym workout should i do tonight", "what should i lift today", "whats a good gym session for today"].slice(0, 5))("%s", (m) => expect(readGym(m), m).toEqual({ kind: "gym", scope: "plan" }));
  it("history questions stay history", () => {
    expect(readGym("have i been going to the gym")).toEqual({ kind: "gym", scope: "last7" });
    expect(readGym("how many gym sessions this week")).toEqual({ kind: "gym", scope: "week" });
    expect(readGym("move my gym session to 5")).toBeNull();
  });
  it("the answer starts from the last lift and asks what he wants", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gym-"));
    writeFileSync(join(dir, "health-log.json"), JSON.stringify({ schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [{ day: "2026-11-04", title: "Push", exercises: [{ name: "bench press" }, { name: "overhead press" }] }] }));
    const out = await runGym({ kind: "gym", scope: "plan" }, { stateDir: dir, now: new Date(2026, 10, 5, 9, 0) });
    const t = (out as { text: string }).text;
    expect(t).toMatch(/Your last gym was yesterday \(bench press and overhead press\)/);
    expect(t).not.toMatch(/last 7 days|of 7 days/);
    expect(t).toMatch(/\?$/);
  });
});
