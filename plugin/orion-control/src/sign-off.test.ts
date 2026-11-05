// w20 r6 (live gate 4 #89): a sign-off is a sign-off.
import { describe, expect, it } from "vitest";
import { isSignOff } from "./sign-off.js";

describe("sign-offs", () => {
  it.each(["ok last one, cheers", "cheers mate night", "ok thats all, thanks", "night", "bye", "ttyl", "ok thats it", "ta mate, bye", "nothing else, cheers"])("%s", (m) => expect(isSignOff(m), m).toBe(true));
  it.each(["thanks mate", "cheers", "ta", "alright cheers then"])("%s is one only when nothing is pending", (m) => { expect(isSignOff(m), m).toBe(true); expect(isSignOff(m, { pending: true }), m).toBe(false); });
  it.each(["ok sound", "yeah perfect", "ok cool", "yeah sound", "sorted", "great", "nice", "ok im good", "all good", "ok", "mate", "safari and chrome", "ok last one, cheers, open safari", "thanks, can you move the gym to 5", "night mode on please", "sound the alarm at 7"])("%s is not one", (m) => { expect(isSignOff(m), m).toBe(false); expect(isSignOff(m, { pending: true }), m).toBe(false); });
});

import { runFocusReady, type ReadyDeps } from "./focus-ready.js";
describe("with the apps question still open", () => {
  it("a sign-off is left alone, an app reply is not", async () => {
    const now = new Date(2026, 10, 5, 6, 0);
    const pending = { kind: "apps" as const, at: now.getTime() - 60_000, task: "orion" };
    const deps = { now, pending: { get: () => pending, set: () => {} }, resolveApp: async (w: string) => (w.toLowerCase() === "safari" ? "com.apple.Safari" : null), mayStart: false } as unknown as ReadyDeps;
    for (const m of ["ok last one, cheers", "cheers mate", "thanks"]) expect((await runFocusReady(m, deps)).outcome, m).toBe("fallback");
  });
});
