// w18 mousechat: mouse turns read from casual phrasings, carried out through orion-mouse (a fake runner, then the real script on a temp dir),
// the one follow-up question bound to the chat, and a yes to a new-mouse outreach starting setup.
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readMouseTurn } from "./mouse-read.js";
import { MouseMemory, runMouseTurn } from "./mouse-chat.js";
import { registerLocalRouting, instructionsFor } from "./local-routing.js";
import { GENERAL_INSTRUCTIONS, MOUSE_TOOL } from "./job-instructions.js";
import { routeForDoomedExec } from "./exec-routing.js";
const NOW = new Date(2026, 10, 3, 18, 0);
const dir = () => mkdtempSync(join(tmpdir(), "mouse-chat-"));
describe("readMouseTurn: held-out casual phrasings", () => {
    const set = (button, action, app) => ({ kind: "set", button, action, ...(app ? { app } : {}) });
    it("a button and an action", () => {
        expect(readMouseTurn("yo make my back button go to the left desktop")).toEqual(set("back button", "left desktop"));
        expect(readMouseTurn("front side button should be mission control pls")).toEqual(set("front side button", "mission control"));
        expect(readMouseTurn("can u bind button 6 to a screenshot")).toEqual(set("button 6", "screenshot"));
        expect(readMouseTurn("set the mouse thumb button to cmd+shift+4")).toEqual(set("thumb button", "cmd+shift+4"));
        expect(readMouseTurn("make the forward button open spotify")).toEqual(set("forward button", "open spotify"));
    });
    it("a missing button or action is left for the script to ask about", () => {
        expect(readMouseTurn("make my side button do stage manager")).toEqual(set("side button", "stage manager"));
        expect(readMouseTurn("make the back side button do something useful")).toEqual(set("back side button", ""));
        expect(readMouseTurn("my mouse should open launchpad")).toEqual(set("", "open launchpad"));
    });
    it("only in one app", () => {
        expect(readMouseTurn("when im in safari make the back button do app expose")).toEqual(set("back button", "app expose", "safari"));
        expect(readMouseTurn("make the back button do app expose only in safari")).toEqual(set("back button", "app expose", "safari"));
    });
    it("leave a game alone, and take that back", () => {
        expect(readMouseTurn("dont do anything in minecraft")).toEqual({ kind: "passthrough", op: "add", app: "minecraft" });
        expect(readMouseTurn("leave my mouse buttons alone in photoshop")).toEqual({ kind: "passthrough", op: "add", app: "photoshop" });
        expect(readMouseTurn("stop ignoring the mouse in minecraft")).toEqual({ kind: "passthrough", op: "remove", app: "minecraft" });
        expect(readMouseTurn("turn off game detection for the mouse")).toEqual({ kind: "games", state: "off" });
        expect(readMouseTurn("turn game detection back on")).toEqual({ kind: "games", state: "on" });
    });
    it("the scroll wheel: normal in games, always, or never", () => {
        const wheel = (mode) => ({ kind: "wheel", mode });
        for (const m of ["make my scroll wheel normal", "stop inverting my mouse scroll", "my mouse wheel feels backwards, make it normal pls", "mouse scrolling is the wrong way round"])
            expect(readMouseTurn(m), m).toEqual(wheel("always"));
        for (const m of ["normal scrolling when gaming", "my mouse wheel feels so weird when im playing games", "dont invert the scroll wheel in minecraft", "scroll wheel is backwards in games, flip it"])
            expect(readMouseTurn(m), m).toEqual(wheel("games"));
        for (const m of ["leave my mouse wheel alone", "put the scroll wheel back to how it was", "dont touch my mouse scrolling anymore", "go back to the normal mac scroll on my mouse wheel"])
            expect(readMouseTurn(m), m).toEqual(wheel("never"));
    });
    it("scroll talk that is not a wheel request", () => {
        for (const m of ["scroll down and read the menu for me", "the scroll bar is stuck on my website", "is my mouse wheel inverted?", "my mouse wheel is broken", "natural scrolling feels weird on my trackpad", "how do i make the wheel normal", "inverted colors on my mac are weird", "i need a new scroll wheel for the lathe"]) {
            expect(readMouseTurn(m), m).toBeNull();
        }
    });
    it("turning every mouse button shortcut off or on", () => {
        const t = (state) => ({ kind: "shortcuts", state });
        for (const m of ["turn my mouse shortcuts off", "can u disable my mouse buttons for a bit", "switch the mouse shortcuts off pls", "shut off my mouse buttons"])
            expect(readMouseTurn(m), m).toEqual(t("off"));
        for (const m of ["turn my mouse shortcuts back on", "enable the mouse buttons again", "mouse shortcuts on pls", "switch my mouse buttons back on"])
            expect(readMouseTurn(m), m).toEqual(t("on"));
    });
    it("shortcut talk that is not the master switch", () => {
        for (const m of ["are my mouse shortcuts on?", "turn off game detection for the mouse", "dont let the mouse buttons do anything in minecraft", "turn the lights on"]) {
            expect(readMouseTurn(m)?.kind, m).not.toBe("shortcuts");
        }
    });
    it("the top button (a mouse button remapped to F13) is a button he can name", () => {
        expect(readMouseTurn("make the top button on my mouse open orion typing")).toEqual(set("top button", "open orion typing"));
        expect(readMouseTurn("set my f13 button to mission control")).toEqual(set("f13 button", "mission control"));
        expect(readMouseTurn("unbind the top button")).toEqual({ kind: "clear", button: "top button" });
    });
    it("status, clear and setup", () => {
        expect(readMouseTurn("what are my mouse buttons set to")).toEqual({ kind: "status" });
        expect(readMouseTurn("what does the back button on my mouse do rn")).toEqual({ kind: "status" });
        expect(readMouseTurn("unbind the front button")).toEqual({ kind: "clear", button: "front button" });
        expect(readMouseTurn("put my back button back to normal")).toEqual({ kind: "clear", button: "back button" });
        expect(readMouseTurn("help me set up my new mouse")).toEqual({ kind: "setup" });
    });
    it("things that are not mouse requests", () => {
        for (const m of ["dont do anything in class tomorrow", "the submit button is broken on the site", "what time is my class", "hit the back button in safari", "i need a new mouse pad", "turn off the lights in the kitchen", "did you click the button yet?"]) {
            expect(readMouseTurn(m), m).toBeNull();
        }
    });
    it("review fixes: no setup from 'get rid of the mouse', no bind from 'does nothing', and two bindings in one message", () => {
        expect(readMouseTurn("i need to get rid of the mouse in my apartment")).toBeNull();
        expect(readMouseTurn("get my new mouse set up")).toEqual({ kind: "setup" });
        expect(readMouseTurn("my mouse does nothing in minecraft")).toBeNull();
        expect(readMouseTurn("make the back button do nothing")).toEqual(set("back button", "nothing"));
        expect(readMouseTurn("set back button to nothing")).toEqual(set("back button", "nothing"));
        expect(readMouseTurn("front stage manager, back mission control")).toEqual({ kind: "many", turns: [set("front", "stage manager"), set("back", "mission control")] });
        expect(readMouseTurn("make the front button stage manager and the back button open spotify")).toEqual({ kind: "many", turns: [set("front button", "stage manager"), set("back button", "open spotify")] });
    });
    it("replies bind only to a waiting question; a yes needs a new-mouse outreach or the offered defaults", () => {
        expect(readMouseTurn("the front one", { pending: { ask: "button", action: "stage manager" } })).toEqual(set("front", "stage manager"));
        expect(readMouseTurn("4", { pending: { ask: "button", action: "stage manager" } })).toEqual(set("button 4", "stage manager"));
        expect(readMouseTurn("the front one", { pending: { ask: "button", clear: true } })).toEqual({ kind: "clear", button: "front" });
        expect(readMouseTurn("uhh mission control i guess", { pending: { ask: "action", button: "3" } })).toEqual(set("3", "mission control"));
        expect(readMouseTurn("never mind", { pending: { ask: "action", button: "3" } })).toEqual({ kind: "cancel" });
        expect(readMouseTurn("the front one")).toBeNull();
        expect(readMouseTurn("what's the weather", { pending: { ask: "button" } })).toBeNull();
        expect(readMouseTurn("sure")).toBeNull();
        expect(readMouseTurn("sure", { outreachAbout: true })).toEqual({ kind: "setup" });
        expect(readMouseTurn("yeah", { confirm: true })).toEqual({ kind: "apply" });
        expect(readMouseTurn("nah", { outreachAbout: true })).toEqual({ kind: "decline" });
    });
});
describe("runMouseTurn", () => {
    const fake = (answers, calls = []) => async (args) => {
        calls.push(args);
        const key = Object.keys(answers).find((k) => args.join(" ").includes(k));
        const out = key ? answers[key] : { ok: false, error: "unexpected" };
        return { stdout: JSON.stringify(out), code: out.ok ? 0 : 1 };
    };
    it("maps each turn to its command and says the script's own sentence", async () => {
        const calls = [];
        const run = fake({ status: { ok: true, say: "S" }, set: { ok: true, say: "D" }, clear: { ok: true, say: "C" }, passthrough: { ok: true, say: "P" }, games: { ok: true, say: "G" }, wheel: { ok: true, say: "W" }, shortcuts: { ok: true, say: "K" } }, calls);
        for (const t of [{ kind: "status" }, { kind: "set", button: "back", action: "screenshot", app: "safari" }, { kind: "clear", button: "3" }, { kind: "passthrough", op: "add", app: "minecraft" }, { kind: "games", state: "off" }, { kind: "wheel", mode: "always" }, { kind: "shortcuts", state: "off" }]) {
            expect((await runMouseTurn(t, { run })).text).toMatch(/^[SDCPGWK]$/);
        }
        expect(calls).toEqual([["status", "--json"], ["set", "back", "screenshot", "--app", "safari", "--json"], ["clear", "3", "--json"], ["passthrough", "add", "minecraft", "--json"], ["games", "off", "--json"], ["wheel", "always", "--json"], ["shortcuts", "off", "--json"]]);
    });
    it("a question from the script becomes the pending follow-up, with what is known so far", async () => {
        const run = fake({ set: { ok: true, asking: true, ask: "button", say: "Which button?" } });
        expect((await runMouseTurn({ kind: "set", button: "side button", action: "stage manager" }, { run })).pending).toEqual({ ask: "button", button: "side button", action: "stage manager" });
        const act = fake({ set: { ok: true, asking: true, ask: "action", button: 3, say: "What should it do?" } });
        expect((await runMouseTurn({ kind: "set", button: "back", action: "" }, { run: act })).pending).toEqual({ ask: "action", button: "3" });
        const setup = fake({ setup: { ok: true, asking: true, say: "Want that?" } });
        expect((await runMouseTurn({ kind: "setup" }, { run: setup })).confirm).toBe(true);
    });
    it("a failure is one honest sentence; decline and cancel run nothing", async () => {
        const calls = [];
        const bad = await runMouseTurn({ kind: "status" }, { run: async () => { throw new Error("boom"); } });
        expect(bad.text).toMatch(/nothing was changed/);
        expect((await runMouseTurn({ kind: "set", button: "x", action: "y" }, { run: fake({ set: { ok: false, error: "no", say: "No." } }, calls) })).text).toBe("No.");
        expect((await runMouseTurn({ kind: "decline" }, { run: fake({}, calls) })).calls).toEqual([]);
        expect(MouseMemory).toBeDefined();
    });
    it("MouseMemory expires after ten minutes", () => {
        const m = new MouseMemory();
        m.wait("s", NOW.getTime(), { pending: { ask: "button" } });
        expect(m.get("s", NOW.getTime() + 60_000)).toEqual({ pending: { ask: "button" } });
        expect(m.get("s", NOW.getTime() + 11 * 60_000)).toBeUndefined();
        m.clear("s");
        expect(m.get("s", NOW.getTime())).toBeUndefined();
    });
});
function route(mouseRun, d = dir()) {
    const handlers = new Map();
    const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    const fire = async (n, e, c) => { const o = []; for (const fn of handlers.get(n) ?? [])
        o.push(await fn(e, c)); return o; };
    let clock = NOW.getTime();
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(d, "r.jsonl"), progressDir: join(d, "tp"), stateDir: d, clock: () => "Tue 18:00", now: () => new Date(clock),
        decideImpl: async () => ({ move: "answer", answer: "DESK ANSWER" }), brainSearch: async () => "",
        scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }),
        readDayJson: async () => undefined, readDeadlines: async () => ({ events: [], tasks: [] }), listReminders: async () => [], ...(mouseRun ? { mouseRun } : {}), });
    let n = 0;
    const turn = async (prompt) => {
        clock += 30_000;
        const ctx = { runId: `m-${n += 1}`, sessionKey: "agent:main:orion-chat-mouse" };
        await fire("before_model_resolve", { prompt }, ctx);
        const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx));
        await fire("before_prompt_build", { prompt, messages: [] }, ctx);
        return direct?.reply?.text;
    };
    return { turn, dir: d, now: () => clock };
}
const script = fileURLToPath(new URL("../../../scripts/orion-mouse", import.meta.url));
const realRun = (d) => (args) => new Promise((resolve) => execFile(process.execPath, [script, ...args], { env: { ...process.env, ORION_CONTROLLED_DIR: d, ORION_MOUSE_NO_LOOKUP: "1" } }, (e, stdout) => resolve({ stdout: String(stdout), code: e ? 1 : 0 })));
const DEVICES = { version: 1, devices: [{ id: "5426:153", name: "Razer Basilisk V3", transport: "USB", buttonCount: 11, extraButtons: [3, 4], connected: true, setupState: "asked" }] };
const bindingsOf = (d) => JSON.parse(readFileSync(join(d, "mouse", "bindings.json"), "utf8"));
const seed = (d) => { mkdirSync(join(d, "mouse")); writeFileSync(join(d, "mouse", "devices.json"), JSON.stringify(DEVICES)); };
describe("mouse through the routing (the real orion-mouse, a temp dir)", () => {
    it("an ambiguous side button asks once, his answer sets it, and the desk answers none of it", async () => {
        const d = dir();
        seed(d);
        const r = route(realRun(d), d);
        expect(await r.turn("make my side button do stage manager")).toBe("Which button, the front or the back side button?");
        expect(await r.turn("the front one")).toBe("Done: the front side button now does Stage Manager.");
        expect(bindingsOf(d).default).toEqual({ 4: { kind: "system", name: "stageManager" } });
        expect(await r.turn("back button should go to the left desktop")).toBe("Done: the back side button now does the left desktop.");
        expect(await r.turn("dont do anything in minecraft")).toBe("Done: the mouse buttons won't do anything in Minecraft.");
        expect(bindingsOf(d).passthroughApps).toEqual(["com.mojang.minecraftlauncher"]);
        expect(await r.turn("what are my mouse buttons set to")).toMatch(/front side button: Stage Manager; back side button: the left desktop|back side button: the left desktop; front side button: Stage Manager/);
    });
    it("two bindings in one message are both written", async () => {
        const d = dir();
        seed(d);
        const r = route(realRun(d), d);
        expect(await r.turn("front stage manager, back mission control")).toBe("Done: the front side button now does Stage Manager. Done: the back side button now does Mission Control.");
        expect(bindingsOf(d).default).toEqual({ 3: { kind: "system", name: "missionControl" }, 4: { kind: "system", name: "stageManager" } });
    });
    it("a missing action asks, and an unrelated turn after the question unbinds it", async () => {
        const d = dir();
        seed(d);
        const r = route(realRun(d), d);
        expect(await r.turn("make the back button do something")).toMatch(/^What should it do\?/);
        expect(await r.turn("what time is my class tomorrow")).not.toMatch(/Done:/);
        expect(await r.turn("stage manager")).not.toMatch(/Done:/);
        expect(() => readFileSync(join(d, "mouse", "bindings.json"))).toThrow();
    });
    it("a yes to the new-mouse outreach, or 'help me set up my mouse', says the one sentence and asks the Mac for its popup; buttons named next still bind", async () => {
        const d = dir();
        seed(d);
        writeFileSync(join(d, "outreach.jsonl"), `${JSON.stringify({ text: "I see a new mouse, a Razer Basilisk V3. Want me to set up its extra buttons?", at: new Date(NOW.getTime() - 60_000).toISOString(), channel: "app" })}\n`);
        const r = route(realRun(d), d);
        const SAY = "Okay, let me help. Tell me what you want the buttons to do, or set them here:";
        expect(await r.turn("sure")).toBe(SAY);
        expect(await r.turn("front side stage manager")).toBe("Done: the front side button now does Stage Manager.");
        expect(await r.turn("help me set up my mouse")).toBe(SAY);
        const popups = readFileSync(join(d, "outreach.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((x) => x.kind === "mouse");
        expect(popups).toHaveLength(2);
        expect(popups[0]).toEqual({ kind: "mouse", event: "setup-open", at: expect.any(String) });
    });
    it("'pull up the mouse button mapper again' asks the Mac for the popup and says Here it is, never a refusal (11-03)", async () => {
        const d = dir();
        seed(d);
        const r = route(realRun(d), d);
        for (const m of ["wait, can you pull up the mouse button mapper again", "bring back the button mapper"])
            expect(await r.turn(m)).toBe("Here it is.");
        const rows = readFileSync(join(d, "outreach.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
        expect(rows.map((x) => x.event)).toEqual(["setup-open", "setup-open"]);
    });
    it("a yes counts only right after the outreach: not after another turn, not 20 minutes later", async () => {
        const calls = [];
        const stale = dir();
        writeFileSync(join(stale, "outreach.jsonl"), `${JSON.stringify({ text: "I see a new mouse. Want me to set up its buttons?", at: new Date(NOW.getTime() - 20 * 60_000).toISOString(), channel: "app" })}\n`);
        await route(async (a) => { calls.push(a); return { stdout: "{}", code: 1 }; }, stale).turn("ok");
        const busy = dir();
        writeFileSync(join(busy, "outreach.jsonl"), `${JSON.stringify({ text: "I see a new mouse. Want me to set up its buttons?", at: new Date(NOW.getTime() - 5 * 60_000).toISOString(), channel: "app" })}\n`);
        const r = route(async (a) => { calls.push(a); return { stdout: "{}", code: 1 }; }, busy);
        await r.turn("what time is it");
        await r.turn("ok");
        expect(calls).toEqual([]);
    });
    it("a yes with no mouse outreach is not a mouse turn, and without a runner nothing is taken", async () => {
        const calls = [];
        const r = route(async (args) => { calls.push(args); return { stdout: "{}", code: 1 }; });
        await r.turn("sure");
        await r.turn("make the side button do stage manager");
        expect(calls.map((c) => c[0])).toEqual(["set"]);
        const none = route(undefined);
        expect(await none.turn("make the front button mission control")).not.toMatch(/Done:/);
    });
});
describe("the worker's toolbelt and exec routing", () => {
    it("carries orion-mouse only on a mouse turn", () => {
        expect(instructionsFor(undefined, "what are my mouse buttons set to")).toBe(`${GENERAL_INSTRUCTIONS}\n\n${MOUSE_TOOL}`);
        expect(instructionsFor(undefined, "turn the lights on")).toBe(GENERAL_INSTRUCTIONS);
    });
    it("a bare orion-mouse in the shell is sent to its full path", () => {
        expect(routeForDoomedExec("orion-mouse status")?.reason).toMatch(/orion-mouse/);
        expect(routeForDoomedExec("/opt/orion/scripts/orion-mouse status")).toBeUndefined();
    });
});
