// w20 r6 (live gate 4 #35 #36 #84 #85): one resolver for "that one" / "go": the latest question or offer ORION made in this chat, or nothing.
import { describe, expect, it } from "vitest";
import { nothingPending, pendingNote, resolvePending } from "./pending-resolver.js";
import { isBareGoAhead } from "./honest-reply.js";
const now = 1_000_000_000;
const said = (reply, ago = 10_000) => ({ reply, at: now - ago });
describe("what a bare go-ahead refers to", () => {
    it.each([
        ["That sounds tough. Want to log some water or take a quick break?", "Want to log some water or take a quick break?"],
        ["Spotify isn't installed on this Mac. Want me to open the Spotify web player instead?", "Want me to open the Spotify web player instead?"],
        ["About 36 g of protein (and ~770 kcal). Want me to log it?", "Want me to log it?"],
        ["I couldn't add that. Say go and I'll retry it.", "Say go and I'll retry it."],
        ["That's a lot at once. Smallest step: 25 minutes on the lab. Want me to start that?", "Want me to start that?"],
        ["Shall I move gym to 6?", "Shall I move gym to 6?"],
    ])("%s", (reply, refers) => expect(resolvePending(said(reply), now)).toEqual({ pending: true, refers }));
    it.each([
        "Set bedtime to 11:30 PM tonight.", "run is back on your calendar at 4:30 PM–4:50 PM.", "I can't see a clear fault in the record. Tell me what you expected and I'll note it.",
        "Dramatic. Okay, Shakespeare.", "Cheers, Nick! Sleep tight.", "It's 6:23 AM on Thursday.",
    ])("%s leaves nothing pending", (reply) => expect(resolvePending(said(reply), now)).toEqual({ pending: false }));
    it("nothing said, or said long ago, is nothing pending", () => {
        expect(resolvePending(undefined, now)).toEqual({ pending: false });
        expect(resolvePending(said("Want me to log it?", 20 * 60_000), now)).toEqual({ pending: false });
    });
});
describe("the words", () => {
    it.each(["that one", "go", "yeah go on then", "ok do it", "yes that one"])("%s is a bare go-ahead", (m) => expect(isBareGoAhead(m), m).toBe(true));
    it("the nothing-pending line asks, and never invents a context", () => {
        const line = nothingPending("that one");
        expect(line).toMatch(/\?$/);
        expect(line).not.toMatch(/bedtime|mcdouble|start your day/i);
    });
    it("the note carries what it refers to", () => expect(pendingNote("go", "Want me to log it?")).toContain('"Want me to log it?"'));
});
