import { describe, expect, it } from "vitest";
import { multiAskPrompt, splitAsks } from "./multi-ask.js";
describe("splitAsks: several non-scheduling requests in one message", () => {
    it("his example", () => {
        expect(splitAsks("open safari and set a timer and add milk to my list")).toEqual(["open safari", "set a timer", "add milk to my list"]);
    });
    it("run-ons, typos and spoken numbers", () => {
        expect(splitAsks("pls open spotify then set a timer for ten minutes also turn the lights off")).toEqual(["open spotify", "set a timer for 10 minutes", "turn the lights off"]);
        expect(splitAsks("can you close discord, pause the music and text mom im here")).toEqual(["close discord", "pause the music", "text mom im here"]);
    });
    it("a noun list inside one ask is not split", () => {
        expect(splitAsks("add salt and pepper to my list")).toBeNull();
        expect(splitAsks("open safari and add salt and pepper to my list")).toEqual(["open safari", "add salt and pepper to my list"]);
    });
    it("scheduling clauses keep the whole message for the scheduling flow", () => {
        expect(splitAsks("open safari and add gym at 10-11")).toBeNull();
        expect(splitAsks("remind me to call mum and set a timer")).toBeNull();
        expect(splitAsks("add marketing from 7-9:30pm then gym from 10-11 and push sleep to 11:45")).toBeNull();
        expect(splitAsks("open safari and move my class to tomorrow")).toBeNull();
    });
    it("one ask is not a multi-request", () => {
        expect(splitAsks("open safari")).toBeNull();
        expect(splitAsks("what is the weather like")).toBeNull();
    });
    it("narration that is not verb-led is not split into asks", () => {
        expect(splitAsks("i was thinking we open safari and then i dunno")).toBeNull();
    });
});
describe("multiAskPrompt", () => {
    it("numbers every ask and demands one reply covering each", () => {
        const p = multiAskPrompt(["open safari", "set a timer"], ["use app_open"]);
        expect(p).toContain('1. "open safari" (use app_open)');
        expect(p).toContain('2. "set a timer"');
        expect(p).toMatch(/EACH/);
    });
});
