// W10-G: blocking his phone's app groups from chat, by code. Parsing, the route through the hooks with a mocked script, and a yes to ORION's offer.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPhoneBlock, resolveSpan, spanOf } from "./phone-block-read.js";
import { registerLocalRouting } from "./local-routing.js";
import { offerOf, readPendingTurn, runPendingTurn } from "./pending-reply.js";
import { wakeAtFromPlan } from "./phone-block-flow.js";
const NOW = new Date(2026, 10, 2, 21, 29); // Mon 21:29 local
const SENT = (what = "social blocked until 10:29 PM (60 min)") => `Sent to his phone: ${what}; every other group stays open. It lands within seconds while ORION is open on the phone, otherwise when the phone next checks in. If he never picked apps for a group, nothing is shielded and the phone asks him to pick them.`;
describe("readPhoneBlock: clear wording", () => {
    const cases = [
        ["block social media on my phone for an hour", { kind: "block", groups: ["social"], span: { minutes: 60 } }],
        ["block safari n stuff on my phone till 12", { kind: "block", groups: ["browsers"], apps: ["Safari"], span: { clock: { h: 12, m: 0, meridiem: false } } }],
        ["shut off tiktok and insta", { kind: "block", groups: ["social"], apps: ["TikTok", "Instagram"] }],
        ["block games and youtube for 2 hours", { kind: "block", groups: ["games", "video"], span: { minutes: 120 } }],
        ["block everything on my phone until 3pm", { kind: "block", all: true, span: { clock: { h: 15, m: 0, meridiem: true } } }],
        ["unblock youtube", { kind: "unblock", groups: ["video"], apps: ["YouTube"] }],
        ["let me back on social", { kind: "unblock", groups: ["social"] }],
        ["unblock everything", { kind: "unblock", groups: "all" }],
    ];
    for (const [said, want] of cases)
        it(said, () => expect(readPhoneBlock(said)).toMatchObject(want));
});
describe("readPhoneBlock: held-out phrasings (Nick's style, not from any scenario)", () => {
    const blocks = [
        ["can u lock me out of reddit for 45 min", ["social"]],
        ["pls kill whatsapp and discord till 11pm", ["messaging"]],
        ["cut off netflix on my phone for the rest of the night", ["video"]],
        ["i need to stop scrolling, disable snapchat for 3 hours", ["social"]],
        ["block roblox n clash for a couple hours", ["games"]],
        ["keep me off chrome till 9:30pm", ["browsers"]],
        ["shut down twitter and x", ["social"]],
    ];
    for (const [said, groups] of blocks)
        it(said, () => { const r = readPhoneBlock(said); expect(r?.kind, said).toBe("block"); expect(r.groups).toEqual(groups); });
    const opens = [
        ["ok unblock tiktok pls", ["social"]],
        ["turn netflix back on", ["video"]],
        ["let me use discord again", ["messaging"]],
        ["you can unblock all my apps now", "all"],
    ];
    for (const [said, groups] of opens)
        it(said, () => { const r = readPhoneBlock(said); expect(r?.kind, said).toBe("unblock"); expect(r.groups).toEqual(groups); });
});
describe("readPhoneBlock: what is not this", () => {
    for (const said of ["block off 2 hours for study on my calendar", "turn off the lights", "turn off my alarm", "unblock my apps just until 12:45", "unlock my phone for 20 minutes",
        "lock my phone", "block tiktok on my mac", "dont allow tiktok", "block the number that keeps calling", "add a study block tomorrow", "open youtube", "what are my apps doing"])
        it(`${said} is left alone`, () => expect(readPhoneBlock(said)).toBeUndefined());
    it("a bare 'block it' asks one short question and never guesses a group", () => {
        for (const said of ["block it", "block that for an hour", "block my apps"])
            expect(readPhoneBlock(said)?.kind, said).toBe("ask");
    });
    it("only an explicit everything blocks all five", () => {
        expect(readPhoneBlock("block my phone for an hour").all).toBeUndefined();
        expect(readPhoneBlock("block all my apps")).toMatchObject({ all: true });
    });
});
describe("spans", () => {
    const at = (s) => spanOf(s);
    it("lengths", () => {
        expect(at("for an hour")).toEqual({ minutes: 60 });
        expect(at("for 2 hours")).toEqual({ minutes: 120 });
        expect(at("for 45 min")).toEqual({ minutes: 45 });
        expect(at("for half an hour")).toEqual({ minutes: 30 });
        expect(at("for an hour and a half")).toEqual({ minutes: 90 });
        expect(at("i am done")).toBeUndefined();
    });
    it("till 12 at 21:29 is midnight; at 09:00 it is noon; 3pm is today's", () => {
        expect(resolveSpan(at("till 12"), NOW)).toMatchObject({ minutes: 151 });
        expect(resolveSpan(at("till 12"), new Date(2026, 10, 2, 9, 0))).toMatchObject({ minutes: 180 });
        expect(resolveSpan(at("until 3pm"), new Date(2026, 10, 2, 9, 0))).toMatchObject({ minutes: 360 });
    });
    it("over eight hours is refused, not clamped", () => {
        expect(resolveSpan({ minutes: 600 }, NOW)).toEqual({ tooLong: 600 });
    });
    it("the rest of the night ends at the wake alarm, else 07:00, capped at 480", () => {
        const span = at("for the rest of the night");
        expect(resolveSpan(span, NOW, () => new Date(2026, 10, 3, 6, 0))).toMatchObject({ minutes: 511 - 31 });
        expect(resolveSpan(span, NOW)).toMatchObject({ minutes: 480, note: "capped" });
        expect(resolveSpan(span, new Date(2026, 10, 3, 1, 0))).toMatchObject({ minutes: 360 });
    });
    it("reads the next alarm from wake-plan.json", () => {
        const dir = mkdtempSync(join(tmpdir(), "w10g-"));
        writeFileSync(join(dir, "wake-plan.json"), JSON.stringify({ alarms: [{ iso: new Date(2026, 10, 3, 6, 30).toISOString() }, { iso: new Date(2026, 10, 4, 6, 30).toISOString() }] }));
        expect(wakeAtFromPlan(dir, NOW)?.getTime()).toBe(new Date(2026, 10, 3, 6, 30).getTime());
        expect(wakeAtFromPlan(join(dir, "none"), NOW)).toBeUndefined();
    });
});
function harness(stdout, code = 0, stateDir) {
    const handlers = new Map();
    const calls = [];
    let desk = 0;
    registerLocalRouting({ on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) }, {
        warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "w10g-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Mon 21:29", now: () => NOW,
        ...(stateDir ? { stateDir } : {}),
        decideImpl: async () => { desk += 1; return { move: "escalate", tier: "standard" }; },
        phoneTimeRun: async (args) => { calls.push(args); return { stdout, code }; },
    });
    const fire = async (name, event, ctx) => { const out = []; for (const fn of handlers.get(name) ?? [])
        out.push(await fn(event, ctx)); return out; };
    let n = 0;
    const turn = async (prompt) => {
        const ctx = { runId: `g${n += 1}`, sessionKey: "agent:main:orion-chat-g" };
        await fire("before_model_resolve", { prompt }, ctx);
        const [direct] = (await fire("before_agent_reply", { prompt }, ctx));
        if (direct?.reply?.text)
            return direct.reply.text;
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        return built?.appendContext?.match(/Your whole reply must be exactly: ([\s\S]*)\]$/)?.[1] ?? `WORKER: ${built?.systemPrompt?.slice(0, 60) ?? ""}`;
    };
    return { turn, calls, desk: () => desk };
}
describe("through registerLocalRouting with a mocked script", () => {
    it("'block safari n stuff on my phone till 12' runs block browsers --minutes 151 and says which group", async () => {
        const h = harness(SENT("browsers blocked until 12:00 AM (151 min)"));
        const reply = await h.turn("block safari n stuff on my phone till 12");
        expect(h.calls).toEqual([["block", "browsers", "--minutes", "151", "--why", "asked in chat"]]);
        expect(reply).toBe("Blocked browsers on your phone until 12:00 AM, that covers Safari if it's in your Browsers list.");
        expect(h.desk()).toBe(0);
    });
    it("'shut off tiktok and insta' defaults to an hour and says so", async () => {
        const h = harness(SENT());
        const reply = await h.turn("shut off tiktok and insta");
        expect(h.calls[0]).toEqual(["block", "social", "--minutes", "60", "--why", "asked in chat"]);
        expect(reply).toContain("Blocked social media on your phone until 10:29 PM");
        expect(reply).toContain("I went with an hour");
        expect(reply).toContain("TikTok and Instagram if they're in your Social list");
    });
    it("the rest of the night uses the wake plan's alarm", async () => {
        const dir = mkdtempSync(join(tmpdir(), "w10g-"));
        writeFileSync(join(dir, "wake-plan.json"), JSON.stringify({ alarms: [{ iso: new Date(2026, 10, 3, 6, 0).toISOString() }] }));
        const h = harness(SENT("video blocked until 6:00 AM (511 min)"), 0, dir);
        await h.turn("block youtube for the rest of the night");
        expect(h.calls[0].slice(0, 3)).toEqual(["block", "video", "--minutes"]);
        expect(Number(h.calls[0][3])).toBeLessThanOrEqual(480);
    });
    it("a refused or failed run never claims a block", async () => {
        const h = harness("NOT BLOCKED: nope", 1);
        const reply = await h.turn("block social media for an hour");
        expect(reply).toMatch(/nothing is blocked/);
        expect(reply).not.toMatch(/^Blocked/);
    });
    it("an over-limit length asks instead of running", async () => {
        const h = harness(SENT());
        const reply = await h.turn("block social for 12 hours");
        expect(h.calls).toEqual([]);
        expect(reply).toMatch(/up to 8 hours.*nothing is blocked/);
    });
    it("unblock reports the script's own result", async () => {
        const h = harness("Sent to his phone: video open again. Still shut: social.");
        const reply = await h.turn("unblock youtube");
        expect(h.calls).toEqual([["unblock", "video"]]);
        expect(reply).toBe("Opened video apps on your phone again. That's the group YouTube sits in, so the rest of it is open too. Still shut: social media.");
    });
    it("unblocking what ORION never shut says nothing changed", async () => {
        const h = harness("social was not shut from here, so nothing changed. (A work-block or bedtime lock ends on its own, or use grant for extra time.)");
        expect(await h.turn("let me back on social")).toMatch(/^I didn't have social media blocked, so nothing changed/);
    });
    it("'block it' asks one short question and runs nothing", async () => {
        const h = harness(SENT());
        expect(await h.turn("block it")).toBe("Which ones, social media, browsers, video, games or messaging?");
        expect(h.calls).toEqual([]);
    });
    it("his calendar and grant wording are not taken", async () => {
        const h = harness(SENT());
        await h.turn("block off 2 hours tomorrow for the lab report");
        await h.turn("unlock my phone for 20 minutes");
        expect(h.calls).toEqual([]);
    });
});
describe("a yes to ORION's own offer blocks exactly that", () => {
    const OFFER = "You've been on TikTok a while. Want me to block social media for an hour?";
    const push = (text) => ({ text, at: new Date(NOW.getTime() - 3 * 60_000).toISOString() });
    it("reads the offer from ORION's text", () => {
        expect(offerOf(OFFER)).toEqual({ kind: "phone-block", groups: ["social"], span: { minutes: 60 } });
        expect(offerOf("I can shut off games and video until 11pm if you want.")).toMatchObject({ kind: "phone-block", groups: ["games", "video"] });
        expect(offerOf("Should I block it?")).toBeUndefined();
    });
    for (const said of ["ya", "yeah ok", "sure do it"]) {
        it(`"${said}" runs block social --minutes 60`, async () => {
            const calls = [];
            const turn = readPendingTurn({ message: said, now: NOW, lastPush: push(OFFER) });
            expect(turn?.offer?.kind).toBe("phone-block");
            const out = await runPendingTurn(turn, { now: NOW, phoneTime: async (a) => { calls.push(a); return { stdout: SENT(), code: 0 }; } });
            expect(calls).toEqual([["block", "social", "--minutes", "60", "--why", "asked in chat"]]);
            expect(JSON.stringify(out?.flow)).toContain("Blocked social media on your phone until 10:29 PM");
        });
    }
    it("a no leaves them open and runs nothing", async () => {
        const calls = [];
        const turn = readPendingTurn({ message: "nah", now: NOW, lastPush: push(OFFER) });
        const out = await runPendingTurn(turn, { now: NOW, phoneTime: async (a) => { calls.push(a); return { stdout: SENT(), code: 0 }; } });
        expect(calls).toEqual([]);
        expect(JSON.stringify(out?.flow)).toContain("leaving them open");
    });
    it("a failed run on a yes says nothing is blocked", async () => {
        const turn = readPendingTurn({ message: "yep", now: NOW, lastPush: push(OFFER) });
        const out = await runPendingTurn(turn, { now: NOW, phoneTime: async () => ({ stdout: "", code: 1 }) });
        expect(JSON.stringify(out?.flow)).toMatch(/nothing is blocked/);
    });
});
