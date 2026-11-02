import { describe, expect, it } from "vitest";
import { episodeFromUserText } from "./episodic.js";
import { junkEpisodeLines, nearDuplicate, stripInjectedContext } from "./episode-filter.js";

const ctx = (q: string) => `[ORION context: you messaged him first, 4 min ago: "${q}". This message MAY be his answer.]\n`;
const prefs = "[Nick's scheduling preferences]\n- **must**: daily anchors. Never bumped.\n- **high**: sleep should be protected.\n\n[Current user request]\n";
const app = "[Orion app context — factual state]\nFocus session: inactive.\nDo not claim an app is blocked.\n\nUser message:\n";

describe("episode filter", () => {
  it.each(["ye", "ok", "sure whenever", "lol", "5 more min", "yeah", "nvm", "nah im good", "thx"])("skips filler %s", (t) => {
    expect(episodeFromUserText(ctx("Want a break?") + app + t)).toBeUndefined();
  });
  it("skips scheduling-preferences scaffolding", () => {
    expect(episodeFromUserText(prefs + "move my nap later")).toBeUndefined();
    expect(episodeFromUserText(`${app}${prefs}ok`)).toBeUndefined();
  });
  it.each(["should i bring a jacket", "ok should i go to the gym or nap first", "whats actually next"])("skips question %s", (t) => {
    expect(episodeFromUserText(t)).toBeUndefined();
  });
  it("strips labels", () => {
    expect(stripInjectedContext(ctx("hi?") + app + "hello")).toBe("hello");
  });
  it.each([
    "remember i hate being called buddy and dont use emojis",
    "going forward keep my gym at 5 no matter what",
    "i decided to drop the side project until finals are done",
    "my timezone is eastern and my phone is an iphone",
  ])("keeps genuine %s", (t) => {
    expect(episodeFromUserText(ctx("Anything else?") + prefs + t)).toBe(t);
  });
  it("combines a dependent reply with ORION's message or drops it", () => {
    expect(episodeFromUserText("yeah always do that")).toBeUndefined();
    expect(episodeFromUserText(ctx("Want me to protect your nap daily?") + "yeah always do that")).toContain("ORION asked");
  });
  it("detects near duplicates and cleans a file idempotently", () => {
    expect(nearDuplicate("remember i hate emojis a lot", "remember i hate emojis a lot!!")).toBe(true);
    const file = "# d\n## Episodes\n\n- 02:58 AM — [auto] [Nick's scheduling preferences] Never moved\n- 02:52 AM — [auto] sure whenever\n- 02:55 AM — [auto] remember i hate being called buddy\n- 02:56 AM — [auto] remember i hate being called buddy.\n";
    expect(junkEpisodeLines(file).map((j) => j.index)).toEqual([3, 4, 6]);
  });
});
