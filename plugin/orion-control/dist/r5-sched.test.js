// w20 r5 sched: live gate run 3 scheduling FAILs, in his words. Reader, runner over a stateful fake day, ledger undo-all, the exec preflight and the reply sanitizer.
import { describe, expect, it, beforeEach } from "vitest";
import { readDayEdit } from "./day-edit.js";
import { runDayEdit } from "./day-edit-run.js";
import { forgetEdit } from "./day-edit-memory.js";
import { readLedgerAsk } from "./ledger-ask.js";
import { runLedgerAsk } from "./ledger-run.js";
import { refusalOf, schedulerArgs } from "./scheduler-preflight.js";
import { finalizeReply } from "./reply-sanitize.js";
import { runScheduleFlow } from "./schedule-flow.js";
const NOW = new Date(2026, 10, 5, 5, 24);
const parts = (m, now = NOW) => readDayEdit(m, now)?.parts ?? [];
const B = (title, start, end, extra = {}) => ({ title, start, end, kind: "other", fixed: false, ...extra });
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const hm = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
/** A fake scheduler whose day changes when a move runs, so a later clause reads where the earlier one left things. */
function live(blocks, now = NOW) {
    const day = { date: "2026-11-05", now: hm(now.getHours() * 60 + now.getMinutes()), blocks: [...blocks] };
    const calls = [];
    const run = async (script, args) => {
        calls.push([script, ...args]);
        if (args[0] === "move") {
            const t = args[1];
            const to = toMin(args[args.indexOf("--to") + 1]);
            const b = day.blocks.find((x) => x.title === t);
            const len = toMin(b.end) - toMin(b.start);
            day.blocks = day.blocks.map((x) => (x === b ? { ...x, start: hm(to), end: hm(to + len) } : x));
        }
        return { stdout: "Changed Thursday 2026-11-05:\n  done\nWritten to his calendar.", code: 0 };
    };
    return { calls, deps: { run, readDay: async () => day, readDayOn: async () => day, now, source: "chat", text: "", stateDir: undefined }, day };
}
beforeEach(() => forgetEdit());
describe("#1 'shove the plan after that' is a second ask", () => {
    it.each([
        "push leetcode to 5pm and shove the orion plan an hour after that",
        "move gym to 6 and slide dinner right after it",
        "shift study to 4 and push the reading half an hour after that",
        "move leetcode to 5pm and shove the orion plan after that",
        "push the gym to 7 and shove dinner after it",
        "move reading to 3 and bump the walk 20 mins after that",
    ])("%s", (say) => expect(parts(say).map((p) => p.op)).toEqual(["move", "moveafter"]));
    it("the plan goes where leetcode now ends, an hour on", async () => {
        const { calls, deps } = live([B("practice leetcode", "11:20", "12:20"), B("Go over Orion learning plan", "12:25", "13:25")]);
        const out = await runDayEdit(readDayEdit("push leetcode to 5pm and shove the orion plan an hour after that", NOW), deps);
        expect(calls.filter((c) => c[1] === "move")).toEqual([["orion-reschedule", "move", "practice leetcode", "--to", "17:00"], ["orion-reschedule", "move", "Go over Orion learning plan", "--to", "19:00"]]);
        expect("reply" in out.flow && out.flow.reply).toMatch(/leetcode.*learning plan/);
    });
    it("'right after' is no gap", async () => {
        const { calls, deps } = live([B("Gym", "17:00", "18:00"), B("Dinner", "19:30", "20:00")]);
        await runDayEdit(readDayEdit("move gym to 6 and slide dinner right after it", NOW), deps);
        expect(calls.filter((c) => c[1] === "move")[1]).toEqual(["orion-reschedule", "move", "Dinner", "--to", "19:00"]);
    });
    it("'put reading after lunch' is still an add", () => expect(parts("put reading after lunch")[0]).toMatchObject({ op: "add" }));
});
describe("#2 'put it all back' is every change of this chat undone, newest first, read back", () => {
    it.each(["put it all back", "put everything back", "undo everything", "undo it all", "put it all back how it was", "revert all of that"])("%s", (say) => {
        expect(readLedgerAsk(say)).toMatchObject({ verb: "undo", strong: true, all: true });
    });
    it("is not a bare undo of one change", () => expect(readLedgerAsk("undo")?.all).toBeUndefined());
    it("runs undo for each journal entry and says what the calendar shows", async () => {
        const t = Date.now();
        const journal = [
            { at: new Date(t - 120_000).toISOString(), steps: [{ op: "move", title: "practice leetcode", start: new Date(2026, 10, 5, 11, 20).toISOString(), end: new Date(2026, 10, 5, 12, 20).toISOString() }] },
            { at: new Date(t - 60_000).toISOString(), steps: [{ op: "move", title: "Go over Orion learning plan", start: new Date(2026, 10, 5, 12, 25).toISOString(), end: new Date(2026, 10, 5, 13, 25).toISOString() }] },
        ];
        const calls = [];
        const day = { date: "2026-11-05", now: "05:24", blocks: [B("practice leetcode", "11:20", "12:20"), B("Go over Orion learning plan", "12:25", "13:25")] };
        const d = { run: async (s, a) => { calls.push([s, ...a]); if (a[0] === "undo")
                journal.pop(); return { stdout: "Undone: moved", code: 0 }; }, readDay: async () => day, items: [], journal: () => journal, now: t, nothingText: "NOTHING", calendar: { since: t - 600_000, last: t - 60_000 } };
        const out = (await runLedgerAsk(readLedgerAsk("put it all back"), d));
        expect(calls.filter((c) => c[1] === "undo")).toHaveLength(2);
        expect(calls.some((c) => c[1] === "tidy")).toBe(false);
        expect(out.text).toMatch(/Go over Orion learning plan is back at 12:25 PM/);
        expect(out.text).toMatch(/practice leetcode is back at 11:20 AM/);
    });
    it("nothing made in this chat: the plain nothing-to-undo line", async () => {
        const d = { run: async () => ({ stdout: "", code: 0 }), readDay: async () => undefined, items: [], journal: () => [], now: Date.now(), nothingText: "NOTHING" };
        expect((await runLedgerAsk(readLedgerAsk("put it all back"), d))?.text).toBe("NOTHING");
    });
});
describe("#36 #37 'after lunch' is understood, and an exec error never reaches him", () => {
    it.each([
        "pop a 40 min catch up call with dad in after lunch",
        "stick a 30 min call with mum in after lunch",
        "throw a 45 min walk in after dinner",
        "chuck a 20 min chat with jess in after lunch",
        "whack a 1 hour reading block in after lunch",
        "squeeze a 40 min call with nan in after lunch",
    ])("%s", (say) => {
        const p = parts(say, new Date(2026, 10, 5, 10, 0));
        expect(p).toHaveLength(1);
        expect(p[0]).toMatchObject({ op: "add", after: expect.stringMatching(/lunch|dinner/) });
    });
    it("the add lands after the day's lunch, or after a normal lunch when none is on it", async () => {
        const { calls, deps } = live([], new Date(2026, 10, 5, 10, 0));
        await runDayEdit(readDayEdit("pop a 40 min catch up call with dad in after lunch", new Date(2026, 10, 5, 10, 0)), deps);
        expect(calls[0].slice(0, 3)).toEqual(["orion-reschedule", "add", "Catch up call with dad"]);
        expect(calls[0]).toContain("40");
    });
    describe("global sanitizer: no exec error text in any reply", () => {
        const leaks = [
            "No lunch block is on Thursday.\n\n⚠️ 🛠️ Exec failed: `~/Desktop/ORION/scripts/orion-reschedule add \"Catch up call with dad\" 40 --after \"Lunch\"`",
            "Done. ⚠️ Exec failed: `orion-session pause`",
            "I couldn't find it. 🛠️ Exec failed: `~/Desktop/ORION/scripts/orion-tasks done \"milk\"`",
            "Nothing changed.\n⚠️ Exec failed: /Users/x/Desktop/ORION/scripts/orion-agenda today (exit 1)",
            "Sorted.\n\n⚠️ 🛠️ Exec failed: `node scripts/orion-wake 06:00`",
            "exec failed: `orion-log water 1`",
        ];
        it.each(leaks)("%s", (text) => {
            expect(finalizeReply(text, [])).not.toMatch(/exec failed/i);
            expect(finalizeReply(text, [], { spoken: true })).not.toMatch(/exec failed/i);
        });
    });
    describe("a worker write the scheduler would refuse never runs", () => {
        it("reads the scheduler's own command, quotes only", () => {
            expect(schedulerArgs("~/Desktop/ORION/scripts/orion-reschedule add \"Catch up call with dad\" 40 --after \"Lunch\"")).toEqual(["add", "Catch up call with dad", "40", "--after", "Lunch"]);
            expect(schedulerArgs("orion-reschedule add Gym 60 --dry-run")).toBeUndefined();
            expect(schedulerArgs("orion-reschedule show --json")).toBeUndefined();
            expect(schedulerArgs("orion-reschedule add Gym 60 && rm -rf x")).toBeUndefined();
            expect(schedulerArgs("cat x | orion-reschedule add Gym 60")).toBeUndefined();
        });
        it("a dry-run refusal is one plain sentence; success and crashes are not refusals", () => {
            expect(refusalOf("NOTHING WAS CHANGED: no \"Lunch\" on 2026-11-05 to put it after.", 2)).toBe("no \"Lunch\" on 2026-11-05 to put it after.");
            expect(refusalOf("Changed Thursday", 0)).toBeUndefined();
            expect(refusalOf("Segmentation fault", 139)).toBeUndefined();
        });
    });
});
describe("#47 #48 a plan with people ORION just booked can be resized and moved", () => {
    const day = () => ({ date: "2026-11-05", now: "10:00", blocks: [B("Call with jess", "16:00", "16:30", { fixed: true, made: true, id: "x1" })] });
    const exec = (calls) => async (args) => { calls.push(args); return args[0] === "show" ? { stdout: JSON.stringify(day()), code: 0 } : { stdout: "Changed Thursday:\n  Call with jess moved: 16:00 → 16:00–16:45\nWritten to his calendar.", code: 0 }; };
    it("make it 45 mins", async () => {
        const calls = [];
        const out = await runScheduleFlow({ message: "actually make it 45 mins", clock: "Thu 10:00", exec: exec(calls), ask: async () => null, edit: { target: { kind: "block", title: "Call with jess", dateArgs: [], start: "16:00", minutes: 30, at: 0 }, req: { minutes: 45 } } });
        expect(out.outcome).toBe("done");
        expect(calls.find((c) => c[0] === "move")).toEqual(["move", "Call with jess", "--to", "16:00", "--until", "16:45", "--named"]);
    });
    it("his own plan with people is still left alone", async () => {
        const calls = [];
        const out = await runScheduleFlow({ message: "make it 45 mins", clock: "Thu 10:00", exec: async (a) => (a[0] === "show" ? { stdout: JSON.stringify({ ...day(), blocks: [B("Dinner with ben", "19:00", "20:00", { fixed: true })] }), code: 0 } : { stdout: "", code: 0 }), ask: async () => null, edit: { target: { kind: "block", title: "Dinner with ben", dateArgs: [], start: "19:00", minutes: 60, at: 0 }, req: { minutes: 45 } } });
        expect(out.outcome).toBe("say");
        expect(calls).toEqual([]);
    });
    it("shift it to 4:30", async () => {
        const calls = [];
        const out = await runScheduleFlow({ message: "and shift it to 4:30", clock: "Thu 10:00", exec: exec(calls), ask: async () => null, lastTarget: { title: "Call with jess", start: "16:00", dateArgs: [] } });
        expect(out.outcome).toBe("done");
        expect(calls.find((c) => c[0] === "move")).toEqual(["move", "Call with jess", "--to", "16:30", "--named"]);
    });
});
describe("#57 two adds, each with its own time", () => {
    it.each([
        "stick a haircut in at 3 and a catch up with nan at 5 today",
        "pop a haircut in at 3 and a call with dad at 5pm",
        "throw a walk in at 4 and a chat with jess at 6",
        "chuck a dentist in at 11 and a catch up with mum at 4pm today",
        "add a haircut at 3 and a catch up with nan at 5 today",
        "put a haircut at 3 and a long catch up with nan at 5",
    ])("%s", (say) => {
        const p = parts(say, new Date(2026, 10, 5, 10, 0));
        expect(p.map((x) => x.op)).toEqual(["add", "add"]);
        expect(p.every((x) => x.op === "add" && !!x.at)).toBe(true);
    });
});
describe("#102 a past range is never end-before-start or ending now", () => {
    const at = new Date(2026, 10, 5, 5, 24);
    it("'2 till 4' said at 5:24 AM is yesterday 14:00-16:00", async () => {
        const { calls, deps } = live([B("Thing", "11:20", "12:20")], at);
        await runDayEdit(readDayEdit("i didnt go to the 11:20 thing, was in the library 2 till 4 instead", at), deps);
        const log = calls.find((c) => c[1] === "log");
        expect(log).toEqual(["orion-reschedule", "log", "Library", "--from", "14:00", "--to", "16:00", "--date", "yesterday"]);
    });
    it.each([
        ["i was at the library 2 till 4", "14:00", "16:00"],
        ["i was at the gym 5-6", "17:00", "18:00"],
        ["i was on the bus 3 to 4", "15:00", "16:00"],
        ["i did my reading 1 to 3", "13:00", "15:00"],
        ["i was at the pub 9-10", "21:00", "22:00"],
    ])("%s at 8:24 AM", async (say, from, to) => {
        const t = new Date(2026, 10, 5, 8, 24);
        const { calls, deps } = live([], t);
        await runDayEdit(readDayEdit(say, t), deps);
        const log = calls.find((c) => c[1] === "log");
        expect(log.slice(3, 7)).toEqual(["--from", from, "--to", to]);
        expect(log).toContain("yesterday");
    });
    it("a record that would end before it starts is never written", async () => {
        const { calls, deps } = live([], new Date(2026, 10, 5, 5, 24));
        const out = await runDayEdit({ parts: [{ op: "log", name: "library", day: "today", span: { a: { h: 2, m: 0, exact: true, ap: "p" }, b: { h: 4, m: 0, exact: true, ap: "p" } } }] }, { ...deps, now: at });
        expect(calls.filter((c) => c[1] === "log")).toHaveLength(1);
        expect(calls[0]).toContain("yesterday");
        expect(out.writes).toBe(1);
    });
});
