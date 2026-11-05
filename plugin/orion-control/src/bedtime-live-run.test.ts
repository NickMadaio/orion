// w20 R3 (gate #19-22): the real scripts/orion-sleepplan prints pretty JSON; every bedtime turn must reply with the read-back line.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readBedtimeChange } from "./bedtime-read.js";
import { runBedChange } from "./bedtime-change.js";
import { liveSleepPlanRun } from "./sleep-plan-flow.js";

const SCRIPTS = resolve(fileURLToPath(new URL("../../../scripts", import.meta.url)));
let dir = "";
const saved: Record<string, string | undefined> = {};
const KEYS = ["HOME", "ORION_CONTROLLED_DIR", "ORION_SCRIPTS_DIR", "ORION_LIFE_CONFIG", "ORION_BRIDGE_BIN", "ORION_NOW"];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bed-live-"));
  KEYS.forEach((k) => { saved[k] = process.env[k]; });
  process.env.HOME = dir; process.env.ORION_CONTROLLED_DIR = dir; process.env.ORION_SCRIPTS_DIR = SCRIPTS;
  delete process.env.ORION_LIFE_CONFIG; delete process.env.ORION_BRIDGE_BIN; delete process.env.ORION_NOW;
  writeFileSync(join(dir, "life-config.json"), JSON.stringify({ usualWake: "08:00" }));
});
afterEach(() => {
  KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  rmSync(dir, { recursive: true, force: true });
});

const turn = async (msg: string) => {
  const c = readBedtimeChange(msg);
  expect(c, msg).toBeDefined();
  return runBedChange(c!, liveSleepPlanRun);
};
const cfg = () => JSON.parse(readFileSync(join(dir, "life-config.json"), "utf8")) as { bedtime?: string; sleepPlan?: { bedFixed?: boolean; bedOverrides?: Record<string, string> } };

// w20 r4: the answer must not depend on the hour the suite runs at; "tonight" is the coming night once a bedtime has gone by (04:30 "quarter to 12").
describe.each(["14:00", "23:30", "01:30", "04:30"])("bedtime turns through the real script at %s", (hhmm) => {
  beforeEach(() => { process.env.ORION_NOW = `2026-11-05T${hhmm}:00`; });
  it.each([
    ["bedtime tonight is quarter to 12 just for tonight", /Bedtime 11:45pm tonight/],
    ["set my bedtime to half eleven every night", /Bedtime 11:30pm every night/],
    ["going to bed at quarter to 12", /Bedtime 11:45pm/],
    ["make my bedtime 11 from now on", /Bedtime 11pm every night/],
    ["push bedtime to 11:30 tonight pls", /Bedtime 11:30pm tonight/],
    ["i wanna sleep at 11 tonight", /Bedtime 11pm tonight/],
  ])("%s replies with the read-back", async (msg, re) => {
    const r = await turn(msg);
    expect(r.flow.outcome).toBe("done");
    expect((r.flow as { reply: string }).reply).toMatch(re);
  });

  it("gate 2 #15/#105: 'every night' after a tonight-only one replies with the standing time, never the stale one-off", async () => {
    await turn("can we make bedtime twelve tonight only");
    const a = await turn("bedtime every night is quarter past 11 from now on");
    expect((a.flow as { reply: string }).reply).toMatch(/^Bedtime 11:15pm every night/);
    await turn("going to bed at quarter to 12 tonight");
    const b = await turn("actually make my bedtime half 11 every night");
    expect((b.flow as { reply: string }).reply).toMatch(/^Bedtime 11:30pm every night/);
  });

  it("gate 2 #16/#91 spoken times land on the right clock through the real script", async () => {
    expect(((await turn("im heading to bed at ten to twelve")).flow as { reply: string }).reply).toMatch(/^Bedtime 11:50pm tonight/);
    expect(((await turn("bedtime tonight is midnight")).flow as { reply: string }).reply).toMatch(/^Bedtime midnight tonight/);
  });

  it("gate 2 #18: reset after a fixed bedtime and a tonight override gives the bedtime back (nothing fixed, nothing overridden)", async () => {
    await turn("make my bedtime 11:15 every night");
    await turn("bedtime tonight is midnight");
    const r = await turn("reset my bedtime please");
    expect((r.flow as { reply: string }).reply).toMatch(/^Back to normal/);
    expect(Boolean(cfg().sleepPlan?.bedFixed)).toBe(false);
    expect(cfg().sleepPlan?.bedOverrides ?? {}).toEqual({});
    expect(cfg().bedtime).toBe("00:00");
  });

  it("reset replies Back to normal and does not write the default bedtime into the config", async () => {
    await turn("set my bedtime to half eleven every night");
    const r = await turn("reset my bedtime");
    expect(r.flow.outcome).toBe("done");
    expect((r.flow as { reply: string }).reply).toMatch(/^Back to normal/);
    expect(Boolean(cfg().sleepPlan?.bedFixed)).toBe(false);
    expect(cfg().sleepPlan?.bedOverrides ?? {}).toEqual({});
  });

  it("reset on a clean config leaves bedtime unwritten", async () => {
    const r = await turn("go back to normal bedtime");
    expect(r.flow.outcome).toBe("done");
    expect(cfg().bedtime).not.toBe("00:00");
  });
});
