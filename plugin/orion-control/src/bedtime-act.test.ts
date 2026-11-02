import { describe, expect, it } from "vitest";
import { ACTION_CATALOG } from "./catalog.js";
import { STRICTNESS_MODES, baseLevelFor, levelForAction } from "./strictness.js";

const NAMES = ["bedtime_quit_app", "bedtime_lock_screen", "bedtime_dim", "bedtime_undim"] as const;

describe("bedtime nudges are low-risk self-imposed actions", () => {
  it("are low risk, need no approval and sit in the media tier", () => {
    for (const name of NAMES) {
      const d = ACTION_CATALOG[name]!;
      expect(d, name).toBeDefined();
      expect(d.risk, name).toBe("low");
      expect(d.approvalRequired, name).toBe(false);
      expect(d.capabilityTier, name).toBe("media_control");
      expect(d.execution.kind, name).toBe("bedtime_act");
    }
  });

  it("never reach APPROVAL in any strictness mode except contained, which asks before every write by design", () => {
    for (const name of NAMES) {
      const d = ACTION_CATALOG[name]!;
      expect(levelForAction("volume_mute", ACTION_CATALOG.volume_mute!, baseLevelFor("volume_mute", ACTION_CATALOG.volume_mute!), "contained").level).toBe("APPROVAL");
      for (const mode of STRICTNESS_MODES.filter((m) => m !== "contained")) {
        expect(levelForAction(name, d, baseLevelFor(name, d), mode).level, `${name} ${mode}`).not.toBe("APPROVAL");
      }
    }
  });

  it("quit needs a real bundle id and the other three need nothing", () => {
    const quit = ACTION_CATALOG.bedtime_quit_app!;
    expect(quit.requiredArguments).toEqual(["bundleId"]);
    expect(quit.validateArguments?.({ bundleId: "com.hnc.Discord" }) ?? []).toEqual([]);
    expect(quit.validateArguments?.({ bundleId: "x; rm -rf ~" })?.length).toBeGreaterThan(0);
    for (const name of ["bedtime_lock_screen", "bedtime_dim", "bedtime_undim"] as const) {
      expect(ACTION_CATALOG[name]!.requiredArguments).toEqual([]);
    }
  });

  it("does not change the screen-control actions: they still need approval", () => {
    for (const name of ["screen_click", "screen_type", "screen_key"]) {
      expect(ACTION_CATALOG[name]!.approvalRequired, name).toBe(true);
    }
  });
});
