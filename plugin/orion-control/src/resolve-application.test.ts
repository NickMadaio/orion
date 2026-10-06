import { describe, expect, it } from "vitest";
import { APPLICATION_ROOTS, resolveApplication } from "./executors.js";

// Regression, 6 Oct 2026: "open Finder" failed with "not installed" because
// only /Applications and /System/Applications were searched.
describe.runIf(process.platform === "darwin")("resolveApplication", () => {
  it("finds Finder in CoreServices", async () => {
    expect(APPLICATION_ROOTS).toContain("/System/Library/CoreServices");
    await expect(resolveApplication("Finder")).resolves.toMatchObject({
      path: "/System/Library/CoreServices/Finder.app",
      bundleId: "com.apple.finder",
    });
  });

  it("still finds ordinary apps", async () => {
    await expect(resolveApplication("Calendar")).resolves.toMatchObject({ bundleId: "com.apple.iCal" });
  });

  it("refuses paths instead of names and says where it looked", async () => {
    await expect(resolveApplication("../../bin/sh")).rejects.toThrow(/plain app name/);
    await expect(resolveApplication("No Such App 123")).rejects.toThrow(/CoreServices/);
  });
});
