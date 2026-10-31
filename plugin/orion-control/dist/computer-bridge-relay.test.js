/**
 * computer-bridge.ts choosing between Orion.app's relay and a direct spawn, and saying which grant is missing.
 */
import { describe, expect, it } from "vitest";
import { BridgeFailure, createMacBridge } from "./computer-bridge.js";
import { failureReply } from "./computer-read.js";
import { RelayError } from "./computer-relay.js";
const NO_AX = { stdout: `${JSON.stringify({ id: "1", ok: false, error: "Accessibility is not granted." })}\n`, stderr: "", code: 0 };
const OBSERVED = { app_name: "TextEdit", bundle_id: "com.apple.TextEdit", observation_json: JSON.stringify({ window_title: "Untitled", element: null }) };
function setup(state, send, direct = NO_AX) {
    const directCalls = [];
    const relayCalls = [];
    const relay = { state: () => state, send: async (a, p) => { relayCalls.push(a); return send(a, p); } };
    const run = async (_f, _a, input) => { directCalls.push(input ? JSON.parse(input).action : "open"); return direct; };
    return { bridge: createMacBridge({ binary: "bridge", run, relay }), directCalls, relayCalls };
}
describe("relay selection", () => {
    it("uses the relay when the app's heartbeat is fresh and trusted, and never spawns the bridge itself", async () => {
        const { bridge, directCalls, relayCalls } = setup("ready", async () => ({ ok: true, result: OBSERVED }));
        expect(await bridge.observe()).toMatchObject({ appName: "TextEdit", windowTitle: "Untitled" });
        expect(relayCalls).toEqual(["screen_observe"]);
        expect(directCalls).toEqual([]);
    });
    it("maps a bridge refusal that came through the relay to the same typed failures", async () => {
        const { bridge } = setup("ready", async () => ({ ok: false, error: "Refused: 1Password matches the sensitive-content denylist", result: {} }));
        await expect(bridge.observe()).rejects.toMatchObject({ kind: "denied" });
    });
    it("says the Orion app lacks Accessibility when the relayed bridge reports no grant", async () => {
        const { bridge } = setup("ready", async () => ({ ok: false, error: "Accessibility is not granted.", result: {} }));
        const error = await bridge.observe().catch((e) => e);
        expect(error).toMatchObject({ kind: "no_access" });
        expect(error.message).toMatch(/Orion app lacks Accessibility/);
    });
    it("calls directly when the app is down, and says the app isn't running when that has no grant either", async () => {
        const { bridge, directCalls, relayCalls } = setup("down", async () => { throw new Error("unused"); });
        const error = await bridge.observe().catch((e) => e);
        expect(directCalls).toEqual(["screen_observe"]);
        expect(relayCalls).toEqual([]);
        expect(error).toBeInstanceOf(BridgeFailure);
        expect(error.kind).toBe("app_down");
        expect(error.message).toMatch(/Orion app isn't running/);
        expect(failureReply(error, "see")).toMatch(/Orion app isn't running/);
    });
    it("succeeds directly when the app is down but the calling process has its own grant", async () => {
        const ok = { stdout: `${JSON.stringify({ id: "1", ok: true, result: OBSERVED })}\n`, stderr: "", code: 0 };
        const { bridge } = setup("down", async () => { throw new Error("unused"); }, ok);
        expect(await bridge.observe()).toMatchObject({ bundleId: "com.apple.TextEdit" });
    });
    it("names the app's missing grant when the app is up but untrusted", async () => {
        const { bridge, relayCalls } = setup("untrusted", async () => { throw new Error("unused"); });
        const error = await bridge.observe().catch((e) => e);
        expect(relayCalls).toEqual([]);
        expect(error.kind).toBe("no_access");
        expect(error.message).toMatch(/Orion app lacks Accessibility/);
        expect(failureReply(error, "control")).toMatch(/Orion app lacks Accessibility/);
    });
    it("says the app can't find the bridge", async () => {
        const { bridge } = setup("no_bridge", async () => { throw new Error("unused"); });
        await expect(bridge.observe()).rejects.toThrow(/can't find orion-mac-bridge/);
    });
    it("turns a relay timeout into an honest app_down failure", async () => {
        const { bridge } = setup("ready", async () => { throw new RelayError("timeout", "the Orion app isn't answering screen requests (nothing picked this one up in 20 s)"); });
        const error = await bridge.type("com.apple.TextEdit", "hi").catch((e) => e);
        expect(error.kind).toBe("app_down");
        expect(error.message).toMatch(/isn't answering/);
    });
    it("does not relay openApp: /usr/bin/open needs no Accessibility", async () => {
        const ok = { stdout: "", stderr: "", code: 0 };
        const { bridge, relayCalls, directCalls } = setup("ready", async () => ({ ok: true, result: {} }), ok);
        await bridge.openApp({ name: "TextEdit", bundleId: "com.apple.TextEdit" });
        expect(relayCalls).toEqual([]);
        expect(directCalls).toEqual(["open"]);
    });
});
