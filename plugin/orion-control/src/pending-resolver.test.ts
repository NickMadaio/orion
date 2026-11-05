// w20 r6 (live gate 4 #35 #36 #84 #85): one resolver for "that one" / "go": the latest question or offer ORION made in this chat, or nothing.
import { describe, expect, it } from "vitest";
import { nothingPending, pendingNote, resolvePending } from "./pending-resolver.js";
import { isBareGoAhead } from "./honest-reply.js";

const now = 1_000_000_000;
const said = (reply: string, ago = 10_000) => ({ reply, at: now - ago });

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

describe("review r6: the resolver's own words are never an offer, and a plain question is not one", () => {
  it.each(["There's nothing waiting on a yes from me right now. What did you mean?", "I don't have anything open to go ahead with. What are you after?", "Nothing's pending on my side, so I'm not sure what you mean. What should I do?"])("%s", (line) =>
    expect(resolvePending(said(line), now)).toEqual({ pending: false }));
  it.each(["Done: gym at 6. Anything else?", "It's 6:23 AM. How are you feeling?", "I couldn't find that. What did you mean?", "Your day is clear. Is there something you want to plan?".replace("want to plan", "need").replace("Is there something you need?", "Is there something specific?")])("%s leaves nothing pending", (reply) =>
    expect(resolvePending(said(reply), now)).toEqual({ pending: false }));
});

import { latestExchange } from "./pending-resolver.js";
describe("one conversation under several phone keys", () => {
  const family = (k: string) => /orion-(?:app-v2|chat)/.test(k);
  const all = new Map([["agent:main:orion-chat-a", { at: now - 30_000, reply: "You have gym at 6. Want me to move it?" }], ["agent:main:orion-chat-b", { at: now - 90_000, reply: "older" }], ["agent:main:other", { at: now - 1_000, reply: "elsewhere" }]]);
  it("a yes on another key finds the newest family exchange", () => expect(latestExchange(all, "agent:main:orion-chat-c", family)?.reply).toContain("Want me to move it?"));
  it("a key outside the family only sees its own", () => expect(latestExchange(all, "agent:main:other", family)?.reply).toBe("elsewhere"));
  it("with no key there is nothing", () => expect(latestExchange(all, undefined, family)).toBeUndefined());
});
