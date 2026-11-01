// Wave 8 B: an ORION-owned block (gym, side project, study, nap) he asks to move that is not on the calendar is booked at the
// time he named, and he is told it was added. Without an explicit target the honest "not on your calendar" stays. Plus the false
// claim "gym is bumped to T" with no calendar write behind it (per-legit-vs-excuse-c) is never sent.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readGymSkip } from "./anchor-guards.js";
import { registerLocalRouting } from "./local-routing.js";
import { finalizeReply } from "./reply-sanitize.js";
import { runScheduleFlow } from "./schedule-flow.js";
import { readStatedMove } from "./stated-move.js";
const NOW = new Date(2030, 9, 21, 8, 0);
const CLASS = { title: "CS1802 Seminar — Lecture", start: "13:00", end: "14:30", fixed: true, kind: "class" };
const SIDE = { title: "side project", start: "19:30", end: "20:30", fixed: false, kind: "side_project" };
const sparse = (blocks = []) => ({ date: "2030-10-21", now: "08:00", plan: { commuteMinutes: 0, bufferMinutes: 5, anchors: [{ title: "Gym", minutes: 90 }] }, blocks });
const busy = sparse([CLASS, SIDE]);
async function flow(message, day) {
    const writes = [];
    const result = await runScheduleFlow({ message, clock: "Mon 08:00", now: NOW, ask: async () => { throw new Error("the form must not be asked"); },
        exec: async (a) => { if (a[0] !== "show")
            writes.push(a); return { stdout: a[0] === "show" ? JSON.stringify(day) : "Changed Monday 2030-10-21:\n  added Gym 10:35–12:05", code: 0 }; } });
    return { result, writes };
}
describe("a move of an owned block that is not on the calendar, with an explicit time, books it", () => {
    it.each([["sparse Sunday", sparse()], ["busy weekday", busy]])("gym to 10:35am today (%s)", async (_n, day) => {
        const { writes, result } = await flow("move gym to 10:35am today", day);
        expect(writes).toEqual([["add", "Gym", "90", "--at", "10:35"]]);
        expect(result).toMatchObject({ outcome: "done" });
        expect(result.reply).toMatch(/Gym wasn't on today's calendar, so I added it/);
    });
    it.each([["push side project to 9pm", "21:00", "60"], ["move my nap to 3pm", "15:00", "30"], ["move study to 4pm", "16:00", "60"]])("%s", async (m, at, min) => {
        const { writes, result } = await flow(m, sparse());
        expect(writes[0]?.slice(2)).toEqual([min, "--at", at]);
        expect(result.reply).toMatch(/wasn't on today's calendar, so I added it/);
    });
    it("a class is never created by a move", async () => {
        const { writes, result } = await flow("move econ lecture to 3pm", sparse());
        expect(writes).toEqual([]);
        expect(result).toMatchObject({ outcome: "say" });
    });
    it("no explicit target time (from 7 to 8): the honest 'not on your calendar' stays", async () => {
        const { writes, result } = await flow("move gym from 7 to 8", sparse());
        expect(writes).toEqual([]);
        expect(result.text ?? "").toMatch(/no gym|not on|haven't/i);
    });
    it("an existing gym is moved, not added", async () => {
        const day = sparse([{ title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" }]);
        const { writes } = await flow("move gym to 6pm", day);
        expect(writes[0]?.[0]).toBe("move");
    });
});
describe("a statement that an owned block is moved is a request to move it (per-legit-vs-excuse-c)", () => {
    it.each([
        ["gym is bumped to 10:30am tonight because i have a deadline at 9:30am", { name: "gym", at: "10:30", day: "today" }],
        ["gyms moved to 7pm tmrw cuz of a lab", { name: "gym", at: "19:00", day: "tomorrow" }],
        ["fyi my gym got pushed to 8 tonight, work thing came up", { name: "gym", at: "20:00", day: "today" }],
        ["side project is shifted to 9:15pm", { name: "side project", at: "21:15", day: "today" }],
    ])("%s", (m, want) => { expect(readStatedMove(m)).toMatchObject({ kind: "stated", ...want }); });
    it.each(["is gym bumped to 6?", "should gym be moved to 7pm", "gym was moved to 6pm yesterday", "my class is moved to 3pm", "if gym is bumped to 8 ill be late", "move gym to 7"])("not a statement: %s", (m) => {
        expect(readStatedMove(m)).toBeNull();
        expect(readGymSkip(m)?.kind).not.toBe("stated");
    });
});
describe("routing: the statement books the move through the schedule flow, and says plainly when it could not", () => {
    const route = (flowFn) => {
        const handlers = new Map();
        const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
        const dir = mkdtempSync(join(tmpdir(), "stated-"));
        const flows = [];
        registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), clock: () => "Mon 08:00", now: () => NOW,
            decideImpl: async () => ({ move: "escalate" }), brainSearch: async () => "", readDayJson: async () => sparse(),
            scheduleFlow: async (m) => { flows.push(m); return flowFn(m); }, realityRun: async () => ({ stdout: "", code: 0 }) });
        const turn = async (prompt) => {
            const ctx = { runId: "s-1", sessionKey: "agent:main:orion-chat-x" };
            for (const fn of handlers.get("before_model_resolve") ?? [])
                await fn({ prompt }, ctx);
            let built;
            for (const fn of handlers.get("before_prompt_build") ?? [])
                built = (await fn({ prompt, messages: [] }, ctx)) ?? built;
            const exact = /Your whole reply must be exactly: ([\s\S]*)\]$/.exec(built?.appendContext ?? "")?.[1];
            return { exact, flows };
        };
        return { turn };
    };
    it("done: the reply is the flow's", async () => {
        const r = route(() => ({ outcome: "done", calls: ["exec orion-reschedule add Gym 90 --at 10:30"], outputs: ["Changed:\n  added Gym 10:30–12:00"], reply: "Done: Gym 10:30 AM–12:00 PM. Gym wasn't on today's calendar, so I added it." }));
        const t = await r.turn("gym is bumped to 10:30am tonight because i have a deadline at 9:30am");
        expect(t.flows).toEqual(["move gym to 10:30 AM today"]);
        expect(t.exact).toMatch(/Gym 10:30 AM–12:00 PM/);
    });
    it("not done: it says what did not happen, never the restatement", async () => {
        const r = route(() => ({ outcome: "say", kind: "plain", text: "10:30 AM has already passed (it's 11:00 AM), so I haven't booked gym." }));
        const t = await r.turn("gym is bumped to 10:30am tonight because i have a deadline at 9:30am");
        expect(t.exact).toMatch(/haven't booked gym/);
        expect(t.exact).not.toMatch(/is bumped to/);
    });
});
describe("reply truth check: an affirmative 'X is moved/bumped to T' with no write is never sent", () => {
    const none = [];
    it.each([
        "Gym is bumped to 10:30 AM tonight because of your 9:30 AM deadline.",
        "Your gym got pushed to 8 PM.",
        "Side project is shifted to 9 PM.",
        "Gym is moved to 7 PM.",
    ])("%s", (reply) => {
        const out = finalizeReply(reply, none, { changeRequest: false });
        expect(out).not.toBe(reply);
        expect(out).toMatch(/haven't changed|nothing (?:on your calendar )?(?:was )?changed/i);
    });
    it("stands when a write really happened", () => {
        const tools = [{ canonical: "exec orion-reschedule add Gym 90 --at 10:30", stdout: "Changed Monday:\n  added Gym 10:30–12:00", exit: 0 }];
        expect(finalizeReply("Gym is bumped to 10:30 AM.", tools, {})).toBe("Gym is bumped to 10:30 AM.");
    });
    it("stands for code-authored text, a question, a denial, and a plain read", () => {
        expect(finalizeReply("Gym is moved to 7 PM.", none, { codeAuthored: true })).toBe("Gym is moved to 7 PM.");
        expect(finalizeReply("Want gym bumped to 7 PM?", none, {})).toBe("Want gym bumped to 7 PM?");
        expect(finalizeReply("Gym isn't moved to 7 PM, nothing changed.", none, {})).toBe("Gym isn't moved to 7 PM, nothing changed.");
        expect(finalizeReply("Gym is at 7 PM today.", none, {})).toBe("Gym is at 7 PM today.");
    });
});
