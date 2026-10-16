import { describe, expect, it } from "vitest";
import { isSessionStart, parseSessionRequest, runSessionFlow, type SessionExec } from "./session-flow.js";

// The words Nick actually said on 2026-10-15, when the 9B answered "I've started a focus
// session for you" and called nothing.
const SAID = "Can you go ahead and, uh, start a focus session? I wanna do some work.";
const STITCHED = `${SAID} Make I'll make sure I can use Claude, ChatGPT, Terminal, and Safari. I think those are the main ones. And music.`;

const IDS: Record<string, string> = { Claude: "com.anthropic.claudefordesktop", ChatGPT: "com.openai.codex", Terminal: "com.apple.Terminal", Safari: "com.apple.Safari", Music: "com.apple.Music" };
const resolveApp = async (name: string) => IDS[name] ?? null;

const RUNNING = JSON.stringify({ ok: true, status: "running", phase: "focus", blockNumber: 1, totalBlocks: 3, remainingSeconds: 3000, task: "Focus" });
const NONE = JSON.stringify({ ok: true, status: "finished" });

/** A fake orion-session: records every argv and answers like the real one. */
function fakeSession(opts: { status?: string; start?: { stdout: string; code: number }; arm?: { stdout: string; code: number } } = {}) {
  const calls: string[][] = [];
  const exec: SessionExec = async (args) => {
    calls.push(args);
    if (args[0] === "status") return { stdout: opts.status ?? NONE, code: 0 };
    if (args[0] === "start") return opts.start ?? { stdout: RUNNING, code: 0 };
    if (args[0] === "arm") return opts.arm ?? { stdout: JSON.stringify({ ok: true, enforcement: "gentle" }), code: 0 };
    return { stdout: "", code: 2 };
  };
  return { exec, calls };
}

describe("session flow — recognising a start request", () => {
  it("knows his real sentence, and the ordinary ways of saying it", () => {
    for (const m of [SAID, "start a focus session", "begin a focus block for an hour", "kick off a work session", "lock me in for 90 minutes", "start focus mode"]) {
      expect(isSessionStart(m), m).toBe(true);
    }
  });

  it("leaves questions, endings and calendar talk alone", () => {
    for (const m of ["how long is left on my focus session?", "end my focus session", "stop the session", "pause focus", "put a focus block on my calendar at 3", "what did I focus on yesterday"]) {
      expect(isSessionStart(m), m).toBe(false);
    }
  });

  it("reads length, end time, task and the apps he names", () => {
    expect(parseSessionRequest("start a focus session for 90 minutes")).toMatchObject({ minutes: 90 });
    expect(parseSessionRequest("start a focus session for an hour and a half")).toMatchObject({ minutes: 90 });
    expect(parseSessionRequest("start a focus session for 2 hours")).toMatchObject({ minutes: 120 });
    expect(parseSessionRequest("start a focus session until 8:30 pm")).toMatchObject({ until: "20:30" });
    expect(parseSessionRequest("start a focus session to work on the essay")).toMatchObject({ task: "the essay" });
    expect(parseSessionRequest(SAID)).toMatchObject({ task: "Focus", apps: [] });
    expect(parseSessionRequest(STITCHED)?.apps).toEqual(["Claude", "ChatGPT", "Terminal", "Safari", "Music"]);
  });
});

