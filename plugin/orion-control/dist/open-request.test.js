// w18 opensafari: every "open X" shape is code's call, never a worker guess.
// Live 2026-11-04 09:33: "open amazon in safari" went to the 9B worker; the desk had picked the browser tool but no code ran it.
import { describe, expect, it } from "vitest";
import { openRequest } from "./open-request.js";
import { toolDirective } from "./tool-moves.js";
describe("openRequest: apps", () => {
    it("names the app, typos and run-ons included", () => {
        const cases = [
            ["open safari", "safari"], ["opne safari", "safari"], ["launch spotify", "spotify"], ["lauch spotify pls", "spotify"],
            ["pull up chrome", "chrome"], ["pul up chrome real quick", "chrome"], ["can you open safari", "safari"],
            ["could u please open up discord", "discord"], ["i need you to open xcode", "xcode"], ["oepn the notes app", "notes"],
        ];
        for (const [m, app] of cases)
            expect(openRequest(m), m).toEqual({ kind: "app", name: app });
    });
    it("is not fooled by things that are not requests to open something", () => {
        for (const m of ["open my tasks", "open the door", "what does open source mean", "open it", "launch into the story", "pull up what i have tomorrow", "i opened safari earlier"])
            expect(openRequest(m), m).toBeNull();
    });
});
describe("openRequest: sites", () => {
    it("opens a named site in the named browser", () => {
        expect(openRequest("open amazon in safari")).toEqual({ kind: "url", url: "https://www.amazon.com", browser: "Safari" });
        expect(openRequest("opne youtube on chrome pls")).toEqual({ kind: "url", url: "https://www.youtube.com", browser: "Google Chrome" });
        expect(openRequest("can you pull up reddit in safari")).toEqual({ kind: "url", url: "https://www.reddit.com", browser: "Safari" });
    });
    it("opens a domain in the default browser", () => {
        expect(openRequest("open youtube.com")).toEqual({ kind: "url", url: "https://youtube.com" });
        expect(openRequest("launch https://news.ycombinator.com")).toEqual({ kind: "url", url: "https://news.ycombinator.com" });
        expect(openRequest("open the nytimes website")).toEqual({ kind: "url", url: "https://www.nytimes.com" });
    });
    it("an unknown phrase in a browser becomes a search, never a made-up host", () => {
        expect(openRequest("open cheap flights to rome in safari")).toEqual({ kind: "url", url: "https://www.google.com/search?q=cheap+flights+to+rome", browser: "Safari" });
    });
});
describe("openRequest: folders", () => {
    it("opens a known folder", () => {
        expect(openRequest("open my downloads folder")).toEqual({ kind: "folder", folder: "downloads" });
        expect(openRequest("opne the documents folder pls")).toEqual({ kind: "folder", folder: "documents" });
        expect(openRequest("pull up my desktop folder")).toEqual({ kind: "folder", folder: "desktop" });
    });
    it("leaves an unknown folder to the worker", () => expect(openRequest("open my taxes folder")).toBeNull());
});
describe("the directive", () => {
    const args = (m) => { const t = toolDirective(undefined, m); return t && t.kind === "call" ? { action: t.action, args: JSON.parse(t.args), note: t.note, fail: t.failLine } : null; };
    it("app, url and folder each run one exact call, desk or no desk", () => {
        expect(args("opne safari")).toMatchObject({ action: "app_open", args: { steps: [{ action: "app_open", application: "safari" }] } });
        expect(args("open amazon in safari")).toMatchObject({ action: "browser_open_url", args: { steps: [{ action: "browser_open_url", url: "https://www.amazon.com", browser: "Safari" }] } });
        expect(args("open youtube.com")?.args.steps[0]).toEqual({ action: "browser_open_url", url: "https://youtube.com" });
        expect(args("open my downloads folder")).toMatchObject({ action: "folder_open", args: { steps: [{ action: "folder_open", folder: "downloads" }] } });
    });
    it("the reply is first person and the failure line owns it", () => {
        const t = args("open amazon in safari");
        expect(t.note).toMatch(/\bI opened\b/);
        expect(t.fail).toMatch(/^I /);
        expect(t.note + t.fail).not.toMatch(/ORION (can|will)/);
    });
});
