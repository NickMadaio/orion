// Reality statements change the plan (2026-10-30). The incident: "Just note that I don't have classes. I still have my lab
// to do, but I don't have classes." by voice changed nothing, and three DEF301 leave nudges followed. Phrasings are his
// and the gate bank's (scripts/eval/gate/scenarios/reality.json, schedule.json), vague and clear.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { names, readReality, shortTitle } from "./reality.js";
describe("what counts as a reality statement", () => {
    it.each([
        ["No. We're good. Just note that I don't have classes. I still have my lab to do, but I don't have classes.", { kind: "no-classes", names: [], keep: "lab" }],
        ["i dont have classes today", { kind: "no-classes", names: [] }],
        ["no class today btw", { kind: "no-classes", names: [] }],
        ["lecture's cancelled", { kind: "no-classes", names: [] }],
        ["my class got cancelled", { kind: "no-classes", names: [] }],
        ["no classes tomorrow", { kind: "no-classes", tomorrow: true }],
        ["i dont have marketing or macro today, both are cancelled, use the time", { kind: "no-classes", names: ["marketing", "macro"], fill: true }],
        ["no marketing and no macro today, cancel the leave reminders", { kind: "no-classes", names: ["marketing", "macro"] }],
        ["marketing is cancelled today", { kind: "no-classes", names: ["marketing"] }],
        ["i didnt go to the gym", { kind: "missed", what: "gym" }],
        ["didnt make it to marketing", { kind: "missed", what: "marketing" }],
        ["i skipped the gym today lol", { kind: "missed", what: "gym" }],
        ["im doing econ instead of gym", { kind: "instead", did: "econ", planned: "gym", past: false }],
        ["i did cs lab instead of the gym", { kind: "instead", did: "cs lab", planned: "gym", past: true }],
        ["went to the library instead of the gym", { kind: "instead", did: "library", planned: "gym", past: true }],
        ["i ate already", { kind: "ate" }],
        ["already ate", { kind: "ate" }],
        ["i've eaten", { kind: "ate" }],
        ["im at the library", { kind: "place", place: "library" }],
    ])("%s", (message, expected) => {
        const read = readReality(message);
        expect(read?.reality).toMatchObject(expected);
        expect(read?.rest).toBe(false);
    });
    it("a reality statement with another change in it is only declared here; the change goes on as usual", () => {
        expect(readReality("i skipped marketing, move gym to 6")).toMatchObject({ reality: { kind: "missed", what: "marketing" }, rest: true });
    });
    it.each([
        "do i have class today?",
        "no class until 3",
        "ugh im not doing the gym thing today",
        "skip gym today, im sick of it and tired, move it to tomorrow",
        "she didnt go to the gym",
        "i didnt get enough sleep",
        "i didnt go to bed till 4",
        "what did i eat yesterday",
        "no gym today",
        "if i dont have class tomorrow can we sleep in",
        "im at the gym from 5 to 7",
        "annika just asked if i wanna get food rn",
    ])("not one: %s", (message) => {
        expect(readReality(message)).toBeNull();
    });
    it("class words name his classes by any word of the title", () => {
        expect(names("macro", "ECON1115 Principles of Macroeconomics — Lecture")).toBe(true);
        expect(names("marketing", "DEF301 Introduction to Marketing — Lecture")).toBe(true);
        expect(names("econ", "ECON1115 Principles of Macroeconomics")).toBe(true);
        expect(names("gym", "DEF301 Introduction to Marketing")).toBe(false);
        expect(shortTitle("DEF301 Introduction to Marketing — Lecture")).toBe("DEF301");
        expect(shortTitle("Gym")).toBe("Gym");
    });
});
const DAY = { date: "2026-10-30", now: "12:40", blocks: [
        { title: "DEF301 Introduction to Marketing — Lecture", start: "13:30", end: "15:00", fixed: true, kind: "class" },
        { title: "ECON1115 Principles of Macroeconomics — Lecture", start: "15:30", end: "17:00", fixed: true, kind: "class" },
        { title: "CS Lab", start: "17:50", end: "19:20", fixed: false, kind: "study" },
        { title: "Gym", start: "12:00", end: "13:30", fixed: false, kind: "gym" },
    ] };
