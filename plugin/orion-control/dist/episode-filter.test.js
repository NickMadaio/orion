import { describe, expect, it } from "vitest";
import { episodeFromUserText } from "./episodic.js";
import { isDurableEpisode, isJunkCandidate, junkEpisodeLines, nearDuplicate, stripInjectedContext } from "./episode-filter.js";
const ctx = (q) => `[ORION context: you messaged him first, 4 min ago: "${q}". This message MAY be his answer.]\n`;
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
// Wave 12 (2026-11-02): the live journal kept prompt scaffolding as Nick's words ("[auto] Answer the whole thing.) Exactly remember
// that part.", "Reply with the collection titles you actually observed.", the transport's own rules), and nothing chose which of the
// surviving lines were worth keeping as facts. Both rules live here so the writer and the nightly consolidator agree.
describe("scaffolding is junk, and only standing lines are durable", () => {
    it.each([
        "Answer the whole thing.) Exactly remember that part.",
        "Answer the whole thing.) During They pay us around thirteen thousand pounds.",
        "Reply with the collection titles you actually observed.",
        "Never offer to enable, configure or repair it, and never claim it is unavailable. - These words are handled by the transport before you ever see them",
        "Answer in three short lists: (1) the things you were asked to do recently and could NOT, with the exact blocker for each",
        "This existing destination must stay unchanged.",
    ])("junk: %s", (t) => {
        expect(isJunkCandidate(t)).toBe(true);
    });
    it.each([
        "First, naps should be at least an hour and 15 minutes long ALWAYS.",
        "Going forward remember that you can change how much time is allotted to non priority items",
        "remember i hate being called buddy and dont use emojis",
    ])("durable: %s", (t) => {
        expect(isDurableEpisode(t)).toBe(true);
    });
    it.each([
        "actually do resume before gym",
        "I need to actually hear you.",
        "actually nah ditch the macro stuff",
        "It just seemed like it was thinking longer than it should.",
        "Um, I also think, yeah, the focus session should be able to start from anywhere.",
        "do you actually know anything about me or is this all fake",
        "Orion, you should be able to...",
        "Answer the whole thing.) Exactly remember that part.",
        "If anything, you should still have a short break, maybe just five minutes in between.",
        "Id prefer we fix the tool to br able to handle more.",
        "The think actually shortens it, but it doesn't shorten it normally. And then every time I went to go end it, it would just make it six minutes long instead of the ten minutes long.",
    ])("not durable: %s", (t) => {
        expect(isDurableEpisode(t)).toBe(false);
    });
});
