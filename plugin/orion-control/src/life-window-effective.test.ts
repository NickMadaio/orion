// w20 fix-sleep: the plugin's bedtime readers (bedtimeMin, dayEndFor) take tonight's named bedtime, like scripts/lib/life/effective-bed.mjs.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bedtimeMin, dayEndFor } from "./life-window.js";

const evening = (): string => new Date(Date.now() - 4 * 3600_000).toLocaleDateString("en-CA");
const dirWith = (config: unknown): string => { const d = mkdtempSync(join(tmpdir(), "lw-eff-")); writeFileSync(join(d, "life-config.json"), JSON.stringify(config)); return d; };

describe("life-window reads the effective bedtime", () => {
  it("a bedtime named for tonight wins over the standing one", () => {
    const dir = dirWith({ bedtime: "00:00", windDownMinutes: 30, sleepPlan: { bedOverrides: { [evening()]: "22:30" } } });
    expect(bedtimeMin(dir)).toBe(22 * 60 + 30);
    expect(dayEndFor(dir)).toBe(22 * 60);
  });
  it("another night's override does not leak", () => {
    const dir = dirWith({ bedtime: "23:00", sleepPlan: { bedOverrides: { "2020-01-01": "21:00" } } });
    expect(bedtimeMin(dir)).toBe(23 * 60);
  });
});
