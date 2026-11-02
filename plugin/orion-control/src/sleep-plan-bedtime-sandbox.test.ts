// W10-B review 4 (gate run-1102024210, hea-bedtime-set-c): "set my bedtime to 11:30 …" went through health-log.ts and wrote the LIVE
// life-config.json during a sandboxed evaluation. In a sandbox (eval-mode marker + fresh eval-calendar.json, the pair
// scripts/lib/life/config.mjs uses) it reads and writes eval-life-config.json; the live file is never touched. No real paths.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readBedtime, runBedtime } from "./health-log.js";
import { resetClockCache } from "./plugin-clock.js";

const dirs: string[] = [];
afterEach(() => { dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })); resetClockCache(); });
const stateDir = (sandboxed: boolean): string => {
  const d = mkdtempSync(join(tmpdir(), "bedsb-"));
  dirs.push(d);
  writeFileSync(join(d, "life-config.json"), JSON.stringify({ bedtime: "00:00", usualWake: "09:00" }));
  if (sandboxed) {
    writeFileSync(join(d, "eval-mode"), "");
    writeFileSync(join(d, "eval-calendar.json"), JSON.stringify({ now: new Date(2026, 10, 2, 20, 0).toISOString(), events: [] }));
  }
  return d;
};

describe("a bedtime set during a sandboxed evaluation never touches the live life-config.json", () => {
  it("sandbox: writes eval-life-config.json, live file byte-identical", async () => {
    const d = stateDir(true);
    const live = readFileSync(join(d, "life-config.json"), "utf8");
    const out = await runBedtime(readBedtime("make my bedtime 10:45 for the rest of the week")!, { stateDir: d });
    expect(out).toMatchObject({ outcome: "done" });
    expect(readFileSync(join(d, "life-config.json"), "utf8")).toBe(live);
    expect(JSON.parse(readFileSync(join(d, "eval-life-config.json"), "utf8")).bedtime).toBe("22:45");
  });
  it("no sandbox: the live file, as before", async () => {
    const d = stateDir(false);
    await runBedtime(readBedtime("make my bedtime 10:45 for the rest of the week")!, { stateDir: d });
    expect(JSON.parse(readFileSync(join(d, "life-config.json"), "utf8")).bedtime).toBe("22:45");
    expect(existsSync(join(d, "eval-life-config.json"))).toBe(false);
  });
});
