// Round 8 review 1 (2026-10-16), M1-M4 and two LOWs: the day-absence answer, the deadline window, a failed to-do read,
// and the focus-today question. Every exec is stubbed. Written by Claude on 2026-10-16.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { noBlockReply } from "./day-read-answers.js";
import { asksDeadlines, deadlineReply } from "./deadline-read.js";
import { asksFocusToday, readFocusHistory } from "./focus-status.js";
const DAY = "B1 13:30–15:00 MKTG2201 Introduction to Marketing — Lecture (FIXED)\nB2 15:30–17:00 ECON1115 Principles of Macroeconomics — Lecture (FIXED)";
const withBlock = (title) => `${DAY}\nB3 17:30–18:30 ${title}`;
describe("M1: noBlockReply", () => {
    it("a question about time for something is not a claim that the block is missing", () => {
        for (const m of ["do i have time for a nap today", "is there room for a gym session today", "can i fit a nap in today", "can you squeeze in a workout today"])
            expect(noBlockReply(m, DAY, false)).toBeNull();
    });
    it("a title with a synonym counts as the block", () => {
        expect(noBlockReply("is there a gym session today", withBlock("Morning run"), false)).toBeNull();
        expect(noBlockReply("when is my gym block", withBlock("Swim"), false)).toBeNull();
        expect(noBlockReply("when is my gym block", withBlock("Climbing"), false)).toBeNull();
        expect(noBlockReply("when is my study block", withBlock("Problem set 3"), false)).toBeNull();
        expect(noBlockReply("when is my study block", withBlock("Reading"), false)).toBeNull();
        expect(noBlockReply("when is my study block", withBlock("Deep work"), false)).toBeNull();
    });
    it("still claims absence for the named block (q015, q009, q013)", () => {
        expect(noBlockReply("how much time do i have before my nap block ends", DAY, false)).toMatch(/^There's no nap block on your calendar today\./);
        expect(noBlockReply("how many minutes until the lab starts", DAY, false)).toMatch(/^There's no lab block/);
        expect(noBlockReply("is today a lab day or nah", DAY, false)).toMatch(/^There's no lab block/);
    });
    it("does not claim absence when the kind is only mentioned in passing", () => {
        expect(noBlockReply("when is gym", DAY, false)).toBeNull();
    });
    it("routes: 'do i have time for a nap today' reaches the day read, not the absence line", async () => {
        const handlers = new Map();
        const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
        const logPath = join(mkdtempSync(join(tmpdir(), "r8b-")), "r.jsonl");
        registerLocalRouting(api, { warm: false, mode: "on", logPath, decideImpl: async () => ({ move: "escalate", tier: "quick" }), clock: () => "Fri 11:00", brainSearch: async () => "",
            now: () => new Date(2026, 9, 16, 11, 0), scheduleFlow: async () => ({ outcome: "fallback", reason: "q" }), readDay: async () => DAY });
        const ctx = { runId: "r8b1", sessionKey: "agent:main:orion-chat-1" };
        for (const fn of handlers.get("before_model_resolve") ?? [])
            await fn({ prompt: "do i have time for a nap today" }, ctx);
        const out = (await Promise.all((handlers.get("before_prompt_build") ?? []).map((fn) => fn({ prompt: "do i have time for a nap today", messages: [] }, ctx))));
        expect(out[0]?.systemPrompt ?? "").not.toContain("There's no nap block");
    });
});
const at = (d, h = 0, m = 0) => new Date(2026, 9, d, h, m).toISOString();
const EV = (title, d, allDay = true) => ({ title, start: at(d, allDay ? 0 : 13), allDay: String(allDay), isDeadline: true });
// Fri Oct 16 2026, 10:00. Sat 17, Sun 18, Mon 19 ... Fri 23.
const FRI = new Date(2026, 9, 16, 10, 0);
const read = { events: [EV("Today quiz", 16), EV("Sat thing", 17), EV("Sun thing", 18), EV("Mon thing", 19), EV("Wed thing", 21), EV("Next Fri thing", 23), EV("Next Mon thing", 26)], tasks: [] };
describe("M2: calendar windows", () => {
    it("this week ends on Sunday", () => {
        const r = deadlineReply("whats due this week", read, FRI);
        expect(r).toContain("Sun thing");
        expect(r).not.toContain("Mon thing");
    });
    it("next week is the coming Monday to Sunday", () => {
        const r = deadlineReply("whats due next week", read, FRI);
        expect(r).toContain("Mon thing");
        expect(r).toContain("Next Fri thing");
        expect(r).not.toContain("Sun thing");
        expect(r).not.toContain("Next Mon thing");
    });
    it("tomorrow and tmrw are the next day; before 5 AM it is today's date", () => {
        expect(deadlineReply("whats due tomorrow", read, FRI)).toBe("Due tomorrow: Sat thing, tomorrow (all day).");
        expect(deadlineReply("what's due tmrw", read, FRI)).toContain("Sat thing");
        expect(deadlineReply("whats due tomorrow", read, new Date(2026, 9, 16, 3, 31))).toContain("Today quiz");
    });
    it("a weekday is that date", () => {
        expect(deadlineReply("what's due wednesday", read, FRI)).toBe("Due wednesday: Wed thing, Wednesday (all day).");
        expect(deadlineReply("what's due on friday", read, FRI)).toContain("Today quiz");
    });
});
describe("M3: a failed to-do read", () => {
    it("is said, never folded into 'Nothing is due'", () => {
        const failed = { events: [], tasks: [], tasksFailed: true };
        const r = deadlineReply("whats due this week", failed, FRI);
        expect(r).toContain("I couldn't read your to-dos");
        expect(r).not.toMatch(/^Nothing is due/);
        expect(deadlineReply("whats due this week", { ...failed, events: [EV("Today quiz", 16)] }, FRI)).toMatch(/Today quiz.*couldn't read your to-dos/);
    });
});
describe("M3: deadline titles", () => {
    it("classify and the deadline rule", async () => {
        const { DEADLINE_TITLE, classify } = await import("../../../scripts/lib/life/live-day.mjs");
        for (const t of ["CS2500 HW4 due", "HW4 due", "Midterm exam", "Exams week", "Quiz 1"])
            expect(DEADLINE_TITLE.test(t)).toBe(true);
        for (const t of ["Examine the results", "Overdue library book", "Gym"])
            expect(DEADLINE_TITLE.test(t)).toBe(false);
        // r8 review 2 M4: the scheduler's classify() is unchanged: a self-made "HW due" block is study, not a fixed deadline.
        expect(classify("Study – HW due Mon")).toBe("study");
        expect(classify("HW4 due")).not.toBe("deadline");
        expect(classify("DUE 13:00 — Marketing: Slides")).toBe("deadline");
    });
});
describe("M1: the plugin's gym and study words cover classify()'s", () => {
    it("every title classify() calls gym or study is the same kind here", async () => {
        const { classify } = await import("../../../scripts/lib/life/live-day.mjs");
        for (const t of ["Gym", "Workout", "Lifting", "Run", "Running", "Study", "Revise notes", "Revision", "Homework", "Problem set 2", "Reading"]) {
            const kind = classify(t);
            const asked = kind === "gym" ? "when is my gym block" : "when is my study block";
            expect(["gym", "study"]).toContain(kind);
            expect(noBlockReply(asked, withBlock(t), false), t).toBeNull();
        }
    });
});
describe("M4: focus today", () => {
    it("past and progressive only", () => {
        for (const m of ["how long have i been focusing today", "how many hours have i studied today", "did i focus today", "have i been studying today", "how much focus time have i done today", "focused time today"])
            expect(asksFocusToday(m)).toBe(true);
        for (const m of ["how long am i studying today", "how many hours of studying do i have today", "how much focus time is left today"])
            expect(asksFocusToday(m)).toBe(false);
    });
    it("an unreadable history file is no rows", () => {
        expect(readFocusHistory(tmpdir())).toEqual([]);
    });
});
describe("LOW: deadline asks without a question mark", () => {
    it("any deadlines coming up", () => {
        expect(asksDeadlines("any deadlines coming up")).toBe(true);
        expect(asksDeadlines("my deadlines are killing me")).toBe(false);
    });
    it("routes without '?'", async () => {
        const handlers = new Map();
        const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
        const logPath = join(mkdtempSync(join(tmpdir(), "r8b-")), "r.jsonl");
        registerLocalRouting(api, { warm: false, mode: "on", logPath, decideImpl: async () => ({ move: "escalate", tier: "quick" }), clock: () => "Fri 10:00", brainSearch: async () => "",
            now: () => FRI, scheduleFlow: async () => ({ outcome: "fallback", reason: "q" }), readDeadlines: async () => read });
        const ctx = { runId: "r8b2", sessionKey: "agent:main:orion-chat-2" };
        for (const fn of handlers.get("before_model_resolve") ?? [])
            await fn({ prompt: "any deadlines coming up" }, ctx);
        const out = (await Promise.all((handlers.get("before_prompt_build") ?? []).map((fn) => fn({ prompt: "any deadlines coming up", messages: [] }, ctx))));
        expect(out[0]?.systemPrompt ?? "").toContain("Today quiz");
    });
});
