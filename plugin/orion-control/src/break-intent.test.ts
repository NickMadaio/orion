// Wave 4, focus (gate run-1031202318 cluster 2): replies come from the session's real output, a break starts nothing, a confession nudges.
import { describe, expect, it } from "vitest";
import { readBreak, runBreak } from "./break-intent.js";
import { readFocusMove, runFocusMove } from "./focus-moves.js";
import { parseSessionJson } from "./session-json.js";

const NOW = new Date(2026, 10, 2, 10, 0);
/** What the real script prints: a plain line first for a sequence, then indented multi-line JSON. */
const pretty = (o: Record<string, unknown>, prefix = "") => `${prefix}${JSON.stringify(o, null, 2)}\n`;
const IDLE = pretty({ ok: true, status: "finished", phase: "abandoned" });
const FOCUS = pretty({ ok: true, status: "running", phase: "focus", task: "econ", remainingSeconds: 1200 });

function session(initial: string, over: Record<string, { stdout: string; code: number }> = {}) {
  const calls: string[][] = [];
  const exec = async (args: string[]) => {
    calls.push(args);
    const cmd = args[0]!;
    if (over[cmd]) return over[cmd]!;
    if (cmd === "status") return { stdout: initial, code: 0 };
    if (cmd === "start") return { stdout: pretty({ ok: true, status: "running", phase: "rest", task: args[1], remainingSeconds: 600 }, "Sequence: 10 min break, 50 min work\n"), code: 0 };
    if (cmd === "break") return { stdout: pretty({ ok: true, status: "running", phase: "rest", remainingSeconds: 600 }), code: 0 };
    return { stdout: pretty({ ok: true, status: cmd === "pause" ? "paused" : "finished" }), code: 0 };
  };
  return { exec, calls };
}

describe("parseSessionJson", () => {
  it("reads indented JSON behind a plain line, and plain JSON", () => {
    expect(parseSessionJson(pretty({ ok: true, status: "running" }, "Sequence: 10 min break\n"))).toMatchObject({ status: "running" });
    expect(parseSessionJson('{"ok":true,"status":"paused"}')).toMatchObject({ status: "paused" });
    expect(parseSessionJson("orion-session: Orion is not running")).toBeNull();
  });
});

describe("readBreak (held-out phrasings)", () => {
  it.each([["ugh i need a break", 10, true], ["gonna grab a 15 min break", 15, false], ["can i have a quick break pls", 10, true], ["need like a half hour break", 30, false], ["taking a 20 minute break", 20, false], ["brain is fried need a five minute break", 5, false]])("%s", (said, minutes, assumed) => {
    expect(readBreak(said)).toMatchObject({ minutes, assumed, restart: false });
  });
  it.each(["take a 10 min break then restart the session", "need a break and then back to it", "taking 15 then resume after"])("restart asked: %s", (said) => {
    expect(readBreak(said.replace("taking 15", "taking a 15 min break"))?.restart).toBe(true);
  });
  it.each(["when is my next break", "i dont need a break", "break down this problem set for me", "lunch break at 1", "whats the break between classes"])("not a break: %s", (said) => {
    expect(readBreak(said)).toBeNull();
  });
});