describe("session flow — doing it", () => {
  it("starts the session through orion-session and says only what the reply shows", async () => {
    const s = fakeSession();
    const flow = await runSessionFlow({ message: SAID, exec: s.exec, resolveApp });
    expect(s.calls).toEqual([["status", "--json"], ["start", "Focus", "--json"]]);
    expect(flow).toMatchObject({ outcome: "done" });
    if (flow.outcome !== "done") throw new Error("unreachable");
    expect(flow.reply).toMatch(/focus session is running/i);
    expect(flow.reply).toMatch(/block 1 of 3/);
    expect(flow.reply).toMatch(/50 minutes/);
    expect(flow.calls).toEqual(["exec orion-session start Focus --json"]);
  });

  it("allows the apps he named, by bundle id, and says which ones", async () => {
    const s = fakeSession();
    const flow = await runSessionFlow({ message: STITCHED, exec: s.exec, resolveApp });
    expect(s.calls.at(-1)).toEqual(["arm", "--level", "gentle", "--allow", Object.values(IDS).join(","), "--json"]);
    if (flow.outcome !== "done") throw new Error("expected done");
    expect(flow.reply).toMatch(/Claude, ChatGPT, Terminal, Safari and Music are allowed/);
  });

  it("names an app it could not find rather than pretending it is allowed", async () => {
    const s = fakeSession();
    const flow = await runSessionFlow({ message: "start a focus session, I need Safari and Figmaa", exec: s.exec, resolveApp });
    expect(s.calls.at(-1)).toEqual(["arm", "--level", "gentle", "--allow", "com.apple.Safari", "--json"]);
    if (flow.outcome !== "done") throw new Error("expected done");
    expect(flow.reply).toMatch(/Safari is allowed/);
    expect(flow.reply).toMatch(/couldn't find Figmaa/);
  });

  it("the second half of a cut-off request only adds the apps to the session the first half started", async () => {
    const s = fakeSession({ status: RUNNING });
    const flow = await runSessionFlow({ message: STITCHED, exec: s.exec, resolveApp });
    expect(s.calls.map((c) => c[0])).toEqual(["status", "arm"]);
    if (flow.outcome !== "done") throw new Error("expected done");
    expect(flow.reply).toMatch(/already running/);
    expect(flow.reply).toMatch(/are allowed/);
  });

  it("never re-arms a session whose enforcement is already on: arm replaces the list and the level", async () => {
    const armed = JSON.stringify({ ok: true, status: "running", phase: "focus", blockNumber: 1, totalBlocks: 3, remainingSeconds: 2460, enforcement: "guided" });
    const s = fakeSession({ status: armed });
    const flow = await runSessionFlow({ message: STITCHED, exec: s.exec, resolveApp });
    expect(s.calls.map((c) => c[0])).toEqual(["status"]);
    expect(flow).toMatchObject({ outcome: "say" });
    if (flow.outcome !== "say") throw new Error("expected say");
    expect(flow.text).toMatch(/already running.*41 minutes left/);
    expect(flow.text).toMatch(/didn't change which apps are allowed/);
  });

  it("an already-running session is reported, not restarted", async () => {
    const s = fakeSession({ status: RUNNING });
    const flow = await runSessionFlow({ message: SAID, exec: s.exec, resolveApp });
    expect(s.calls.map((c) => c[0])).toEqual(["status"]);
    expect(flow).toMatchObject({ outcome: "say" });
    if (flow.outcome !== "say") throw new Error("expected say");
    expect(flow.text).toMatch(/already running.*50 minutes left/);
  });

  it("a failed start says it failed and why — never 'started'", async () => {
    const s = fakeSession({ start: { stdout: "orion-session: Orion is not running — start the app first", code: 1 } });
    const flow = await runSessionFlow({ message: SAID, exec: s.exec, resolveApp });
    expect(flow).toMatchObject({ outcome: "say" });
    if (flow.outcome !== "say") throw new Error("expected say");
    expect(flow.text).toMatch(/couldn't start/i);
    expect(flow.text).toMatch(/Orion is not running/);
    expect(flow.text).not.toMatch(/session (has )?started|session is running/i);
  });

  it("a session that starts but whose app list fails to arm says so", async () => {
    const s = fakeSession({ arm: { stdout: "orion-session: enforcer refused", code: 1 } });
    const flow = await runSessionFlow({ message: STITCHED, exec: s.exec, resolveApp });
    if (flow.outcome !== "done") throw new Error("expected done");
    expect(flow.reply).toMatch(/focus session is running/i);
    expect(flow.reply).toMatch(/couldn't set the allowed apps/);
    expect(flow.reply).not.toMatch(/are allowed/);
  });

  it("passes length and end time through to the script", async () => {
    const a = fakeSession();
    await runSessionFlow({ message: "start a focus session for 90 minutes on the essay", exec: a.exec, resolveApp });
    expect(a.calls[1]).toEqual(["start", "the essay", "--minutes", "90", "--json"]);
    const b = fakeSession();
    await runSessionFlow({ message: "start a focus session until 8 pm", exec: b.exec, resolveApp });
    expect(b.calls[1]).toEqual(["start", "Focus", "--until", "20:00", "--json"]);
  });
});

// Live sweep 2026-10-15: q051 "focus mode on for an hour, leetcode" became a calendar block, and q054
// "start focus for the resume, like 25 min" was refused because "resume" read as resuming a session —
// the worker then called a tool named orion-session ten times.
describe("session flow — the sweep's missed starts (q051, q054)", () => {
  it("'focus mode on' is a start, and 'the resume' is a task, not resuming a session", () => {
    expect(isSessionStart("focus mode on for an hour, leetcode")).toBe(true);
    expect(isSessionStart("start focus for the resume, like 25 min")).toBe(true);
    for (const m of ["resume my session", "resume focus", "resume", "ok resume it", "can you resume the timer"]) expect(isSessionStart(m), m).toBe(false);
  });

  it("reads 'like 25 min' and 'for the resume'", () => {
    expect(parseSessionRequest("start focus for the resume, like 25 min")).toMatchObject({ task: "the resume", minutes: 25 });
    expect(parseSessionRequest("start a focus session for the next hour")).toMatchObject({ task: "Focus" });
  });

  it("takes the front desk's task and length when his words name none, and its start only when nothing rules it out", async () => {
    expect(parseSessionRequest("focus mode on for an hour, leetcode", { task: "leetcode", minutes: 90 })).toMatchObject({ task: "leetcode", minutes: 60 });
    expect(parseSessionRequest("lock in, 25", { start: true, task: "leetcode", minutes: 25 })).toMatchObject({ task: "leetcode", minutes: 25 });
    expect(parseSessionRequest("resume my session", { start: true })).toBeNull();
    expect(parseSessionRequest("put a focus block on my calendar at 3", { start: true })).toBeNull();
    const s = fakeSession();
    await runSessionFlow({ message: "focus mode on for an hour, leetcode", hint: { task: "leetcode" }, exec: s.exec, resolveApp });
    expect(s.calls[1]).toEqual(["start", "leetcode", "--minutes", "60", "--json"]);
  });
});

describe("session start vs reminders (review, 2026-10-16)", () => {
  it("'remind me to start work in 20 min' is a reminder, not a session start", () => {
    for (const m of ["remind me to start work in 20 min", "remind me in 10 min to start my focus session", "ping me to start studying", "nudge me to begin a focus block"]) expect(isSessionStart(m), m).toBe(false);
    expect(isSessionStart("start a focus session")).toBe(true);
  });
});
