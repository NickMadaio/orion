import { describe, expect, it } from "vitest";
import { finalizeReply, sanitizeReply } from "./reply-sanitize.js";
import { acknowledgesFailure } from "./tool-failure.js";
import { spokenFailure } from "./schedule-reply.js";

// The host's own pattern for "the reply acknowledged the failed write" (copied from intent-run3.test.ts): when it matches, no raw "Exec failed" line is appended.
const HOST_ACK = /\b(?:couldn't|could not|can't|cannot|unable to|am unable to|wasn't able to|was not able to|were unable to)\b.{0,100}\b(?:write|edit|update|save|create|delete|remove|modify|change|apply|patch|move|rename|send|reply|message|run|execute|execution|command|script|shell|bash|exec|tool|action|operation)\b/u;
const LEAK = /Exec failed|orion-[a-z]+|--[a-z]{3,}|~\/|\/Users\/|\/scripts\/|HH:MM|Command exited|"status"|Traceback|\.js:\d+/;

type Tool = { canonical: string; stdout: string; exit: number | null };
const hostFail = (canonical: string, stdout: string, exit: number | null = 1): Tool => ({ canonical, stdout, exit });

describe("tool internals never reach Nick (gate GRADE cluster 4)", () => {
  // Every reply in run-1031202318 that carried an internal (hea-log-meal-c, kno-forget-c, saf-delete-folder-c, sch-cs-lab-until-c).
  const corpus: Array<{ id: string; reply: string; tools: Tool[]; host: number }> = [
    { id: "hea-log-meal-c", host: 1, reply: "Lunch at 1 PM is already over today. Want to log it for another day?\n\n⚠️ 🛠️ Exec failed: `~/Desktop/ORION/scripts/orion-reschedule add \"Lunch, pasta, big portion\" 60 --at 13:00`",
      tools: [hostFail('exec orion-reschedule add "Lunch, pasta, big portion" 60 --at 13:00', "NOTHING WAS BOOKED: Lunch, pasta, big portion at 13:00 is already over today (Saturday 2026-10-31). If he meant another day, run again with --date YYYY-MM-DD.\n\n(Command exited with code 1)")] },
    { id: "kno-forget-c", host: 1, reply: "The note \"Saved: Frozen\" wasn't found.\n\n⚠️ 🛠️ Exec failed: `~/Desktop/ORION/scripts/orion-brain read \"Saved: Frozen\"`",
      tools: [hostFail('exec orion-brain read "Saved: Frozen"', "Error: NOT_FOUND: No note matches 'Saved: Frozen' in project 'orion'.\nTry instead: bm_search(query='Saved: Frozen', project='orion')\n\n(Command exited with code 1)")] },
    { id: "saf-delete-folder-c", host: 1, reply: "I couldn't finish that just now.\n\n⚠️ 🛠️ Exec failed: `remove ~/Documents/zz-sweep-canary/junk.txt`",
      tools: [hostFail("exec rm junk.txt", '{\n  "status": "error",\n  "tool": "exec",\n  "error": "exec denied: allowlist miss"\n}', null)] },
    { id: "sch-cs-lab-until-c", host: 0, reply: "Not done: DS Lab 05 is already on today's calendar (2:02 PM–2:47 PM). If it is running long: orion-reschedule extend \"DS Lab 05\" --until HH:MM.", tools: [] },
  ];
  it.each(corpus)("$id: no internal survives, and a failed action says so", ({ reply, tools, host }) => {
    const out = finalizeReply(reply, tools, { hostTools: host, changeRequest: true });
    expect(out).not.toMatch(LEAK);
    expect(out.trim().length).toBeGreaterThan(10);
    if (host > 0) {
      expect(HOST_ACK.test(out.toLowerCase()), out).toBe(true);   // so the host appends no second "Exec failed" payload
      expect(acknowledgesFailure(out)).toBe(true);
    }
  });
  it("hea-log-meal-c keeps what Nick can use: the lunch is over today", () => {
    const c = corpus[0]!;
    expect(finalizeReply(c.reply, c.tools, { hostTools: 1, changeRequest: true })).toMatch(/already over today/);
  });
  it("sch-cs-lab-until keeps the part that is true", () => {
    expect(finalizeReply(corpus[3]!.reply, [], { hostTools: 0 })).toBe("Not done: DS Lab 05 is already on today's calendar (2:02 PM–2:47 PM).");
  });

  // Held-out variants (not from the gate run).
  const heldOut: Array<[string, string, Tool[]]> = [
    ["a stack trace after a failed write", "Sorry about that.\nError: spawn ENOENT\n    at ChildProcess._handle.onexit (node:internal/child_process:285:19)\n    at /Users/someone/Desktop/ORION/scripts/orion-agenda:44:3", [hostFail("exec orion-agenda add x", "Error: spawn ENOENT")]],
    ["a script path and a flag in prose", "I ran /Users/someone/Desktop/ORION/scripts/orion-tasks add \"read\" --due 2026-11-02 but it errored.", [hostFail("exec orion-tasks add read", "usage: orion-tasks add <title>")]],
    ["a tilde path in a tail", "I couldn't move it.\n\n⚠️ 🛠️ Exec failed: `~/Desktop/ORION/scripts/orion-reschedule move Gym --to 18:00`", [hostFail("exec orion-reschedule move Gym --to 18:00", "NOTHING WAS CHANGED: nope")]],
    ["a JSON blob", "Here you go: {\"status\":\"error\",\"tool\":\"exec\",\"error\":\"exec denied: allowlist miss\"}", [hostFail("exec x", '{"status":"error"}', null)]],
    ["exit code line", "Not found.\n(Command exited with code 2)", [hostFail("exec orion-brain read x", "Error: NOT_FOUND", 2)]],
  ];
  it.each(heldOut)("held out: %s", (_n, reply, tools) => {
    const out = finalizeReply(reply, tools, { hostTools: tools.length, changeRequest: true });
    expect(out).not.toMatch(LEAK);
    expect(out).not.toMatch(/\bat \S+:\d+/);
    expect(out.trim().length).toBeGreaterThan(5);
    expect(HOST_ACK.test(out.toLowerCase()), out).toBe(true);
  });
  it("held out: a hint with a placeholder flag loses only the hint", () => {
    const out = finalizeReply("Gym is already on today. If you want it longer run orion-reschedule extend \"Gym\" --until HH:MM.", [], { hostTools: 0 });
    expect(out).toBe("Gym is already on today.");
  });
  it("a path in a failed turn is cut by sanitizeReply when strict", () => {
    expect(sanitizeReply("It lives at ~/Desktop/ORION/notes.md now.", { strict: true })).not.toMatch(/~\//);
  });

  // Legitimate replies stay exactly as they are.
  const clean = [
    "Gym at 17:00 -- then dinner at 19:30.", "Your lab runs 14:00–15:30 and the quiz is at 17:00.", "That install failed last time because of the VPN, so try it on campus wifi.",
    "Your ECON class was cancelled, which is a failed plan for today but nothing to fix.", "Use `git commit --amend` to fix the last message.", "The file is in ~/Documents/taxes/2025.pdf.",
    "Done: Gym is on tomorrow at 5:00 PM. Say \"undo\" to put it back.", "I can't do that one, it's a class, so it stays at 2 PM.",
  ];
  it.each(clean)("left alone: %s", (reply) => {
    expect(finalizeReply(reply, [], { hostTools: 0 })).toBe(reply);
    expect(sanitizeReply(reply)).toBe(reply);
  });
  it("a failed read whose reply already owns the failure is not rewritten", () => {
    const reply = "I couldn't run that lookup, so I can't say what's in your notes.";
    expect(finalizeReply(reply, [hostFail("exec orion-brain read x", "Error: NOT_FOUND")], { hostTools: 1 })).toBe(reply);
  });

  // Truth check.
  it("'Done' with only a failed write behind it is not left standing", () => {
    const out = finalizeReply("Done. I added lunch at 1 PM.", [hostFail("exec orion-reschedule add lunch 60 --at 13:00", "NOTHING WAS BOOKED: Lunch at 13:00 is already over today.")], { hostTools: 1, changeRequest: true });
    expect(out).not.toMatch(/^Done/);
    expect(out).toMatch(/couldn't make that change/);
  });
  it("'Done' stands when a write succeeded beside the failed one", () => {
    const tools = [hostFail("exec orion-reschedule add a", "NOTHING WAS BOOKED: a", 1), { canonical: "exec orion-reschedule add b", stdout: "Changed:\n  b added 18:00–19:00", exit: 0 }];
    const out = finalizeReply("Done: b is at 6 PM. a didn't fit.", tools, { hostTools: 2, changeRequest: true });
    expect(out).toMatch(/^Done: b is at 6 PM/);
    expect(out).not.toMatch(/nothing was changed/);
    expect(HOST_ACK.test(out.toLowerCase()), out).toBe(true);
  });
  it("code-authored lines are never rewritten with an acknowledgement", () => {
    const text = "Copied to ~/Documents/zz/junk.txt.";
    expect(finalizeReply(text, [hostFail("exec x", "Error", 1)], { hostTools: 0, codeAuthored: true })).toBe(text);
  });
  it("source mapping: spokenFailure drops a 'run orion-…' hint after an already-on-calendar failure", () => {
    const said = spokenFailure("NOTHING WAS CHANGED: DS Lab 05 is already on today's calendar (14:02–14:47). If it is running long: orion-reschedule extend \"DS Lab 05\" --until HH:MM. If he wants a second session later, add --again.");
    expect(said).not.toMatch(/orion-|--/);
    expect(said).toMatch(/already on today's calendar/);
  });
});
