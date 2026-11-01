// Wave 6 (gate run-1101003318, loop-reply-bed-v / -c): past his bedtime, with no bedtime nudge ORION can bind the reply to (the push is
// stale, the label never came), "ok one more thing" got "What is the one more thing?" and "5 more min" became a "start focus" alarm.
// His bedtime (life-config.json) and the clock are the state: a stall or "going to bed" after it is the bedtime reply. Through the
// routing hooks, over a fake calendar. Phrasings marked "held out" do not appear in the gate scenarios. No real paths.
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { bedtimeFromState, pastBedtime } from "./bed-state.js";
import { readBedStall } from "./pending-reply-bed.js";
const APP = `[Orion app context — factual state supplied by the native app]
Focus session: inactive.

User message:
`;
const IN_SESSION = APP.replace("Focus session: inactive.", "Focus session: active — CS lab, 22 min left.");
const b = (title, start, end, fixed = false, kind) => ({ title, start, end, fixed, ...(kind ? { kind } : {}) });
const at = (d, hhmm) => { const [h, m] = hhmm.split(":").map(Number); const [y, mo, da] = d.split("-").map(Number); return new Date(y, mo - 1, da, h, m); };
const TUE = () => ({ date: "2026-11-03", now: null, blocks: [b("CS2100", "09:00", "10:30", true, "class"), b("ECON1115", "11:00", "12:30", true, "class"), b("Gym", "17:00", "18:30")] });
const MON = () => ({ date: "2026-11-02", now: null, blocks: [b("Gym", "17:00", "18:30"), b("Side project", "19:30", "20:30")] });
function harness(now, stateDir) {
    const handlers = new Map();
    const flows = [];
    const checkins = [];
    const wakes = [];
    const clock = { now };
    registerLocalRouting({ on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) }, {
        warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "w6b-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Tue 00:43", now: () => clock.now,
        stateDir,
        decideImpl: async () => ({ move: "ask", answer: "What is the one more thing?" }),
        scheduleFlow: async (message) => { flows.push(message); return { outcome: "done", calls: ["exec orion-reschedule"], outputs: ["Done."], marks: ["m"], reply: "Done." }; },
        readDayJson: async (args) => (args.includes("tomorrow") || clock.now.getHours() < 5 ? TUE() : MON()),
        checkinRun: async (args) => { checkins.push(args); return { stdout: "ok ci-abc123", code: 0 }; },
        wakeExec: async (args) => { wakes.push(args); return { stdout: "Sent to Nick's iPhone: alarm for Tuesday 08:00.", code: 0 }; },
    });
    const fire = async (name, event, ctx) => { const out = []; for (const fn of handlers.get(name) ?? [])
        out.push(await fn(event, ctx)); return out; };
    let n = 0;
    const turn = async (prompt, session = "w6b") => {
        const ctx = { runId: `w6b${n += 1}-${Math.random()}`, sessionKey: `agent:main:orion-chat-${session}` };
        await fire("before_model_resolve", { prompt }, ctx);
        const [direct] = (await fire("before_agent_reply", { prompt }, ctx));
        if (direct?.reply?.text)
            return `DRAFT: ${direct.reply.text}`;
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        return built?.appendContext?.match(/Your whole reply must be exactly: ([\s\S]*)\]$/)?.[1] ?? `WORKER: ${built?.systemPrompt?.slice(0, 80) ?? ""}`;
    };
    return { turn, flows, checkins, wakes, clock };
}
/** A state dir whose only bedtime push is from the morning (outside every window), and a bedtime of `bed`. */
function lateState(bed = "00:00") {
    const dir = mkdtempSync(join(tmpdir(), "w6b-state-"));
    writeFileSync(join(dir, "life-config.json"), JSON.stringify({ bedtime: bed }));
    appendFileSync(join(dir, "outreach.jsonl"), `${JSON.stringify({ id: "o1", text: "Still up at 12:43 AM.", at: at("2026-11-02", "09:00").toISOString(), channel: "mac-bubble" })}\n`);
    return dir;
}
const adds = (checkins) => checkins.filter((a) => a[0] === "add" || a[0] === "defer");
describe("past bedtime with no nudge in reach, his stall is the bedtime reply", () => {
    it("'ok one more thing' → one thing, a stated check-back; then 'fine going to bed now' → goodnight with the alarm and CS2100 protected", async () => {
        const h = harness(at("2026-11-03", "00:43"), lateState());
        const first = await h.turn(`${APP}ok one more thing`);
        expect(first).toBe("Okay — one more thing, 15 min max (my limit, since it's past your bedtime), then bed. I'll check at 12:58 AM. CS2100 at 9:00 AM stays.");
        expect(adds(h.checkins)).toEqual([["add", "15", "bed", "--because", "ok one more thing"]]);
        h.clock.now = at("2026-11-03", "00:45");
        const second = await h.turn(`${APP}fine going to bed now`);
        expect(second).toBe("Good — goodnight. Your alarm's on automatic, so it goes off before CS2100. CS2100 at 9:00 AM stays, nothing before it.");
        expect(adds(h.checkins)).toHaveLength(1);
        expect(h.flows).toEqual([]);
    });
    it("'5 more min' → honours the five minutes with one check at +5, never a focus nudge", async () => {
        const h = harness(at("2026-11-03", "00:43"), lateState());
        expect(await h.turn(`${APP}5 more min`)).toBe("Okay — 5 min, then bed. I'll check at 12:48 AM. CS2100 at 9:00 AM stays.");
        expect(adds(h.checkins)).toEqual([["add", "5", "bed", "--because", "staying up"]]);
        expect(h.flows).toEqual([]);
    });
    it.each(["lemme finish one last video", "just one more round", "omg ok 1 more ep", "gimme 10 more mins"])("held out: '%s' at 1:10 AM is bound to bed", async (said) => {
        const h = harness(at("2026-11-03", "01:10"), lateState());
        expect(await h.turn(`${APP}${said}`)).toMatch(/^Okay — .*then bed\. I'll check at /);
        expect(h.flows.every((f) => /\bnap\b/.test(f))).toBe(true); // a short night may get tomorrow's nap; nothing else is written
    });
    it("before his bedtime, '5 more min' is not read as bed", async () => {
        const h = harness(at("2026-11-02", "21:10"), lateState());
        expect(await h.turn(`${APP}5 more min`)).not.toMatch(/then bed/);
    });
    it("a focus session running: '5 more min' is the session's, not bed", async () => {
        const h = harness(at("2026-11-03", "00:43"), lateState());
        expect(await h.turn(`${IN_SESSION}5 more min`)).not.toMatch(/then bed/);
    });
    it("a learned evening bedtime counts: 23:30 bedtime, 23:50 'one more thing' is bed", async () => {
        const h = harness(at("2026-11-02", "23:50"), lateState("23:30"));
        expect(await h.turn(`${APP}ok wait one more thing`)).toMatch(/^Okay — one more thing, 15 min max/);
    });
});
describe("pure pieces", () => {
    it("pastBedtime reads the configured bedtime and ends the night at 5 AM", () => {
        const dir = lateState("23:30");
        expect(pastBedtime(dir, at("2026-11-02", "23:40"))).toBe(true);
        expect(pastBedtime(dir, at("2026-11-03", "02:00"))).toBe(true);
        expect(pastBedtime(dir, at("2026-11-03", "06:00"))).toBe(false);
        expect(pastBedtime(dir, at("2026-11-02", "22:00"))).toBe(false);
        expect(pastBedtime(mkdtempSync(join(tmpdir(), "w6b-none-")), at("2026-11-03", "00:30"))).toBe(true); // the default bedtime is midnight
    });
    it("readBedStall: 'one more X' and 'finish this one thing' are a stall; a plan or a question is not", () => {
        expect(readBedStall("ok one more thing")).toEqual({ kind: "defer", stall: true });
        expect(readBedStall("need to finish this one bit")).toEqual({ kind: "defer", stall: true });
        expect(readBedStall("add one more gym session tomorrow")).toBeUndefined();
        expect(readBedStall("can you do one more thing for me?")).toBeUndefined();
    });
    it("bedtimeFromState never binds a request or a hush", () => {
        const dir = lateState();
        const now = at("2026-11-03", "00:43");
        expect(bedtimeFromState({ message: "move gym to 6 tomorrow", now, stateDir: dir, focusActive: false })).toBeUndefined();
        expect(bedtimeFromState({ message: "shush one more thing", now, stateDir: dir, focusActive: false })).toBeUndefined();
        expect(bedtimeFromState({ message: "5 more min", now, stateDir: dir, focusActive: false })?.offer).toEqual({ kind: "bedtime" });
    });
});