const CLASSES_OFF = "Changed Friday 2026-10-30:\n  cancelled DEF301 Introduction to Marketing — Lecture 13:30–15:00 — marked off in ORION's planning (still in Apple Calendar, not deleted)\n  cancelled ECON1115 Principles of Macroeconomics — Lecture 15:30–17:00 — marked off in ORION's planning (still in Apple Calendar, not deleted)\nWritten. \"orion-reschedule undo\" puts them back.";
function route(opts = {}) {
    const handlers = new Map();
    const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    const fire = async (n, e, c) => { const o = []; for (const fn of handlers.get(n) ?? [])
        o.push(await fn(e, c)); return o; };
    const calls = [];
    let deskCalls = 0;
    const dir = mkdtempSync(join(tmpdir(), "reality-"));
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), clock: () => "Fri 12:40", now: () => new Date(2026, 9, 30, 12, 40),
        decideImpl: async () => { deskCalls += 1; return (await (opts.decide ?? (async () => ({ move: "escalate" })))()); },
        brainSearch: async () => "", scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }), readDayJson: async () => DAY,
        ...(opts.stateDir ? { stateDir: opts.stateDir } : {}),
        realityRun: async (script, args) => {
            calls.push([script, ...args]);
            const custom = opts.script?.(script, args);
            if (custom !== undefined)
                return { stdout: custom, code: /NOTHING WAS CHANGED/.test(custom) ? 1 : 0 };
            if (script === "orion-declare" && args[0] === "add")
                return { stdout: JSON.stringify({ id: `fact-${String(calls.length).padStart(8, "0")}`, kind: args[2] }), code: 0 };
            if (script === "orion-declare")
                return { stdout: "Removed", code: 0 };
            if (args[0] === "classes-off")
                return { stdout: CLASSES_OFF, code: 0 };
            if (args[0] === "undo")
                return { stdout: "Undone: put DEF301 Introduction to Marketing — Lecture back; put ECON1115 Principles of Macroeconomics — Lecture back.", code: 0 };
            return { stdout: "", code: 0 };
        } });
    const turn = async (prompt, runId) => {
        const ctx = { runId, sessionKey: "agent:main:orion-chat-reality" };
        await fire("before_model_resolve", { prompt }, ctx);
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        const exact = /Your whole reply must be exactly: ([\s\S]*)\]$/.exec(built?.appendContext ?? "")?.[1];
        const messages = [{ role: "user", content: prompt }, { role: "assistant", content: [{ type: "text", text: exact ?? "model reply" }] }];
        await fire("before_agent_finalize", { lastAssistantMessage: exact ?? "model reply", messages }, ctx);
        return { exact, built };
    };
    return { turn, calls, desk: () => deskCalls };
}
const SPOKEN = "Nick SAID this out loud and your answer will be SPOKEN: one to three short sentences.\n\nUser message:\n";
describe("reality on the live route", () => {
    it("the 10-30 incident, by voice: the fact is declared, both classes are marked cancelled (not deleted), the lab stays, and the reply says so with undo", async () => {
        const r = route({ decide: async () => { throw new Error("fetch failed"); } });
        const { exact } = await r.turn(`${SPOKEN}No. We're good. Just note that I don't have classes. I still have my lab to do, but I don't have classes.`, "inc-1");
        expect(r.desk()).toBe(0); // code's from the start: the outage that ate this message cannot stop it
        expect(r.calls[0]).toEqual(["orion-declare", "add", "--kind", "no-classes", "--text", "No. We're good. Just note that I don't have classes. I still have my lab to do, but I don't have classes.", "--source", "voice"]);
        expect(r.calls[1]).toEqual(["orion-reschedule", "classes-off", "--keep", "lab"]);
        expect(exact).toBe("Got it, no classes today. I've marked DEF301 (1:30 PM) and ECON1115 (3:30 PM) cancelled (still in Apple Calendar), so no leave reminders for them. Your lab is still on. Say \"undo\" to put them back.");
        const undo = await r.turn("undo", "inc-2");
        expect(r.calls.slice(2)).toEqual([["orion-reschedule", "undo"], ["orion-declare", "remove", "--id", "fact-00000001"]]);
        expect(undo.exact).toBe("Undone: DEF301 and ECON1115 are back on your plan, and I've forgotten what you told me about it.");
    });
    it("typed, vague: 'i dont have classes today' does the same with source chat", async () => {
        const r = route();
        const { exact } = await r.turn("i dont have classes today", "t-1");
        expect(r.calls[0]).toContain("chat");
        expect(r.calls[1]).toEqual(["orion-reschedule", "classes-off"]);
        expect(exact).toMatch(/^Got it, no classes today\. I've marked DEF301 \(1:30 PM\) and ECON1115 \(3:30 PM\) cancelled/);
    });
    it("clear and named: only those classes, a skip fact for each", async () => {
        const r = route({ script: (_s, a) => (a[0] === "classes-off" ? CLASSES_OFF.split("\n").filter((l) => !/ECON/.test(l)).join("\n") : undefined) });
        const { exact } = await r.turn("marketing is cancelled today", "n-1");
        expect(r.calls[0]).toEqual(expect.arrayContaining(["--kind", "skip", "--title", "DEF301 Introduction to Marketing — Lecture"]));
        expect(r.calls.find((c) => c[1] === "classes-off")).toEqual(["orion-reschedule", "classes-off", "DEF301"]);
        expect(exact).toMatch(/^Got it, no DEF301 today\. I've marked DEF301 \(1:30 PM\) cancelled/);
    });
    it("'no gym today' names no class: nothing is declared, the turn goes on", async () => {
        const r = route();
        await r.turn("no gym today", "g-1");
        expect(r.calls).toEqual([]);
    });
    it("'im doing econ instead of gym' during gym: the fact, then econ logged in gym's slot and the day re-weighed", async () => {
        const r = route({ script: (_s, a) => (a[0] === "log" ? "Changed Friday 2026-10-30:\n  logged econ 12:00–13:30 (replaced Gym)\n  moved CS Lab: 17:50 → 18:10\nWritten to his calendar." : undefined) });
        const { exact } = await r.turn("im doing econ instead of gym", "i-1");
        expect(r.calls[0]).toEqual(expect.arrayContaining(["--kind", "skip", "--title", "Gym"]));
        expect(r.calls[1]).toEqual(["orion-reschedule", "log", "econ", "--from", "12:00", "--to", "13:30", "--instead", "Gym"]);
        expect(exact).toBe("Done: econ 12:00 PM–1:30 PM is on your calendar in place of Gym, and the rest of today is re-weighed: moved CS Lab: 5:50 PM → 6:10 PM. Say \"undo\" to put it back.");
    });
    it("a refused log never reads as done", async () => {
        const r = route({ script: (_s, a) => (a[0] === "log" ? "NOTHING WAS CHANGED: 12:00–12:00 is shorter than 5 minutes" : undefined) });
        const { exact } = await r.turn("im doing econ instead of gym", "i-2");
        expect(exact).toMatch(/^I couldn't put econ in place of Gym .*so your calendar is as it was\.$/);
    });
    it("'i didnt go to the gym' with gym already started: off its slot, re-weighed, and the week's pattern named from the state card", async () => {
        const dir = mkdtempSync(join(tmpdir(), "reality-card-"));
        const slips = [24, 26, 28].map((d) => JSON.stringify({ at: new Date(2026, 9, d, 21).toISOString(), planned: { title: "Gym", kind: "gym" }, reason: "gave-up" })).join("\n");
        writeFileSync(join(dir, "slips.jsonl"), slips);
        const r = route({ stateDir: dir, script: (_s, a) => (a[0] === "displace" ? "Changed Friday:\n  Gym 12:00–13:30 will not happen (skip); it is off its slot\n  moved CS Lab: 17:50 → 17:00\nWritten." : undefined) });
        const { exact } = await r.turn("i didnt go to the gym", "m-1");
        expect(r.calls[1]).toEqual(["orion-reschedule", "displace", "Gym", "--why", "skip"]);
        expect(exact).toBe("Okay, Gym didn't happen; it's off its 12:00 PM slot and I re-weighed the rest: moved CS Lab: 5:50 PM → 5:00 PM. That's the fourth gym skip this week. Say \"undo\" to put it back.");
    });
    it("'didnt make it to marketing' (a class): declared and said plainly, the class itself is left on the calendar", async () => {
        const r = route();
        const { exact } = await r.turn("didnt make it to marketing", "m-2");
        expect(r.calls).toHaveLength(1);
        expect(exact).toBe("Noted: you missed DEF301 today, so I won't count it as attended. If you want catch-up time for it, tell me when.");
    });
    it("'i ate already' and 'im at the library' are declared facts with a short reply", async () => {
        const r = route();
        expect((await r.turn("i ate already", "a-1")).exact).toBe("Good, noted you've eaten. I won't chase you about food.");
        expect((await r.turn("im at the library", "p-1")).exact).toBe("Got it, you're at the library.");
        expect(r.calls.map((c) => c.slice(0, 3))).toEqual([["orion-declare", "add", "--kind"], ["orion-declare", "add", "--kind"]]);
        expect(r.calls[1]).toEqual(expect.arrayContaining(["--place", "library"]));
    });
    it("a fact that cannot be saved is said honestly, nothing claimed", async () => {
        const r = route({ script: (s) => (s === "orion-declare" ? "NOTHING WAS CHANGED: disk" : undefined) });
        expect((await r.turn("i dont have classes today", "f-1")).exact).toBe("I couldn't save that just now, so nothing changed. Say go and I'll retry it.");
        expect(r.calls.some((c) => c[1] === "classes-off")).toBe(false);
    });
    it("'i skipped marketing, move gym to 6': the fact is written and the request routes on", async () => {
        const r = route();
        const { exact } = await r.turn("i skipped marketing, move gym to 6", "rest-1");
        expect(r.calls).toEqual([expect.arrayContaining(["orion-declare", "add", "--kind", "skip", "--title", "marketing"])]);
        expect(exact).toBeUndefined(); // not code's reply: the normal turn handles the catch-up
        expect(r.desk()).toBe(1);
    });
});
