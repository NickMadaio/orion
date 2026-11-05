import { describe, expect, it } from "vitest";
import { detectComputerIntent } from "./computer-intent.js";
// w20 r3 #5 #55: a schedule or move sentence is never text to type into the Mac.
describe("a schedule sentence never reaches the computer type tool", () => {
    it.each([
        "put the learning plan back where it was", "put the mum call at half 5 then", "put my study block back how it was",
        "put gym at 7 instead", "put the call with dad at quarter past 6", "put it back where it was pls", "put the essay slot after lunch",
        "write the lecture back where it was", "put the nap at 3ish tho",
    ])("%s", (m) => { expect(detectComputerIntent(m)).toBeNull(); });
    it("typing into a field still works", () => {
        expect(detectComputerIntent("type hello in that box on the page")?.kind).toBe("act");
        expect(detectComputerIntent("put orion test into the text field")?.kind).toBe("act");
    });
});
// review r3 #7: a bare "put" still types when an app is named, and the "put X on" forms reach open / music instead.
import { openRequest } from "./open-request.js";
import { readMusicTurn } from "./music-read.js";
describe("put hello in notes, put spotify on", () => {
    it.each(["put hello in notes", "put 'hello' in notes", "put hello in textedit", "put hello in the notes app"])("%s types", (m) => {
        const intent = detectComputerIntent(m);
        expect(intent?.kind).toBe("act");
    });
    it("put on some music is the music route", () => { expect(readMusicTurn("put on some music")).toMatchObject({ kind: "music", action: "play" }); });
    it.each([["put spotify on", "Spotify"], ["put youtube on", "youtube"]])("%s opens it", (m, want) => {
        const r = openRequest(m);
        expect(r).not.toBeNull();
        expect(r?.kind === "app" ? r.name : r?.kind === "url" ? r.url : "").toMatch(new RegExp(want, "i"));
    });
    it("put the kettle on is not an open", () => { expect(openRequest("put the kettle on")).toBeNull(); });
});
