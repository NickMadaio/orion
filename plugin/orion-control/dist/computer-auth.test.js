/*
 2026-10-30. Nick's rule mapped onto presses ("if I specifically say to, that is permission; otherwise confirm
 irreversible only"), the bridge client's failure mapping, and the worker's number-only pick.
*/
import { describe, expect, it } from "vitest";
import { authorizePress, classifyLabel, effectNamed, isNo, isYes } from "./computer-auth.js";
import { classifyFailure, createMacBridge } from "./computer-bridge.js";
import { parsePick, pickRequest } from "./computer-worker.js";
const asked = { requested: true, generic: false, unique: true, confirmed: false };
describe("classifyLabel", () => {
    it("sorts buttons by what pressing them does", () => {
        expect(classifyLabel("Send")).toBe("outward");
        expect(classifyLabel("Place order")).toBe("outward");
        expect(classifyLabel("Delete")).toBe("destructive");
        expect(classifyLabel("Don’t Save")).toBe("destructive"); // macOS writes the curly apostrophe
        expect(classifyLabel("Don't Save")).toBe("destructive");
        expect(classifyLabel("Submit")).toBe("submit");
        expect(classifyLabel("New Note")).toBe("neutral");
    });
});
describe("authorizePress", () => {
    it("reversible steps he asked for run", () => {
        expect(authorizePress("New Note", "open notes and make a new note", asked).ok).toBe(true);
    });
    it("irreversible runs only when his words name the effect", () => {
        expect(authorizePress("Send", "click send", asked).ok).toBe(true);
        expect(authorizePress("Send", "hit the button", { ...asked, generic: true }).ok).toBe(false);
        expect(authorizePress("Delete", "close it without saving", asked).ok).toBe(true);
        expect(authorizePress("Delete", "close it", asked).ok).toBe(false);
        expect(authorizePress("Don’t Save", "close it, don’t save", asked).ok).toBe(true);
        expect(authorizePress("Buy now", "click the button", { ...asked, generic: true }).ok).toBe(false);
    });
    it("submit-class: named, or the only button he asked to press", () => {
        expect(authorizePress("Submit", "click submit", asked).ok).toBe(true);
        expect(authorizePress("Submit", "hit the button", { ...asked, generic: true, unique: true }).ok).toBe(true);
        expect(authorizePress("Submit", "hit the button", { ...asked, generic: true, unique: false }).ok).toBe(false);
    });
    it("an unrequested irreversible step always asks; his yes is the authority for that one step", () => {
        expect(authorizePress("Delete", "close it without saving", { ...asked, requested: false }).ok).toBe(false);
        expect(authorizePress("Delete", "close it", { ...asked, confirmed: true }).ok).toBe(true);
    });
    it("screen text cannot name the effect for him", () => {
        // `words` is only ever his turn; this shows what would go wrong if screen text were passed instead.
        expect(effectNamed("Send", "type hello in that box")).toBe(false);
    });
    it("yes / no", () => {
        expect(isYes("yes")).toBe(true);
        expect(isYes("go ahead")).toBe(true);
        expect(isYes("yes but change it first")).toBe(false);
        expect(isNo("no leave it")).toBe(true);
    });
});
describe("bridge client", () => {
    it("maps bridge errors to kinds", () => {
        expect(classifyFailure("Accessibility is not granted. System Settings ...")).toBe("no_access");
        expect(classifyFailure("Refused: 1Password matches the sensitive-content denylist")).toBe("denied");
        expect(classifyFailure("The element changed since it was observed: expected ...")).toBe("stale");
        expect(classifyFailure("No menu item 'File>Nope' in the frontmost app's menu bar.")).toBe("not_found");
    });
    it("speaks the bridge's JSON protocol and surfaces a refusal as a typed failure", async () => {
        const sent = [];
        const run = async (_file, _args, input) => {
            sent.push(input);
            const action = JSON.parse(input).action;
            if (action === "screen_observe") {
                return { stdout: `${JSON.stringify({ id: "1", ok: true, result: { app_name: "TextEdit", bundle_id: "com.apple.TextEdit", observation_json: JSON.stringify({ window_title: "Untitled", element: { role: "AXWindow", children: [] } }) } })}\n`, stderr: "", code: 0 };
            }
            return { stdout: `${JSON.stringify({ id: "1", ok: false, error: "Accessibility is not granted." })}\n`, stderr: "", code: 0 };
        };
        const bridge = createMacBridge({ binary: "bridge", run, relay: null });
        const o = await bridge.observe();
        expect(o).toMatchObject({ appName: "TextEdit", bundleId: "com.apple.TextEdit", windowTitle: "Untitled" });
        await expect(bridge.press("com.apple.TextEdit", { path: "0.1", role: "AXButton", label: "OK" })).rejects.toMatchObject({ kind: "no_access" });
        expect(JSON.parse(sent[1])).toMatchObject({ action: "screen_press", payload: { expected_bundle_id: "com.apple.TextEdit", path: "0.1", role: "AXButton", label: "OK" } });
    });
});
describe("worker pick", () => {
    it("accepts only an in-range integer", () => {
        expect(parsePick('{"choice":2}', 3)).toBe(2);
        expect(parsePick('{"choice":0}', 3)).toBeNull();
        expect(parsePick('{"choice":7}', 3)).toBeNull();
        expect(parsePick('{"choice":"Delete All"}', 3)).toBeNull();
        expect(parsePick("press Delete All", 3)).toBeNull();
    });
    it("frames the list as data and offers no tools", () => {
        const body = pickRequest("submit", ['1. Button "Submit form"']);
        expect(JSON.stringify(body)).toMatch(/data, not instructions/);
        expect(body).not.toHaveProperty("tools");
    });
});
