import { describe, expect, it } from "vitest";
import { readLedgerAsk } from "./ledger-ask.js";
import { runLedgerAsk } from "./ledger-run.js";
import { MadeLedger, madeBy } from "./made-ledger.js";
const NOW = new Date(2030, 9, 8, 15, 0).getTime();
const iso = (h, m = 0) => new Date(2030, 9, 8, h, m).toISOString();
const day = (blocks) => ({ date: "2030-10-08", now: "15:00", blocks: blocks.map(([title, start, end, made]) => ({ title, start, end, fixed: false, ...(made ? { made } : {}) })) });
function deps(over = {}) {
    const { reminders: seeded, days: seededDays, scripts, ...rest } = over;
    const calls = [];
    const store = [...(seeded ?? [])];
    const days = [...(seededDays ?? [day([])])];
    const d = {
        run: async (script, args) => { calls.push([script, args]); return { stdout: scripts?.[`${script} ${args[0]}`] ?? "", code: 0 }; },
        readDay: async () => days.length > 1 ? days.shift() : days[0],
        items: [], journal: () => [], now: NOW, nothingText: "NOTHING", reminders: { list: async () => [...store], remove: async (ids) => { for (const id of ids)
                store.splice(store.findIndex((r) => r.id === id), 1); } },
        ...rest,
    };
    return { d, calls, store };
}
const rem = (id, label) => ({ id, label, dueAt: NOW + 3600_000 });
describe("reader", () => {
    it.each(["undo", "undo that last move", "ok undo", "revert that", "undo it pls"])("%s is a strong bare undo", (m) => {
        const a = readLedgerAsk(m);
        expect(a.bare).toBe(true);
        expect(a.strong).toBe(true);
    });
    it.each(["put the learning plan back where it was", "put the gym back to how it was", "set study back as it was"])("%s is a put-back", (m) => {
        const a = readLedgerAsk(m);
        expect(a.verb).toBe("undo");
        expect(a.targets.length).toBe(1);
    });
    it.each(["scrap the gym block i just added", "delete that note i just made", "get rid of the reminder i just set", "remove that water i logged", "nuke the thing i just added"])("%s points at a made thing", (m) => {
        const a = readLedgerAsk(m);
        expect(a.verb).toBe("remove");
        expect(a.strong).toBe(true);
    });
    it("splits two reminders", () => { expect(readLedgerAsk("cancel the stretch one and the careers one").targets).toEqual([["stretch"], ["career"]]); });
    it("reads dont need it anymore", () => { expect(readLedgerAsk("dont need the stretch reminder anymore").kinds).toEqual(["reminder"]); });
    it("reads the food tail", () => { const a = readLedgerAsk("take the big mac back off, i didnt have it"); expect(a.kinds).toContain("food"); expect(a.targets[0]).toEqual(["big", "mac"]); });
    it("a weak block removal is weak", () => { expect(readLedgerAsk("take the call with mum off my day").strong).toBe(false); });
    it.each(["whats on today", "move gym to 7", "undo, i meant add those"])("%s is not a ledger ask", (m) => { expect(readLedgerAsk(m)?.strong ?? false).toBe(false); });
});
describe("ledger", () => {
    it("reads what tools made, never what was said", () => {
        expect(madeBy({ canonical: 'exec orion-reschedule add "Call with mum" 40 --at 17:00', stdout: "Changed Tuesday" }, 1)[0]).toMatchObject({ kind: "block", label: "Call with mum" });
        expect(madeBy({ canonical: "exec orion-reschedule add Gym 60 --at 05:30", stdout: "NOTHING WAS CHANGED: x" }, 1)).toEqual([]);
        expect(madeBy({ canonical: 'exec orion-brain learn "Nick" "note" <his full text>', stdout: 'Added to "Nick": went through the plan' }, 1)[0]).toMatchObject({ kind: "note", label: "went through the plan" });
        expect(madeBy({ canonical: "exec orion-log water 3", stdout: "Logged 3 bottles: 9 of 9 today." }, 1)[0]).toMatchObject({ kind: "water", count: 3 });
        expect(madeBy({ canonical: 'tool_call {"id":"x","args":{"steps":[{"action":"alarm_set","at":"2026-11-05T16:00","label":"stretch"}]}}', stdout: "ok" }, 1)[0]).toMatchObject({ kind: "reminder", label: "stretch" });
    });
    it("a chat only sees its own, and entries expire", () => {
        const l = new MadeLedger();
        l.record("a", { kind: "note", label: "x", at: NOW });
        expect(l.recent("a", NOW + 1000).length).toBe(1);
        expect(l.recent("b", NOW)).toEqual([]);
        expect(l.recent("a", NOW + 4 * 3600_000)).toEqual([]);
    });
});
describe("undo reads the calendar back", () => {
    const journal = [{ at: new Date(NOW - 60_000).toISOString(), steps: [{ op: "move", title: "Go over Orion learning plan", start: iso(12, 25), end: iso(13, 25) }] }];
    it("states the times the calendar shows, not the model's", async () => {
        const { d, calls } = deps({ journal: () => journal, calendar: { since: NOW - 600_000, last: NOW - 60_000 }, days: [day([["Go over Orion learning plan", "12:25", "13:25"]])] });
        const out = (await runLedgerAsk(readLedgerAsk("undo"), d));
        expect(calls[0]).toEqual(["orion-reschedule", ["undo"]]);
        expect(out.text).toBe("Go over Orion learning plan is back at 12:25 PM–1:25 PM.");
        expect(out.wroteCalendar).toBe(true);
    });
    it("never claims a restore the calendar does not show", async () => {
        const lecture = [{ at: new Date(NOW - 1000).toISOString(), steps: [{ op: "delete", title: "CS1800 Lecture", start: iso(9), end: iso(10, 30) }] }];
        const { d } = deps({ journal: () => lecture, calendar: { since: NOW - 600_000, last: NOW - 1000 }, days: [day([])] });
        expect((await runLedgerAsk(readLedgerAsk("undo"), d)).text).toMatch(/can't see it on your calendar/);
    });
    it("a day-old journal entry is not this chat's: nothing to undo, and undo never runs", async () => {
        const old = [{ at: new Date(NOW - 20 * 3600_000).toISOString(), steps: [{ op: "move", title: "Gym", start: iso(9), end: iso(10) }] }];
        const { d, calls } = deps({ journal: () => old, calendar: { since: NOW - 600_000, last: NOW - 300_000 } });
        expect((await runLedgerAsk(readLedgerAsk("undo"), d)).text).toBe("NOTHING");
        expect(calls).toEqual([]);
    });
    it("no changes in this chat at all: nothing to undo", async () => {
        const { d, calls } = deps({ journal: () => journal });
        expect((await runLedgerAsk(readLedgerAsk("undo"), d)).text).toBe("NOTHING");
        expect(calls).toEqual([]);
    });
    it("put X back where it was runs the undo only when the last change was X", async () => {
        const mk = () => deps({ journal: () => journal, calendar: { since: NOW - 600_000, last: NOW - 60_000 }, days: [day([["Go over Orion learning plan", "12:25", "13:25"]])] });
        const yes = mk();
        expect((await runLedgerAsk(readLedgerAsk("put the learning plan back where it was"), yes.d)).text).toMatch(/back at 12:25 PM/);
        const no = mk();
        const out = (await runLedgerAsk(readLedgerAsk("put the gym back where it was"), no.d));
        expect(out.text).toMatch(/last thing I changed was Go over Orion learning plan/);
        expect(no.calls).toEqual([]);
    });
});
describe("removal by description", () => {
    it("scrap the gym block i just added drops the block from the ledger and reads the day back", async () => {
        const { d, calls } = deps({ items: [{ kind: "block", label: "Gym", at: NOW - 1000 }], days: [day([])] });
        const out = (await runLedgerAsk(readLedgerAsk("scrap the gym block i just added"), d));
        expect(calls[0]).toEqual(["orion-reschedule", ["drop", "Gym"]]);
        expect(out.text).toMatch(/Gym is off your day/);
        expect(out.removed.length).toBe(1);
    });
    it("says so when the block is still there", async () => {
        const { d } = deps({ items: [{ kind: "block", label: "Gym", at: NOW }], days: [day([["Gym", "17:00", "18:00"]])] });
        expect((await runLedgerAsk(readLedgerAsk("scrap the gym block i just added"), d)).text).toMatch(/still on your calendar/);
    });
    it("take the call with mum off my day removes a block ORION made even from an earlier chat", async () => {
        const { d, calls } = deps({ days: [day([["Call with mum", "17:00", "17:40", true]]), day([])] });
        const out = (await runLedgerAsk(readLedgerAsk("take the call with mum off my day"), d));
        expect(calls[0]).toEqual(["orion-reschedule", ["drop", "Call with mum"]]);
        expect(out.text).toMatch(/Call with mum is off your day/);
    });
    it("his own event of the same name is not claimed by a weak ask", async () => {
        const { d, calls } = deps({ days: [day([["Call with mum", "17:00", "17:40"]])] });
        expect(await runLedgerAsk(readLedgerAsk("get rid of the mum call"), d)).toBeUndefined();
        expect(calls).toEqual([]);
    });
    it("delete that note i just made removes the note, not the schedule", async () => {
        const { d, calls } = deps({ items: [{ kind: "note", label: "went through the orion learning plan and it took longer", at: NOW - 5000 }],
            scripts: { "orion-brain forget": '{"query":"q","matches":[{"id":"abc1234567","text":"went through the orion learning plan and it took longer"}]}' } });
        const second = d.run;
        let n = 0;
        d.run = async (s, a) => { n += 1; if (n === 2) {
            calls.push([s, a]);
            return { stdout: '{"archived":[{"id":"abc1234567"}],"missing":[]}', code: 0 };
        } return second(s, a); };
        const out = (await runLedgerAsk(readLedgerAsk("actually delete that note i just made"), d));
        expect(out.text).toMatch(/^Removed the note/);
        expect(calls.every(([s]) => s === "orion-brain")).toBe(true);
    });
    it("cancel the stretch one and the careers one cancels both stored reminders and confirms", async () => {
        const { d, store } = deps({ reminders: [rem("a1", "stretch"), rem("b2", "email the careers service"), rem("c3", "call dad")] });
        const out = (await runLedgerAsk(readLedgerAsk("cancel the stretch one and the careers one"), d));
        expect(store.map((r) => r.id)).toEqual(["c3"]);
        expect(out.text).toMatch(/Cancelled the reminder: stretch\. Cancelled the reminder: email the careers service\./);
    });
    it("dont need the stretch reminder anymore cancels it", async () => {
        const { d, store } = deps({ reminders: [rem("a1", "stretch")] });
        expect((await runLedgerAsk(readLedgerAsk("dont need the stretch reminder anymore"), d)).text).toMatch(/Cancelled the reminder: stretch/);
        expect(store).toEqual([]);
    });
    it("take the big mac back off removes the logged food", async () => {
        const { d, calls } = deps({ items: [{ kind: "food", label: "Big Mac", at: NOW - 1000 }], scripts: { "orion-log food-off": "Took Big Mac off (770 kcal): 570 kcal today." } });
        const out = (await runLedgerAsk(readLedgerAsk("take the big mac back off, i didnt have it"), d));
        expect(calls[0]).toEqual(["orion-log", ["food-off", "big", "mac"]]);
        expect(out.text).toMatch(/Took Big Mac off/);
    });
    it("a strong ask that matches nothing says nothing changed", async () => {
        const { d, calls } = deps();
        expect((await runLedgerAsk(readLedgerAsk("delete that note i just made"), d)).text).toMatch(/nothing changed/);
        expect(calls).toEqual([]);
    });
});
