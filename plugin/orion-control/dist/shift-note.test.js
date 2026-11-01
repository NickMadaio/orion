// Gate rea-work-on-it-tomorrow-c (run-1101091514): the scheduler booked 1:20 PM for a stated 10 AM and the reply never said why.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { shiftNote } from "./shift-note.js";
const MON = (hm) => { const [h, m] = hm.split(":").map(Number); return new Date(2026, 10, 2, h, m); };
const today = (now) => ({ date: "2026-11-02", now, blocks: [{ title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" }] });
async function turnWith(now, message, addOut) {
    const handlers = new Map();
    const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    const fire = async (n, e, c) => { const o = []; for (const fn of handlers.get(n) ?? [])
        o.push(await fn(e, c)); return o; };
    const dir = mkdtempSync(join(tmpdir(), "shift-note-"));
    const day = today(now);
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), clock: () => `Mon ${now}`, now: () => MON(now),
        decideImpl: async () => ({ move: "escalate" }), brainSearch: async () => "",
        readDayJson: async (a) => (a.includes("tomorrow") ? { date: "2026-11-03", now: null, blocks: [] } : day), readDay: async () => JSON.stringify(day),
        scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }),
        realityRun: async (_s, a) => ({ stdout: a[0] === "add" ? addOut : "Changed Monday:\n  dropped", code: 0 }) });
    const ctx = { runId: "sn-1", sessionKey: "agent:main:orion-chat-sn" };
    await fire("before_model_resolve", { prompt: message }, ctx);
    const [built] = (await fire("before_prompt_build", { prompt: message, messages: [] }, ctx));
    return /Your whole reply must be exactly: ([\s\S]*)\]$/.exec(built?.appendContext ?? "")?.[1];
}
const SHIFTED = "Changed Tuesday:\n  SHIFTED: Finish resume could not go at 10:00 (ECON1115 Lecture is there) — booked 13:20 instead; tell him\n  planned Finish resume: 13:20–14:05";
describe("shiftNote reads the scheduler's own SHIFTED line", () => {
    it("names the blocker and the time that was asked for", () => {
        expect(shiftNote(SHIFTED, "Finish resume")).toBe("10 AM's taken by ECON1115 Lecture, so it's at 1:20 PM. Say if you want another time.");
    });
    it("a passed time says so", () => {
        expect(shiftNote("SHIFTED: Reading could not go at 07:30 (that time has passed) — booked 09:05 instead; tell him", "reading")).toBe("7:30 AM has already passed, so it's at 9:05 AM. Say if you want another time.");
    });
    it("other blocks' shifts and no shift give nothing", () => {
        expect(shiftNote("SHIFTED: Dinner could not go at 19:00 (Annika is there) — booked 20:35 instead; tell him", "Finish resume")).toBe("");
        expect(shiftNote("planned Finish resume: 10:00–10:45", "Finish resume")).toBe("");
    });
});
describe("the tomorrow move says why its time changed", () => {
    it.each([
        "move finish resume to tomorrow at 10am, 45 min",
        "put finish resume tmrw at 10am 45 min",
        "shift finish resume to tomorrow morning at 10, 45 minutes",
    ])("%s", async (m) => {
        const exact = await turnWith("21:00", m, SHIFTED);
        expect(exact).toContain("1:20 PM–2:05 PM");
        expect(exact).toContain("10 AM's taken by ECON1115 Lecture, so it's at 1:20 PM. Say if you want another time.");
    });
    it("stays silent when the time held", async () => {
        const exact = await turnWith("21:00", "move finish resume to tomorrow at 10am, 45 min", "Changed Tuesday:\n  planned Finish resume: 10:00–10:45");
        expect(exact).not.toMatch(/taken by|another time/);
    });
});
