// w20 wording (tube audit 2026-11-04, root cause 1): the class (c) turns, in his phrasing. A failure says what went wrong and what to do next;
// it never says "say it again" / "rephrase" / "same problem", and a bare ellipsis never reaches a typed or phone turn.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { RepeatGuard, QUIET_REPLY } from "./chatter.js";
import { acknowledgement } from "./tool-failure.js";
import { BUILD_OFFER, capabilityLine, honestReply, pickVariant, refusalRewrite, resetVariants, truthfulDenial } from "./honest-reply.js";
import { honestLine, spokenFinalLine } from "./local-routing.js";
import { failureReply, spokenFailure } from "./schedule-reply.js";
import { parseReason } from "./failure-reason.js";
import { readSelffixMove, runSelffixMove } from "./selffix-flow.js";
const NEVER = /say it again|rephrase|same problem|can you say|tell me differently/i;
const NOW = new Date(2026, 10, 4, 20, 0, 0);
describe("E1 E5: the scheduler's real reason reaches him, with the next step", () => {
    it("structured reason: after bedtime names both times and offers to move bedtime or book it anyway", () => {
        const said = failureReply({ reason: { code: "bedtime", what: "gym", at: "22:00", bedtime: "21:50" } });
        expect(said).toMatch(/gym at 10:00 PM is after your 9:50 PM bedtime/);
        expect(said).toMatch(/move your bedtime.*book it anyway/);
        expect(said).not.toMatch(NEVER);
    });
    it("structured reason as a bare code, and as a JSON fragment riding in the scheduler's line", () => {
        expect(spokenFailure({ reason: "bedtime" })).toMatch(/after your bedtime/);
        expect(spokenFailure('NOTHING WAS CHANGED: gym {"reason":"bedtime","at":"22:00"}')).toMatch(/after your bedtime/);
        expect(spokenFailure("NOT BOOKED: gym reason=bedtime")).toMatch(/after your bedtime/);
    });
    it("the same failure from today's text lines still names the cause", () => {
        expect(failureReply("NOT BOOKED: gym (30 min) did not fit on Wednesday")).toMatch(/gym didn't fit around your classes and bedtime/);
    });
});
describe("E12 E15 E19: a start that already passed", () => {
    it("says it already started, both times, and offers to put it on from now", () => {
        const said = failureReply("NOTHING WAS CHANGED: marketing myseum at 19:00 has already started (it is 19:57). If he is doing it now: orion-reschedule now");
        expect(said).toMatch(/marketing myseum already started at 7:00 PM and it's 7:57 PM/);
        expect(said).toMatch(/put marketing myseum on from now/);
        expect(said).not.toMatch(/orion-reschedule|19:/);
    });
});
describe("E8 E9: nothing to clear is said as a fact with a way forward", () => {
    it("no movable block", () => {
        const said = failureReply("NOTHING WAS DROPPED on Wednesday: no movable block matches (a class or a plan with people?) \"after nap\". Movable blocks today: none");
        expect(said).toMatch(/no movable block by that name/);
        expect(said).toMatch(/Which block did you mean/);
    });
});
describe("E2 E6 E9 E13: a repeat of a failed ask", () => {
    const nd = "I couldn't do that: marketing myseum already started at 7:00 PM and it's 7:57 PM. Want me to put marketing myseum on from now instead?";
    it("keys on his message: a phone repeat gets a different, useful reply, three times, never an ellipsis", () => {
        const g = new RepeatGuard();
        const ask = "Add marketing myseum from 7pm to 9:30pm. Then gym from 10pm to 11pm.";
        expect(g.guard("p", nd, false, 0, ask)).toBe(nd);
        const out = [60_000, 70_000, 80_000].map((t) => g.guard("p", nd, false, t, ask));
        for (const o of out) {
            expect(o).not.toBe(QUIET_REPLY);
            expect(o).not.toBe(nd);
            expect(o).not.toMatch(NEVER);
        }
        expect(out[0]).toMatch(/already started/i);
        expect(out[0]).toMatch(/I'm doing marketing myseum now/);
        expect(new Set(out).size).toBeGreaterThan(1);
    });
    it("a different message that fails the same way is not a repeat", () => {
        const g = new RepeatGuard();
        expect(g.guard("p", nd, false, 0, "add marketing myseum 7 to 9:30")).toBe(nd);
        expect(g.guard("p", nd, false, 10, "ok put the museum thing on at 7")).toBe(nd);
    });
    it("a spoken repeat is answered once, then quiet", () => {
        const g = new RepeatGuard();
        expect(g.guard("v", nd, true, 0, "add the museum at 7")).toBe(nd);
        expect(g.guard("v", nd, true, 1, "add the museum at 7")).not.toBe(QUIET_REPLY);
        expect(g.guard("v", nd, true, 2, "add the museum at 7")).toBe(QUIET_REPLY);
    });
});
describe("E14 E16: a model reply that was true stays", () => {
    it("'Nothing changed. It's already running. I can't add it now.' is a truthful denial", () => {
        expect(truthfulDenial("Nothing changed. Marketing Myseum at 7:00 PM is already running. I can't add it now.")).toBe(true);
        expect(truthfulDenial("I can't add it because 7:00 PM has already passed. Nothing changed.")).toBe(true);
    });
    it("a reply that claims a change is not, and neither is one after a real write", () => {
        expect(truthfulDenial("Done, I added gym at 10 PM.")).toBe(false);
        expect(truthfulDenial("I couldn't move it, but I added gym.", [{ canonical: "orion-reschedule add gym", stdout: "planned gym: 22:00–23:00", exit: 0 }])).toBe(false);
    });
});
describe("E14 E16 E18: when the model's reply must go, what happened replaces it", () => {
    it("from a failed scheduler run: first person, the reason, the next step", () => {
        const said = honestReply({ calendar: true, message: "Add marketing museum anyways don't worry if it already passed", tools: [{ canonical: "exec orion-reschedule add marketing museum 150 --at 19:00", stdout: "NOTHING WAS CHANGED: marketing museum at 19:00 has already started (it is 20:00)", exit: 1 }] });
        expect(said).toMatch(/^I couldn't make that change: marketing museum already started at 7:00 PM and it's 8:00 PM/);
        expect(said).toMatch(/Want me to put marketing museum on from now/);
        expect(said).not.toMatch(NEVER);
    });
    it("with no tool at all: says nothing ran and offers to do it, in variants that never repeat back to back", () => {
        resetVariants();
        const a = honestReply({ calendar: false, message: "Not now", rotate: true });
        const b = honestReply({ calendar: false, message: "Not now", rotate: true });
        const c = honestReply({ calendar: false, message: "Not now", rotate: true });
        for (const t of [a, b, c]) {
            expect(t).toMatch(/couldn't (actually )?run that/);
            expect(t).toMatch(/\?$/);
            expect(t).not.toMatch(NEVER);
        }
        expect(a).not.toBe(b);
        expect(b).not.toBe(c);
    });
    it("honestLine and the spoken final line never ask him to say it again", () => {
        expect(honestLine(true, "move gym to 7")).not.toMatch(NEVER);
        const f = spokenFinalLine(["claims what the tools don't show"], { calendar: true, wrote: false, tools: [], message: "put gym at 7" });
        expect(f).not.toMatch(NEVER);
        expect(spokenFinalLine(["did not finish"], { calendar: false, wrote: false })).not.toMatch(NEVER);
    });
    it("a failed app open (M12) says what failed and how to go on", () => {
        const said = honestReply({ calendar: false, message: "amazon is a website, i asked you to open it. open amazon UK on my browser please", tools: [{ canonical: "orion_task_run browser_open_url", stdout: 'Application "amazon uk" was not found in /Applications', exit: 1 }] });
        expect(said).toMatch(/^I couldn't run that: I couldn't find it\./);
        expect(said).toMatch(/exact name/);
    });
});
describe("M3 M7 M8 M10: a failed open owns the failure with its reason, never 'lookup', never a bare 'could not do that'", () => {
    it.each(["open amazon uk for me", "open amazon ik", "open amazon uk on safari"])("%s", () => {
        const said = acknowledgement([{ canonical: "app_open", stdout: 'Application "amazon" was not found in /Applications', exit: 1 }], false);
        expect(said).toMatch(/^I couldn't run that — nothing opened\. I couldn't find it\. Tell me the exact app or site/);
        expect(said).not.toMatch(/lookup/);
    });
});
describe("M1 and 11-03: a model refusal that hands the job back becomes what is missing, plus 'want me to build that?'", () => {
    it.each([
        ["re-open it one more time please, the \"desktop ->\" isnt working", "I can't reopen a specific app or fix a desktop shortcut issue with the tools I have. Try restarting the app or checking the desktop shortcut settings directly."],
        ["close some of the apps that are open that im not using. things like epic games and team view", "I can't quit apps directly. You'll need to close Epic Games and Team View manually from your dock or Activity Monitor."],
        ["wait, can you pull up the mouse button mapper again", "I can't pull up apps on your Mac—that's not something ORION can do. But I can help you set up the mouse buttons if you want."],
    ])("%s", (message, reply) => {
        const out = refusalRewrite(reply, message);
        expect(out).toBeDefined();
        expect(out).toMatch(BUILD_OFFER);
        expect(out).not.toMatch(/restart|manually|yourself|ORION/);
    });
    it("a question or a plain answer is never rewritten", () => {
        expect(refusalRewrite("I can't see your screen from here, so I don't know.", "what's on my screen right now")).toBeUndefined();
        expect(refusalRewrite("You have gym at 6.", "when is gym")).toBeUndefined();
    });
    it("capabilityLine states the gist and varies", () => {
        const lines = new Set(["close the spotify tab", "mute my mic", "print my notes"].map((m) => capabilityLine(m)));
        for (const l of lines) {
            expect(l).toMatch(BUILD_OFFER);
            expect(l).toMatch(/nothing|haven't touched/i);
        }
        expect(capabilityLine("can you close some of my apps")).toMatch(/"close some of your apps"/);
    });
});
describe("the build offer hands off to the self-fix flow with the request attached", () => {
    const request = "close some of the apps that are open that im not using";
    it.each(["yes", "yeah build it", "sure go ahead", "ok build that", "yep"])("%s starts the fix for the request", (m) => {
        expect(readSelffixMove(m, { stateDir: "/x", now: NOW, items: [], build: { request } })).toMatchObject({ kind: "fix", target: request });
    });
    it("without an open offer a bare yes is nothing", () => {
        expect(readSelffixMove("yes", { stateDir: "/x", now: NOW, items: [] })).toBeUndefined();
    });
    it("the diagnosis is made from the request, and a recent unrelated fix project is not reused", async () => {
        const calls = [];
        const run = async (script, args) => {
            calls.push([script, ...args]);
            if (script === "orion-selffix" && args[0] === "list")
                return { stdout: JSON.stringify({ items: [{ id: "sf-old", status: "started", startedAt: new Date(NOW.getTime() - 3600_000).toISOString(), title: "old" }] }), code: 0 };
            if (script === "orion-selfcheck")
                return { stdout: JSON.stringify({ diagnosis: { signature: "s", title: "t", failingExample: { message: request }, files: ["a"], fixable: true } }), code: 0 };
            if (args[0] === "propose")
                return { stdout: JSON.stringify({ status: "offered", item: { id: "sf-new", status: "offered", title: "close apps" } }), code: 0 };
            return { stdout: JSON.stringify({ status: "started" }), code: 0 };
        };
        const out = await runSelffixMove({ kind: "fix", about: "yes", target: request }, run, NOW);
        expect(calls.find((c) => c[0] === "orion-selfcheck")).toContain(request);
        expect(calls.some((c) => c.join(" ").includes("sf-old"))).toBe(false);
        expect(out.text).toMatch(/started a fix project/);
    });
});
describe("variants", () => {
    it("never the same twice in a row for a key", () => {
        resetVariants();
        const seen = Array.from({ length: 12 }, () => pickVariant("k", "same seed", ["a", "b", "c"]));
        for (let i = 1; i < seen.length; i++)
            expect(seen[i]).not.toBe(seen[i - 1]);
    });
    it("reasons parse from today's lines", () => {
        expect(parseReason("NOTHING WAS CHANGED: Gym has already started (it is 19:57); only a later one can be moved").kind).toBe("started");
        expect(parseReason("usage: orion-reschedule add").kind).toBe("unknown");
    });
});
function route(decision) {
    const handlers = new Map();
    const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "w20-")), "r.jsonl"), decideImpl: async () => decision, clock: () => "Wed 20:00",
        scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }), brainSearch: async () => "", readDay: async () => "" });
    const fire = async (n, e, c) => { const o = []; for (const fn of handlers.get(n) ?? [])
        o.push(await fn(e, c)); return o; };
    return { fire };
}
const turnMessages = (text) => [{ role: "user", content: "x" }, { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" }];
describe("on the route", () => {
    it("E14/E16 'Try again' / 'anyways': the model's true 'nothing changed' reply goes out untouched", async () => {
        for (const [i, said] of ["Add marketing museum anyways don't worry if it already passed", "Try again"].entries()) {
            const { fire } = route({ move: "escalate" });
            const ctx = { runId: `e${i}`, sessionKey: "agent:main:orion-chat-9" };
            await fire("before_model_resolve", { prompt: said }, ctx);
            const reply = "Nothing changed. Marketing Myseum at 7:00 PM is already running. I can't add it now.";
            const messages = turnMessages(reply);
            const out = (await fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: reply, messages }, ctx));
            expect(out[0]?.action).not.toBe("revise");
            expect(messages[1].content[0].text).toBe(reply);
        }
    });
    it("E18 'Not now' after a claim with no tool: replaced by what happened and an offer, never 'say it again'", async () => {
        const { fire } = route({ move: "answer", answer: "Okay." });
        const ctx = { runId: "e18", sessionKey: "agent:main:orion-chat-9" };
        await fire("before_model_resolve", { prompt: "Not now" }, ctx);
        const lie = "Got it. I've logged that you're not doing gym now.";
        const messages = [];
        for (let k = 0; k < 3; k++) {
            messages.push({ role: "user", content: "x" }, { role: "assistant", content: [{ type: "text", text: lie }], stopReason: "stop" });
            await fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: lie, messages: messages.slice() }, ctx);
        }
        const final = messages.at(-1).content[0].text;
        expect(final).not.toBe(lie);
        expect(final).not.toMatch(NEVER);
        expect(final).toMatch(/\?$/);
    });
    it("M1: a refusal that tells him to restart the app becomes the capability line with the build offer", async () => {
        const { fire } = route({ move: "escalate" });
        const ctx = { runId: "m1", sessionKey: "agent:main:orion-app-v2" };
        const ask = "re-open it one more time please, the \"desktop ->\" isnt working";
        await fire("before_model_resolve", { prompt: ask }, ctx);
        const reply = "I can't reopen a specific app or fix a desktop shortcut issue with the tools I have. Try restarting the app or checking the desktop shortcut settings directly.";
        const messages = turnMessages(reply);
        await fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: reply, messages }, ctx);
        const final = messages[1].content[0].text;
        expect(final).toMatch(BUILD_OFFER);
        expect(final).not.toMatch(/restart/);
        // and his "yes" next turn is read as the build request, with the original ask attached
        await fire("before_model_resolve", { prompt: "yes" }, { ...ctx, runId: "m1b" });
    });
});