// Wave 4 review finding 1 supersedes run-1101020721's "a vague break starts the break-then-block sequence": with nothing running that
// started a 50-minute block. A running block is paused (never finished) with a return nudge; nothing running gets the alarm-only reply.
describe("a vague break moves only a block that is running or paused", () => {
  it.each(["need a break", "ok i need a quick break lol", "lemme grab a break", "can i take a break"])("just-ended session: alarm only, %s", async (said) => {
    const s = session(pretty({ ok: true, status: "finished", phase: "abandoned", task: "econ" }));
    const out = await runBreak(readBreak(said)!, { exec: s.exec, now: NOW, mayStart: true });
    expect(s.calls.map((c) => c[0])).toEqual(["status"]);
    expect(out.flow).toBeUndefined();
    expect(out.reminder?.say).toMatch(/^Break till 10:10 AM \(10 minutes is my default[^)]*\)\. I'll nudge you then; then it's back to econ\.$/);
  });
  it("a running block gets the engine's real break: no pause, no reminder", async () => {
    const s = session(FOCUS);
    const out = await runBreak(readBreak("need a break")!, { exec: s.exec, now: NOW, mayStart: true });
    expect(s.calls.map((c) => c[0])).toEqual(["status", "break"]);
    expect(out.reminder).toBeUndefined();
    expect(out.flow).toMatchObject({ outcome: "done" });
    expect((out.flow as { reply: string }).reply).toBe("Break started: 10 minutes, then your next focus block starts by itself.");
  });
  it("a break shorter than the planned one is shortened to what he asked", async () => {
    const s = session(FOCUS);
    const out = await runBreak(readBreak("taking a 5 min break")!, { exec: s.exec, now: NOW, mayStart: true });
    expect(s.calls.map((c) => c[0])).toEqual(["status", "break", "shorten"]);
    expect(s.calls[2]).toEqual(["shorten", "5", "--json"]);
    expect((out.flow as { reply: string }).reply).toBe("Break started: 5 minutes, then your next focus block starts by itself.");
  });
  it("no break planned after this block: it falls back to pause with the return nudge, and says so", async () => {
    const s = session(FOCUS, { break: { stdout: "orion-session: No break is planned after this block.", code: 1 } });
    const out = await runBreak(readBreak("taking a 15 min break")!, { exec: s.exec, now: NOW, mayStart: true });
    expect(s.calls.map((c) => c[0])).toEqual(["status", "break", "pause"]);
    expect(out.reminder?.say).toBe("Paused econ with 20 minutes left. Break till 10:15 AM. I'll nudge you then; say resume and the econ block carries on.");
  });
  it("already on a break: said from the status, nothing changed", async () => {
    const s = session(pretty({ ok: true, status: "running", phase: "rest", remainingSeconds: 300 }));
    const out = await runBreak(readBreak("need a break")!, { exec: s.exec, now: NOW });
    expect(JSON.stringify(out.flow)).toMatch(/already on a break: 5 minutes left/);
    expect(s.calls.map((c) => c[0])).toEqual(["status"]);
  });
  it("status unreadable: does not touch the session or claim its state; only the return nudge", async () => {
    const s = session("", { status: { stdout: "orion-session: Orion is not running", code: 3 } });
    const out = await runBreak(readBreak("need a break")!, { exec: s.exec, now: NOW });
    expect(s.calls.map((c) => c[0])).toEqual(["status"]);
    expect(out.reminder?.say).toMatch(/^I couldn't read your focus session just now, so I haven't touched it\./);
    expect(out.reminder?.say).not.toMatch(/nothing is running/i);
  });
});

describe("a restart he asked for", () => {
  it("nothing running, typed: the break-then-block sequence, read from real (pretty) output", async () => {
    const s = session(IDLE);
    const out = await runFocusMove(readFocusMove("take a 10 min break then restart the session")!, { exec: s.exec, now: NOW, task: "econ", mayStart: true });
    expect(s.calls.map((c) => c[0])).toEqual(["status", "start"]);
    expect(out.flow).toMatchObject({ outcome: "done" });
    expect((out.flow as { reply: string }).reply).toBe("Break till 10:10 AM. Then econ starts again by itself, 50 minutes. Say \"stop the session\" if you're done for now.");
  });
  it("a running session takes its break (never finished)", async () => {
    const s = session(FOCUS);
    await runFocusMove(readFocusMove("take a 10 min break then restart the session")!, { exec: s.exec, now: NOW, mayStart: true });
    expect(s.calls.map((c) => c[0])).toEqual(["status", "break"]);
  });
  it("a start that fails is checked against the session before anything is claimed", async () => {
    const s = session(IDLE, { start: { stdout: "orion-session: Orion is not running", code: 3 } });
    const out = await runFocusMove(readFocusMove("take a 10 min break then restart the session")!, { exec: s.exec, now: NOW, task: "econ", mayStart: true });
    expect(s.calls.map((c) => c[0])).toEqual(["status", "start", "status"]);
    expect(JSON.stringify(out.flow)).toMatch(/The break timer didn't start\. No session is running now\./);
  });
});

describe("a distraction confession nudges, it does not start", () => {
  it.each(["been scrolling reels for an hour when i should be studying", "i keep going on youtube instead of working", "im on instagram again"])("running session: %s", async (said) => {
    const s = session(FOCUS);
    const move = readFocusMove(said)!;
    expect(move.kind).toBe("doomscroll");
    const out = await runFocusMove(move, { exec: s.exec, now: NOW });
    expect(s.calls.map((c) => c[0])).toEqual(["status"]);
    expect(JSON.stringify(out.flow)).toMatch(/Your econ session is still running, 20 minutes left\. Put \w+ down/);
  });
  it("nothing running: says so from the status, nudges to the block, offers (never starts)", async () => {
    const s = session(IDLE);
    const out = await runFocusMove(readFocusMove("im on tiktok instead of studying")!, { exec: s.exec, now: NOW, task: "CS2100 problem set" });
    expect(s.calls.map((c) => c[0])).toEqual(["status"]);
    expect(out.pendingSession).toBe("start a 25 min focus session on CS2100 problem set");
    expect(JSON.stringify(out.flow)).toMatch(/Put tiktok down and get back to CS2100 problem set\. No focus session is running right now/);
  });
  it("status unreadable: only the nudge, no claim about the session", async () => {
    const s = session("", { status: { stdout: "orion-session: Orion is not running", code: 3 } });
    const out = await runFocusMove(readFocusMove("im on tiktok instead of studying")!, { exec: s.exec, now: NOW });
    expect(out.flow).toMatchObject({ text: "Put tiktok down and get back to your block." });
  });
});
