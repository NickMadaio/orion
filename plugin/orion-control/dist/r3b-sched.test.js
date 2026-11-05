// w20 r3b sched: live gate run 2 scheduling FAILs, in his words. Reader (pure), runner (fake scripts over a fake day), spoken line, and the chat route.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readDayEdit } from "./day-edit.js";
import { runDayEdit } from "./day-edit-run.js";
import { forgetEdit } from "./day-edit-memory.js";
import { readLedgerAsk } from "./ledger-ask.js";
import { splitLeadListItem } from "./chat-asks.js";
import { registerLocalRouting } from "./local-routing.js";
import { runScheduleFlow, spokenReply } from "./schedule-flow.js";
const NOW = new Date(2026, 10, 5, 10, 0); // Thu 5 Nov, 10:00 AM
const parts = (m) => readDayEdit(m, NOW)?.parts ?? [];
const B = (title, start, end, extra = {}) => ({ title, start, end, kind: "other", fixed: false, ...extra });
const day = (blocks) => ({ date: "2026-11-05", now: "10:00", blocks });
const DAY = day([B("CS1800 Lecture", "11:00", "12:30", { kind: "class", fixed: true }), B("practice leetcode", "14:00", "15:00"), B("Go over Orion learning plan", "15:05", "16:05"), B("Phone call with mum", "13:30", "14:10", { fixed: true, made: true })]);
function fakeRun(d = DAY, reply) {
    const calls = [];
    const run = async (script, args) => { calls.push([script, ...args]); return reply?.(script, args) ?? { stdout: "Changed Thursday 2026-11-05:\n  done\nWritten to his calendar.", code: 0 }; };
    return { calls, deps: { run, readDay: async () => d, readDayOn: async () => d, now: NOW, source: "chat", text: "", stateDir: undefined } };
}
beforeEach(() => forgetEdit());
describe("#1 two moves in one message: the second ask is not dropped", () => {
    it.each([
        ["shift leetcode to 3pm and bump the orion plan an hour later", ["move", "shift"]],
        ["move gym to 5 and bump dinner an hour later", ["move", "shift"]],
        ["push study to 4 and nudge the walk half an hour back", ["move", "shift"]],
        ["move reading to 7pm and push gym back an hour", ["move", "shift"]],
        ["put lunch at 1 and bump the call half an hour later", ["add", "shift"]],
        ["move gym to 6 and then bump dinner 45 mins later", ["move", "shift"]],
    ])("%s", (say, ops) => expect(parts(say).map((p) => p.op)).toEqual(ops));
    it("keeps 'orion' when it is part of a block's name", () => {
        expect(parts("bump the orion plan an hour later")[0]).toMatchObject({ op: "shift", name: "orion plan", minutes: 60 });
        expect(parts("orion move gym to 5")[0]).toMatchObject({ op: "move", name: "gym" });
    });
    it("runs both against the day", async () => {
        const { calls, deps } = fakeRun();
        await runDayEdit(readDayEdit("shift leetcode to 3pm and bump the orion plan an hour later", NOW), deps);
        expect(calls.map((c) => c[1])).toEqual(["move", "move"]);
        expect(calls.flat()).toContain("Go over Orion learning plan");
    });
});
describe("#12 put it back to its normal slot is the ledger's undo, not a proposal", () => {
    it.each([
        "actually put leetcode back to its normal slot",
        "put leetcode back in its usual spot",
        "put the gym back to its regular time pls",
        "move study back to its proper place",
        "put dinner back to where it normally goes",
    ])("%s", (say) => expect(readLedgerAsk(say)).toMatchObject({ verb: "undo", strong: true }));
    it("a pick that is where the block already is is said, never offered", async () => {
        const d = day([B("practice leetcode", "14:00", "15:00")]);
        const out = await runScheduleFlow({ message: "put leetcode back to its normal slot", clock: "Thu 10:00", now: NOW, exec: async () => ({ stdout: JSON.stringify(d), code: 0 }),
            ask: async () => ({ steps: [{ do: "move", what: "B1", to: "14:00" }] }) });
        expect(out.outcome === "say" && out.text).not.toMatch(/Go ahead/);
    });
});
describe("#54 #101 a plan with people is booked 'added (fixed)': every add is in the reply, never 'nothing changed'", () => {
    const out = (t, a, b) => `Changed Thursday 2026-11-05:\n  rebuilt the remaining day from fixed commitments and must-haves first\n  added (fixed) ${t}: ${a}–${b}\nWritten to his calendar. "orion-reschedule undo" puts it back.`;
    it("one fixed add", () => expect(spokenReply([out("phone call with mum", "13:30", "14:10")])).toBe("Done: phone call with mum 1:30 PM–2:10 PM."));
    it("a planned and a fixed add are both said", () => {
        const text = spokenReply(["Changed Thursday:\n  planned haircut: 15:00–15:30\nWritten to his calendar.", out("call with nan", "17:00", "17:30")]);
        expect(text).toContain("haircut 3:00 PM–3:30 PM");
        expect(text).toContain("call with nan 5:00 PM–5:30 PM");
    });
});
describe("#101 two adds in his words are both run and both said", () => {
    it("reads two adds, the second with no verb of its own", () => {
        expect(parts("add a haircut at 3 and a call with nan at 5pm today").map((p) => p.op === "add" && p.name)).toEqual(["haircut", "call with nan"]);
        expect(parts("book a dentist at 11 and a call with dad at 4pm").map((p) => p.op === "add" && p.name)).toEqual(["dentist", "call with dad"]);
        expect(parts("put a walk at 5 and a chat with jess at 6pm").map((p) => p.op === "add" && p.name)).toEqual(["walk", "chat with jess"]);
    });
    it("the line says both", async () => {
        const { deps } = fakeRun(day([]));
        const out = await runDayEdit(readDayEdit("add a haircut at 3 and a call with nan at 5pm today", NOW), deps);
        expect("reply" in out.flow && out.flow.reply).toMatch(/haircut.*call with nan/);
    });
});
describe("#56 #57 #60 a block that is already on the day is moved, never added a second time", () => {
    it.each([
        "ok just put the call with mum at 5 then",
        "put the mum call at 5 pm",
        "move the call with mum to 5",
    ])("%s", async (say) => {
        const { calls, deps } = fakeRun();
        await runDayEdit(readDayEdit(say, NOW), deps);
        expect(calls.every((c) => c[1] === "move")).toBe(true);
        expect(calls[0]).toEqual(["orion-reschedule", "move", "Phone call with mum", "--to", "17:00", "--named"]);
    });
    it("'move the orion learning plan back to 12:25' names the block, not 'learning plan back'", async () => {
        expect(parts("move the orion learning plan back to 12:25")[0]).toMatchObject({ op: "move", name: "orion learning plan" });
        const { calls, deps } = fakeRun(day([B("practice leetcode", "11:20", "12:20"), B("Go over Orion learning plan", "15:00", "16:00")]));
        await runDayEdit(readDayEdit("move the orion learning plan back to 12:25", NOW), deps);
        expect(calls[0]).toEqual(["orion-reschedule", "move", "Go over Orion learning plan", "--to", "12:25"]);
    });
    it("make the mum call 45 mins and move it to quarter past 6: a resize and a move of the same block", async () => {
        expect(parts("make the mum call 45 mins and move it to quarter past 6").map((p) => p.op)).toEqual(["resize", "move"]);
        const { calls, deps } = fakeRun();
        const out = await runDayEdit(readDayEdit("make the mum call 45 mins and move it to quarter past 6", NOW), deps);
        expect(calls.map((c) => c[1])).toEqual(["move", "move"]);
        expect(calls[0]).toContain("--until");
        expect(out.writes).toBe(2);
    });
    it("a name that is not on the day is still added", async () => {
        const { calls, deps } = fakeRun();
        await runDayEdit(readDayEdit("put a haircut at 3", NOW), deps);
        expect(calls[0].slice(0, 3)).toEqual(["orion-reschedule", "add", "Haircut"]);
    });
});
describe("#103 a haircut is half an hour, also when it has to be put back after the block was cleared", () => {
    it("i actually did the haircut at 2 not 3 hmm", async () => {
        const { calls, deps } = fakeRun(day([]));
        await runDayEdit(readDayEdit("i actually did the haircut at 2 not 3 hmm", new Date(2026, 10, 5, 16, 0)), { ...deps, now: new Date(2026, 10, 5, 16, 0) });
        expect(calls[0]).toEqual(["orion-reschedule", "log", "Haircut", "--from", "14:00", "--to", "14:30"]);
    });
});
describe("#66 taking off a plan with people the scheduler will not drop: skip, and no script text in the line", () => {
    it("scrap the pasta prep with ben", async () => {
        const refuse = "NOTHING WAS DROPPED on Thursday: no movable block matches (a class or a plan with people? he is not going: use skip \"<it>\") \"Pasta prep with ben\". Movable blocks today: practice leetcode.";
        const d = day([B("Pasta prep with ben", "18:00", "19:00", { fixed: true })]);
        const { calls, deps } = fakeRun(d, (_s, a) => (a[0] === "drop" ? { stdout: refuse, code: 1 } : undefined));
        const out = await runDayEdit(readDayEdit("scrap the pasta prep with ben", NOW), deps);
        expect(calls.map((c) => c[1])).toEqual(["drop", "skip"]);
        const reply = "reply" in out.flow ? out.flow.reply ?? "" : "text" in out.flow ? out.flow.text : "";
        expect(reply).not.toMatch(/use skip|Movable blocks|no movable|he is not going/);
    });
    it("when even skip is refused, the line carries no script text", async () => {
        const d = day([B("Pasta prep with ben", "18:00", "19:00", { fixed: true })]);
        const { deps } = fakeRun(d, () => ({ stdout: "NOTHING WAS DROPPED on Thursday: no movable block matches (a class or a plan with people? he is not going: use skip \"<it>\") \"Pasta prep with ben\". Movable blocks today: none.", code: 1 }));
        const out = await runDayEdit(readDayEdit("scrap the pasta prep with ben", NOW), deps);
        const reply = "reply" in out.flow ? out.flow.reply ?? "" : "text" in out.flow ? out.flow.text : "";
        expect(reply).not.toMatch(/use skip|Movable blocks|\"<it>\"|\(a class or a plan with people\?/);
    });
});
describe("#107 a list item and a question in one message: both answered", () => {
    it.each([
        ["and a list item: pick up parcel from reception, then tell me whats on tomorrow evening", "pick up parcel from reception"],
        ["add buy stamps to my list, then whats on tomorrow evening", "buy stamps"],
        ["a todo item: ring the dentist and then tell me am i free saturday morning", "ring the dentist"],
    ])("%s", (say, item) => expect(splitLeadListItem(say)).toMatchObject({ item }));
    it("a message with no list item is not split", () => expect(splitLeadListItem("tell me whats on tomorrow evening")).toBeNull());
});
function route(day0 = DAY) {
    const handlers = new Map();
    const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    const fire = async (n, e, c) => { const o = []; for (const fn of handlers.get(n) ?? [])
        o.push(await fn(e, c)); return o; };
    const dir = mkdtempSync(join(tmpdir(), "r3b-"));
    writeFileSync(join(dir, "health-log.json"), JSON.stringify({ schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [] }));
    const calls = [];
    const tasks = [];
    let current = day0;
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), stateDir: dir, clock: () => "Thu 10:00", now: () => NOW,
        decideImpl: async () => ({ move: "escalate" }), brainSearch: async () => "",
        scheduleFlow: async (m, _c, o) => {
            if (o?.edit) {
                calls.push(["flow-edit", o.edit.target.title, String(o.edit.req.minutes)]);
                return { outcome: "done", calls: [`exec orion-reschedule resize "${o.edit.target.title}" ${o.edit.req.minutes}`], outputs: [""] };
            }
            calls.push(["flow", m, o?.lastTarget?.title ?? ""]);
            return { outcome: "fallback", reason: "test" };
        },
        readDayJson: async () => current, readDay: async () => JSON.stringify(current),
        realityRun: async (s, a) => {
            calls.push([s, ...a]);
            if (a[0] === "add")
                current = { ...current, blocks: [...current.blocks, B(a[1], a[a.indexOf("--at") + 1], "99:99")] };
            return { stdout: `Changed Thursday\n  planned ${a[1]}: 16:00–16:30\nWritten to his calendar.`, code: 0 };
        },
        chatRun: { open: async () => ({ stdout: "", code: 0 }), installed: async () => true, tasks: async (a) => { tasks.push(a); return { stdout: `Added ${a[1]}`, code: 0 }; } } });
    let n = 0;
    const turn = async (prompt) => {
        const ctx = { runId: `r3b-${n += 1}`, sessionKey: "agent:main:orion-app-v2" };
        await fire("before_model_resolve", { prompt }, ctx);
        const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx));
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        return direct?.reply?.text ?? /Your whole reply must be exactly: ([\s\S]*)\]$/.exec(built?.appendContext ?? "")?.[1];
    };
    return { turn, calls, tasks };
}
describe("chat route", () => {
    it("#74 'make it 45 mins' right after one add is that block", async () => {
        const r = route(day([]));
        await r.turn("put a call with jess in at 4pm for half an hour");
        const text = await r.turn("actually make it 45 mins");
        expect(text ?? "").not.toMatch(/which one/i);
        expect(r.calls).toContainEqual(["flow-edit", "Call with jess", "45"]);
    });
    it("#75 'and shift it to 4:30' is a move of that block, never a block called 'Shift it'", async () => {
        const r = route(day([]));
        await r.turn("put a call with jess in at 4pm for half an hour");
        await r.turn("and shift it to 4:30");
        expect(r.calls.some((c) => c[0] === "orion-reschedule" && c.includes("Shift it"))).toBe(false);
        expect(r.calls).toContainEqual(["flow", "and shift it to 4:30", "Call with jess"]);
    });
    it("#107 the list item is added and the evening is answered", async () => {
        const r = route(day([]));
        const text = await r.turn("and a list item: pick up parcel from reception, then tell me whats on tomorrow evening");
        expect(r.tasks).toEqual([["add", "Pick up parcel from reception"]]);
        expect(text).toMatch(/pick up parcel from reception/i);
        expect(text).toMatch(/tomorrow evening/i);
    });
});
