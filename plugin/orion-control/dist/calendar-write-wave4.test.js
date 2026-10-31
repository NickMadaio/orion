// Wave 4 calendar writes (gate run-1031202318, clusters 3 and 9): a block he names is resolved on the real day and written through the
// scheduler, the reply is read back from the calendar; the weekend / tomorrow is planned day by day. A small in-memory scheduler stands in
// for orion-reschedule so every reply is checked against what the "calendar" really holds afterwards.
import { describe, expect, it } from "vitest";
import { namesTitle, readNamedWrite, resolveNamed, runNamedWrite } from "./calendar-resolve.js";
import { firstFit, planDays, readMultiDay, runMultiDay } from "./calendar-days.js";
import { readDayRequest } from "./day-requests.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerLocalRouting } from "./local-routing.js";
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const hm = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const b = (title, start, end, kind, fixed = false) => ({ title, start, end, fixed, ...(kind ? { kind } : {}) });
/** orion-reschedule, in memory: add / extend / move --until / drop on per-date days, printing what the real one prints. */
function fakeScheduler(days, today, nowHm) {
    const calls = [];
    const dateOf = (args) => { const i = args.indexOf("--date"); const d = i >= 0 ? args[i + 1] : today; return d === "tomorrow" ? Object.keys(days).sort().find((k) => k > today) : d; };
    const flag = (args, f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
    const run = async (_script, args) => {
        calls.push(args);
        const date = dateOf(args);
        const list = days[date] ?? (days[date] = []);
        const find = (t) => list.find((x) => x.title === t);
        const [cmd, title] = args;
        if (cmd === "add") {
            const at = toMin(flag(args, "--at"));
            const n = Number(args[2]);
            if (date === today && at < toMin(nowHm))
                return { stdout: `NOTHING WAS BOOKED: ${title} at ${hm(at)} is already over today`, code: 1 };
            days[date] = [...list, b(title, hm(at), hm(at + n), /gym/i.test(title) ? "gym" : /study/i.test(title) ? "study" : /rest/i.test(title) ? "rest" : "other")];
            return { stdout: `Changed ${date}:\n  added ${title} ${hm(at)}–${hm(at + n)}\nWritten to his calendar. "orion-reschedule undo" puts it back.`, code: 0 };
        }
        const x = find(title);
        if (!x)
            return { stdout: `NOTHING WAS CHANGED: no block called "${title}"`, code: 1 };
        if (cmd === "drop") {
            days[date] = list.filter((y) => y !== x);
            return { stdout: `Changed ${date}:\n  dropped ${title}\nWritten to his calendar.`, code: 0 };
        }
        const start = cmd === "move" ? toMin(flag(args, "--to")) : toMin(x.start);
        const end = toMin(flag(args, "--until"));
        const moved = [];
        days[date] = list.map((y) => {
            if (y === x)
                return { ...y, start: hm(start), end: hm(end) };
            if (!y.fixed && y.kind !== "gym" && toMin(y.start) < end && toMin(y.end) > start) {
                const len = toMin(y.end) - toMin(y.start);
                moved.push(`  moved ${y.title}: ${y.start} → ${hm(end + 10)}`);
                return { ...y, start: hm(end + 10), end: hm(end + 10 + len) };
            }
            return y;
        });
        return { stdout: `Changed ${date}:\n  ${title} now runs ${hm(start)}–${hm(end)}\n${moved.join("\n")}\nWritten to his calendar. "orion-reschedule undo" puts it back.`, code: 0 };
    };
    const deps = (now) => ({ run, now,
        readDay: async () => ({ date: today, now: nowHm, blocks: [...days[today]].sort((p, q) => toMin(p.start) - toMin(q.start)) }),
        readDayOn: async (a) => { const d = dateOf(a); return { date: d, now: null, blocks: [...(days[d] ?? [])] }; } });
    return { calls, deps, days };
}
const MON = "2026-11-02";
const monday = (extra = []) => ({ [MON]: [b("MKTG2201", "13:30", "15:30", "class", true), b("Gym", "17:00", "18:30", "gym"), b("Side project", "19:30", "20:30", "side_project"), ...extra],
    "2026-11-03": [b("ECON1115", "11:00", "12:30", "class", true), b("Gym", "17:00", "18:30", "gym")] });
const at = (h, m = 0) => new Date(2026, 10, 2, h, m);
describe("resolving his name for a block on the real day", () => {
    it("'cs lab' is not 'DS Lab 05'; it is 'CS lab' and 'CS2100 Lab'", () => {
        expect(namesTitle("cs lab", "DS Lab 05")).toBe(false);
        expect(namesTitle("cs lab", "CS lab")).toBe(true);
        expect(namesTitle("cs lab", "CS2100 Lab")).toBe(true);
        expect(namesTitle("my gym", "Gym")).toBe(true);
        expect(namesTitle("econ", "ECON1115 Principles of Macroeconomics")).toBe(true);
    });
    it("one still ahead comes first; a same-named block that ended is reported as over", () => {
        const day = { date: MON, now: "19:00", blocks: [b("DS Lab 05", "14:02", "14:47", "study"), b("CS lab", "09:00", "10:00", "study")] };
        expect(resolveNamed("cs lab", day, toMin("19:00"))).toMatchObject({ block: { title: "CS lab" }, over: true });
        expect(resolveNamed("ds lab", day, toMin("12:00"))).toMatchObject({ block: { title: "DS Lab 05" }, over: false });
        expect(resolveNamed("chem lab", day, 0)).toBeUndefined();
    });
});
describe("reading a clear write on a named block", () => {
    it.each([
        ["extend cs lab to two hours today, 8 to 10pm", { op: "length", name: "cs lab", minutes: 120, from: "8", until: "10pm" }],
        ["cs lab is gonna take more like two hours", { op: "length", name: "cs lab", minutes: 120 }],
        ["yeah put cs lab from now until ten thirty", { op: "span", name: "cs lab", from: "now", until: "10:30" }],
        ["add cs lab 7:15pm to 10:30pm tonight", { op: "span", name: "cs lab", from: "7:15pm", until: "10:30pm", evening: true }],
        // held out, his style
        ["ok stretch the essay to 3 hours", { op: "length", name: "essay", minutes: 180 }],
        ["chem homework will prob take like 90 mins", { op: "length", name: "chem homework", minutes: 90 }],
        ["make reading 45 min", { op: "length", name: "reading", minutes: 45 }],
        ["book econ revision from 4 till 6 tmrw", { op: "span", name: "econ revision", from: "4", until: "6", day: "tomorrow" }],
        ["throw in laundry 6pm-6:45pm", { op: "span", name: "laundry", from: "6pm", until: "6:45pm" }],
        ["pls block out portfolio work from now to 9", { op: "span", name: "portfolio work", from: "now", until: "9" }],
    ])("%s", (m, want) => expect(readNamedWrite(m)).toMatchObject(want));
    it.each([
        "is cs lab gonna take two hours?",
        "make it an hour",
        "econ problem set needs another hour, push whatever is after it",
        "add a 30 min nap at 4 today and cut side project tonight",
        "remind me to call mom from 5 to 6",
    ])("not a named write: %s", (m) => expect(readNamedWrite(m)).toBeNull());
    it("the day-request reader routes it (no model)", () => {
        expect(readDayRequest("add cs lab 7:15pm to 10:30pm tonight", at(19, 10))).toMatchObject({ kind: "named-write" });
        expect(readDayRequest("plan sat and sun: gym 90 min each day, econ study 2 hours saturday, a free afternoon sunday, and 1 hour youtube both days", new Date(2026, 10, 6, 15))).toMatchObject({ kind: "multi-day" });
    });
});
describe("carrying out a named write: the effect and the reply agree", () => {
    it("sch-cs-lab-long-c: CS lab 20:00-21:00 becomes 20:00-22:00, gym stays, side project moves and is said", async () => {
        const s = fakeScheduler(monday([b("CS lab", "20:00", "21:00", "study")]), MON, "10:00");
        const out = await runNamedWrite(readNamedWrite("extend cs lab to two hours today, 8 to 10pm"), s.deps(at(10)));
        expect(s.calls).toEqual([["extend", "CS lab", "--until", "22:00"]]);
        expect(s.days[MON].find((x) => x.title === "CS lab")).toMatchObject({ start: "20:00", end: "22:00" });
        expect(s.days[MON].some((x) => x.kind === "gym")).toBe(true);
        expect(out.writes).toBe(1);
        expect(out.flow).toMatchObject({ outcome: "done" });
        const reply = out.flow.reply;
        expect(reply).toMatch(/^Done: CS lab now runs 8:00–10:00 PM today\./);
        expect(reply).toMatch(/Side project/);
        expect(reply).not.toMatch(/orion-|--until|Exec/);
    });
    it("sch-cs-lab-long-v: 'more like two hours' runs two hours from its own start", async () => {
        const s = fakeScheduler(monday([b("CS lab", "20:00", "21:00", "study")]), MON, "10:00");
        await runNamedWrite(readNamedWrite("cs lab is gonna take more like two hours"), s.deps(at(10)));
        expect(s.calls).toEqual([["extend", "CS lab", "--until", "22:00"]]);
    });
    it("sch-cs-lab-until-v/c: a CS lab not on the day is added 19:15-22:30 even with DS Lab 05 done earlier; no confirmation asked", async () => {
        for (const m of ["yeah put cs lab from now until ten thirty", "add cs lab 7:15pm to 10:30pm tonight"]) {
            const s = fakeScheduler(monday([b("DS Lab 05", "14:02", "14:47", "study")]), MON, "19:15");
            const out = await runNamedWrite(readNamedWrite(m), s.deps(at(19, 15)));
            expect(s.calls).toEqual([["add", "CS lab", "195", "--at", "19:15"]]);
            expect(out.flow.reply).toMatch(/^Done: CS lab is on 7:15–10:30 PM (?:tonight|today)\./);
            expect(out.flow.reply).not.toMatch(/Want me to|Should I|DS Lab/);
        }
    });
    it("a start that passed a few minutes ago starts now and says so; one long gone is refused with nothing written", async () => {
        const s = fakeScheduler(monday(), MON, "19:22");
        const out = await runNamedWrite(readNamedWrite("add cs lab 7:15pm to 10:30pm tonight"), s.deps(at(19, 22)));
        expect(s.calls).toEqual([["add", "CS lab", "185", "--at", "19:25"]]);
        expect(out.flow.reply).toMatch(/7:15 PM had just passed, so it starts now/);
        const late = fakeScheduler(monday(), MON, "21:00");
        const r2 = await runNamedWrite(readNamedWrite("add cs lab 7:15pm to 10:30pm tonight"), late.deps(at(21)));
        expect(late.calls).toEqual([]);
        expect(r2.flow).toMatchObject({ outcome: "say", text: expect.stringMatching(/7:15 PM has already passed.*Nothing changed/) });
    });
    it("a block he names that is still ahead moves to the span he said (one call), and the reply reads the calendar back", async () => {
        const s = fakeScheduler(monday([b("Reading", "21:00", "21:30", "other")]), MON, "12:00");
        const out = await runNamedWrite(readNamedWrite("put reading from 6pm to 7pm"), s.deps(at(12)));
        expect(s.calls).toEqual([["move", "Reading", "--to", "18:00", "--until", "19:00"]]);
        expect(out.flow.reply).toMatch(/^Done: Reading is now 6:00–7:00 PM today\./);
    });
    it("a class he names is not stretched or moved here: said plainly, nothing written", async () => {
        const s = fakeScheduler(monday(), MON, "10:00");
        const out = await runNamedWrite(readNamedWrite("extend mktg2201 to 3 hours"), s.deps(at(10)));
        expect(s.calls).toEqual([]);
        expect(out.flow).toMatchObject({ outcome: "say", text: expect.stringMatching(/MKTG2201 is a class.*Nothing changed/) });
    });
    it("a length for a block that is not on the day asks when it is, and writes nothing", async () => {
        const s = fakeScheduler(monday(), MON, "10:00");
        const out = await runNamedWrite(readNamedWrite("cs lab is gonna take more like two hours"), s.deps(at(10)));
        expect(s.calls).toEqual([]);
        expect(out.flow).toMatchObject({ outcome: "say", kind: "ask" });
        expect(out.flow.text).not.toMatch(/What time or how long do you mean/);
    });
    it("a scheduler refusal is said in plain words with no tool internals, nothing claimed", async () => {
        const s = fakeScheduler(monday(), MON, "10:00");
        const deps = { ...s.deps(at(10)), run: async () => ({ stdout: "NOTHING WAS CHANGED: must-haves could not fit: Gym — run again with --again", code: 1 }) };
        const out = await runNamedWrite(readNamedWrite("add cs lab 7pm to 11pm"), deps);
        expect(out.flow).toMatchObject({ outcome: "say", text: "I couldn't put CS lab at 7:00–11:00 PM (must-haves could not fit: Gym). Nothing changed." });
    });
});
describe("planning the weekend or tomorrow, day by day", () => {
    const FRI = new Date(2026, 10, 6, 15);
    const weekend = () => ({ "2026-11-06": [b("Gym", "17:00", "18:30", "gym")],
        "2026-11-07": [b("Gym", "17:00", "18:30", "gym"), b("Side project", "19:30", "20:30", "side_project")],
        "2026-11-08": [b("Gym", "17:00", "18:30", "gym"), b("Side project", "19:30", "20:30", "side_project")] });
    it("planDays: Friday -> Sat+Sun; Saturday -> today+Sun; Sunday -> today; tomorrow", () => {
        expect(planDays("weekend", FRI).map((d) => d.date)).toEqual(["2026-11-07", "2026-11-08"]);
        expect(planDays("weekend", new Date(2026, 10, 7, 10)).map((d) => [d.date, d.today])).toEqual([["2026-11-07", true], ["2026-11-08", false]]);
        expect(planDays("weekend", new Date(2026, 10, 8, 10)).map((d) => d.date)).toEqual(["2026-11-08"]);
        expect(planDays("tomorrow", FRI).map((d) => d.date)).toEqual(["2026-11-07"]);
    });
    it("firstFit skips busy time and windows he wants free", () => {
        expect(firstFit([[600, 700]], 60, 600, 540)).toBe(705);
        expect(firstFit([[720, 1020]], 60, 840, 540)).toBe(1025);
    });
    it("sch-weekend-plan-c: exactly the blocks he listed on Sat/Sun, Sunday afternoon free, gym kept, the reply lists both days", async () => {
        const s = fakeScheduler(weekend(), "2026-11-06", "15:00");
        const plan = readMultiDay("plan sat and sun: gym 90 min each day, econ study 2 hours saturday, a free afternoon sunday, and 1 hour youtube both days");
        expect(plan).toMatchObject({ span: "weekend", listed: true, free: [{ scope: "sun", part: "afternoon" }] });
        const out = await runMultiDay(plan, s.deps(FRI));
        const titles = (d) => s.days[d].map((x) => `${x.title} ${x.start}-${x.end}`).sort();
        expect(titles("2026-11-07")).toEqual(["Econ study 10:00-12:00", "Gym 17:00-18:30", "Side project 19:30-20:30", "YouTube 20:35-21:35"]);
        expect(titles("2026-11-08")).toEqual(["Gym 17:00-18:30", "Side project 19:30-20:30", "YouTube 20:35-21:35"]);
        expect(s.days["2026-11-08"].every((x) => toMin(x.end) <= 12 * 60 || toMin(x.start) >= 17 * 60)).toBe(true);
        expect(s.calls.every((c) => c.includes("--date"))).toBe(true);
        const reply = out.flow.reply;
        expect(reply).toMatch(/Saturday: .*Econ study 10:00 AM–12:00 PM/);
        expect(reply).toMatch(/Sunday: .*Gym 5:00–6:30 PM \(already on\).*12 PM–5 PM kept free/);
        expect(reply).not.toMatch(/took off/);
    });
    // REV4 item 10: a listed plan drops only ORION-owned "other" blocks; deadline study, the side-project hour, classes, plans with people and
    // his own events stay, and the reply names what moved.
    describe("a listed plan never drops what matters (REV4 item 10)", () => {
        const sat = "2026-11-07";
        const busy = () => ({ "2026-11-06": [], [sat]: [
                b("Gym", "17:00", "18:30", "gym"), b("Side project", "19:30", "20:30", "side_project"), b("Stats problem set", "10:00", "12:00", "deadline"),
                b("Chem revision", "13:00", "14:00", "study"), b("MKTG2201 workshop", "09:00", "09:50", "class", true), b("Brunch with Sam", "11:00", "12:00", "other", true),
                b("Dentist", "15:00", "15:45", "other", true), b("Laundry", "21:00", "21:30", "other"),
            ], "2026-11-08": [] });
        it.each([
            "plan sat and sun: gym 90 min each day and 1 hour youtube both days",
            "plan my weekend: gym 90 min, 1 hour guitar",
            "plan sat n sun - gym 90 min each day, 45 min reading",
        ])("held out: %s", async (m) => {
            const s = fakeScheduler(busy(), "2026-11-06", "15:00");
            const out = await runMultiDay(readMultiDay(m), s.deps(FRI));
            const left = s.days[sat].map((x) => x.title);
            expect(left).toEqual(expect.arrayContaining(["Stats problem set", "Chem revision", "Side project", "MKTG2201 workshop", "Brunch with Sam", "Dentist", "Gym"]));
            expect(left).not.toContain("Laundry");
            expect(s.calls.filter((c) => c[0] === "drop").map((c) => c[1])).toEqual(["Laundry"]);
            expect(out.flow.reply).toMatch(/took off Laundry/);
        });
    });
    it("sch-weekend-plan-v: vague plan gets gym, an econ block and a rest block each day plus the side-project hour, assumptions said", async () => {
        const s = fakeScheduler(weekend(), "2026-11-06", "15:00");
        const plan = readMultiDay("plan my weekend, i want to get ahead on econ and also actually relax");
        expect(plan.items.map((i) => i.title)).toEqual(["Gym", "Econ study", "Rest", "Side project"]);
        const out = await runMultiDay(plan, s.deps(FRI));
        for (const d of ["2026-11-07", "2026-11-08"]) {
            const t = s.days[d].map((x) => x.title);
            expect(t).toEqual(expect.arrayContaining(["Gym", "Econ study", "Rest", "Side project"]));
        }
        expect(s.days["2026-11-06"].length).toBe(1); // tonight untouched
        const reply = out.flow.reply;
        expect(reply).toMatch(/Saturday: .*Sunday: /);
        expect(reply).toMatch(/I assumed gym 90 min each day/);
    });
    it.each([
        ["can you plan out my weekend, need to catch up on stats and chill a bit", ["Gym", "Stats study", "Rest", "Side project"]],
        ["plan tmrw: gym 90 min, essay 2 hours, 1 hour guitar", ["Gym", "Essay", "Guitar"]],
        ["tmrw needs gym and 2 hours of chem study", ["Gym", "Chem study"]],
        ["plan saturday and sunday - workout each day and 3 hrs of cs review saturday", ["Gym", "Cs review"]],
    ])("held out: %s", (m, titles) => expect(readMultiDay(m)?.items.map((i) => i.title)).toEqual(titles));
    it.each(["tmrw needs to be chill", "how does my weekend look?", "plan my day"])("not a multi-day plan: %s", (m) => expect(readMultiDay(m)).toBeNull());
});
function route(days, today, nowHm, now) {
    const s = fakeScheduler(days, today, nowHm);
    const handlers = new Map();
    const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    const fire = async (n, e, c) => { const o = []; for (const fn of handlers.get(n) ?? [])
        o.push(await fn(e, c)); return o; };
    const dir = mkdtempSync(join(tmpdir(), "w4cal-"));
    const deps = s.deps(now);
    const flows = [];
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), clock: () => nowHm, now: () => now,
        decideImpl: async () => ({ move: "escalate" }), brainSearch: async () => "",
        readDayJson: async (a) => (a.length ? deps.readDayOn(a) : deps.readDay()), readDay: async () => JSON.stringify(await deps.readDay()),
        scheduleFlow: async (m) => { flows.push(m); return { outcome: "fallback", reason: "test" }; },
        realityRun: async (script, args) => (script === "orion-reschedule" ? deps.run(script, args) : { stdout: '{"id":"fact-1"}', code: 0 }) });
    let n = 0;
    const turn = async (prompt) => {
        const ctx = { runId: `w4-${n += 1}`, sessionKey: "agent:main:orion-chat-w4" };
        await fire("before_model_resolve", { prompt }, ctx);
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        return /Your whole reply must be exactly: ([\s\S]*)\]$/.exec(built?.appendContext ?? "")?.[1];
    };
    return { turn, calls: s.calls, days: s.days, flows };
}
describe("through the chat route", () => {
    it("sch-cs-lab-long-c on the premise day: one extend, the reply matches the calendar", async () => {
        const r = route(monday([b("CS lab", "20:00", "21:00", "study")]), MON, "10:00", at(10));
        const reply = await r.turn("extend cs lab to two hours today, 8 to 10pm");
        expect(r.calls).toEqual([["extend", "CS lab", "--until", "22:00"]]);
        expect(r.flows).toEqual([]);
        expect(reply).toMatch(/^Done: CS lab now runs 8:00–10:00 PM today\./);
    });
    it("sch-cs-lab-until-v at 19:15: added 19:15-22:30, no confirmation", async () => {
        const r = route(monday([b("DS Lab 05", "14:02", "14:47", "study")]), MON, "19:15", at(19, 15));
        const reply = await r.turn("yeah put cs lab from now until ten thirty");
        expect(r.calls).toEqual([["add", "CS lab", "195", "--at", "19:15"]]);
        expect(reply).toMatch(/^Done: CS lab is on 7:15–10:30 PM today\./);
    });
    it("sch-weekend-plan-c on Friday 15:00: Saturday and Sunday are written, tonight is not", async () => {
        const days = { "2026-11-06": [b("Gym", "17:00", "18:30", "gym")], "2026-11-07": [b("Gym", "17:00", "18:30", "gym")], "2026-11-08": [b("Gym", "17:00", "18:30", "gym")] };
        const r = route(days, "2026-11-06", "15:00", new Date(2026, 10, 6, 15));
        const reply = await r.turn("plan sat and sun: gym 90 min each day, econ study 2 hours saturday, a free afternoon sunday, and 1 hour youtube both days");
        expect(r.calls.length).toBeGreaterThan(0);
        expect(r.calls.every((c) => c.includes("2026-11-07") || c.includes("2026-11-08"))).toBe(true);
        expect(r.days["2026-11-06"]).toHaveLength(1);
        expect(reply).toMatch(/Saturday: .*Sunday: /);
    });
});
