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

describe("bedtime turns through the real script", () => {
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
