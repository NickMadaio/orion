// Live 11-05 13:05: ORION asked to save a spot; he answered; ORION asked a follow-up; his "yes" met nothing pending. A thread ORION starts keeps its thread.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";

type H = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
const OUTREACH = "You've been here a while - want me to save this spot? What is it?";
const withOutreach = (said: string) => `[ORION context: 1 min ago you asked "${OUTREACH}" (info)]\n\n${said}`;

function world(desk: (m: string) => unknown = () => ({ move: "escalate", tier: "standard" })) {
  const handlers = new Map<string, H[]>(); const placeCalls: string[][] = []; let n = 0; let t = new Date(2026, 10, 5, 13, 6).getTime();
  const saved = new Set<string>(["home"]); const aliases = new Map<string, string[]>();
  registerLocalRouting({ on: (nm: string, fn: H) => handlers.set(nm, [...(handlers.get(nm) ?? []), fn]) } as never, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "pt-")), "r.jsonl"), stateDir: mkdtempSync(join(tmpdir(), "pt2-")), clock: () => "Thu 13:06", now: () => new Date(t), brainSearch: async () => "",
    decideImpl: async (i: { message: string }) => desk(i.message) as never, scheduleFlow: async () => ({ outcome: "fallback", reason: "t" }),
    placeRun: async (a: string[]) => { placeCalls.push(a);
      if (a[1] === "set") { saved.add(a[2]!); const al = a.flatMap((x, i) => (a[i - 1] === "--alias" ? [x] : [])); if (al.length) aliases.set(a[2]!, [...(aliases.get(a[2]!) ?? []), ...al]); return { stdout: `saved ${a[2]}`, code: 0 }; }
      if (a[1] === "alias") { aliases.set(a[2]!, [...(aliases.get(a[2]!) ?? []), a[4]!]); return { stdout: "added", code: 0 }; }
      return { stdout: [...saved].map((id) => `${id}\t${id}\tother\t120 m\tnick\t${(aliases.get(id) ?? []).join(",")}`).join("\n"), code: 0 }; } } as never);
  const fire = async (nm: string, e: Record<string, unknown>, ctx: Record<string, unknown>) => { const out = []; for (const fn of handlers.get(nm) ?? []) out.push(await fn(e, ctx)); return out; };
  const turn = async (prompt: string, key = "agent:main:orion-app-v2", workerSays?: string, clean = prompt.replace(/^\[ORION context:[^\]]*\]\n\n/, "")) => {
    t += 12_000; const ctx = { runId: `pt-${n++}`, sessionKey: key };
    await fire("before_model_resolve", { prompt }, ctx);
    const [direct] = (await fire("before_agent_reply", { cleanedBody: clean }, ctx)) as Array<{ reply?: { text?: string } } | undefined>;
    const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ systemPrompt?: string; appendContext?: string } | undefined>;
    const heard = direct?.reply?.text ?? /exactly: ([\s\S]*)\]$/.exec(built?.appendContext ?? "")?.[1] ?? "";
    await fire("before_agent_finalize", { runId: ctx.runId, lastAssistantMessage: heard || workerSays || "ok", messages: [] }, ctx);
    return { heard, appended: built?.appendContext ?? "", prompt: built?.systemPrompt ?? "" };
  };
  return { turn, placeCalls };
}

describe("his exact sequence (13:05-13:06)", () => {
  it("the proactive question, his answer: the place is saved and read back, no second question", async () => {
    const w = world(() => ({ move: "answer", answer: "Got it, Chapter Spitalfields. Want me to save that spot for you?" }));
    const r = await w.turn(withOutreach('this is Chapter Spitalfields (i call it "spit"). i go here to do work and to see avery'));
    expect(r.heard).toBe('Saved "Chapter Spitalfields" (spit) as a place.');
    expect(w.placeCalls[0]).toEqual(["place", "set", "chapter-spitalfields", "--here", "--name", "Chapter Spitalfields", "--kind", "other", "--source", "nick-confirmed", "--alias", "spit"]);
    expect(w.placeCalls[1]).toEqual(["place", "list"]);
  });
  it("the follow-up question the model asked is the pending item: his yes saves that place", async () => {
    // the desk drafted the follow-up (no outreach context on this turn), then he says yes
    const w = world((m) => (m === "yes" ? { move: "escalate", tier: "standard" } : { move: "answer", answer: "Got it, Chapter Spitalfields. Want me to save that spot for you?" }));
    const first = await w.turn("im at chapter spitalfields now");
    expect(first.heard).toMatch(/save that spot/);
    const r = await w.turn("yes");
    expect(r.heard).toBe('Saved "Chapter Spitalfields" as a place.');
    expect(w.placeCalls.some((a) => a[1] === "set" && a[2] === "chapter-spitalfields")).toBe(true);
  });
  it("on another phone key the yes still finds the thread", async () => {
    const w = world((m) => (m === "yes" ? { move: "escalate", tier: "standard" } : { move: "answer", answer: "Got it, Chapter Spitalfields. Want me to save that spot for you?" }));
    await w.turn("im at chapter spitalfields now", "agent:main:orion-chat-a");
    const r = await w.turn("yeah", "agent:main:orion-chat-b");
    expect(r.heard).toBe('Saved "Chapter Spitalfields" as a place.');
  });
  it("a yes with no name known asks for the name, and the next answer is the name", async () => {
    const w = world();
    const first = await w.turn(withOutreach("yes"));
    expect(first.heard).toBe("Sure. What should I call it?");
    expect(w.placeCalls).toEqual([]);
    const second = await w.turn("Spit", "agent:main:orion-chat-b");
    expect(second.heard).toBe('Saved "Spit" as a place.');
  });
  it.each(["nah", "no thanks", "not now"])("%s declines and writes nothing", async (said) => {
    const w = world();
    const r = await w.turn(withOutreach(said));
    expect(r.heard).toBe("Okay, I won't save it.");
    expect(w.placeCalls).toEqual([]);
  });
  it.each(["it's the library", "its called Barbican Centre", "this is my gran's flat", "call it The Lab", "Costa on the high street"])("%s is a name", async (said) => {
    const w = world();
    const r = await w.turn(withOutreach(said));
    expect(r.heard).toMatch(/^Saved ".+" as a place\.$/);
  });
  it("an unrelated message during the open question is not swallowed", async () => {
    const w = world();
    const r = await w.turn(withOutreach("whats the weather tomorrow"));
    expect(r.heard).not.toMatch(/Saved/);
    expect(w.placeCalls).toEqual([]);
  });
  it("a place that did not read back is never reported saved", async () => {
    const handlers = new Map<string, H[]>();
    registerLocalRouting({ on: (nm: string, fn: H) => handlers.set(nm, [...(handlers.get(nm) ?? []), fn]) } as never, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "pt3-")), "r.jsonl"), clock: () => "Thu 13:06", now: () => new Date(2026, 10, 5, 13, 6), brainSearch: async () => "",
      decideImpl: async () => ({ move: "escalate", tier: "standard" }) as never, scheduleFlow: async () => ({ outcome: "fallback", reason: "t" }),
      placeRun: async (a: string[]) => (a[1] === "set" ? { stdout: "no location sample", code: 1 } : { stdout: "", code: 0 }) } as never);
    const ctx = { runId: "pt-x", sessionKey: "agent:main:orion-app-v2" };
    const fire = async (nm: string, e: Record<string, unknown>) => { const out = []; for (const fn of handlers.get(nm) ?? []) out.push(await fn(e, ctx)); return out; };
    const prompt = withOutreach("it's the library");
    await fire("before_model_resolve", { prompt });
    const [direct] = (await fire("before_agent_reply", { cleanedBody: "it's the library" })) as Array<{ reply?: { text?: string } } | undefined>;
    expect(direct?.reply?.text).toMatch(/couldn't save that place \(no location sample\)/);
  });
});

describe("aliases in the same thread", () => {
  it("'it's chapter spitalfields, or spit for short' saves both", async () => {
    const w = world();
    const r = await w.turn(withOutreach("it's chapter spitalfields, or spit for short"));
    expect(r.heard).toBe('Saved "chapter spitalfields" (spit) as a place.');
  });
  it("'call it spit' after the save adds the alias to that place, on any phone key", async () => {
    const w = world();
    expect((await w.turn(withOutreach("it's the library"), "agent:main:orion-chat-a")).heard).toBe('Saved "the library" as a place.');
    const r = await w.turn("call it the lib", "agent:main:orion-chat-b");
    expect(r.heard).toBe('Okay, "the library" is also "the lib".');
    expect(w.placeCalls.some((a) => a.join(" ") === "place alias the-library add the lib")).toBe(true);
  });
  it("an unrelated message after the save is not taken for an alias", async () => {
    const w = world();
    await w.turn(withOutreach("it's the library"));
    const r = await w.turn("whats the weather tomorrow");
    expect(r.heard).not.toMatch(/also/);
    expect(w.placeCalls.some((a) => a[1] === "alias")).toBe(false);
  });
});

describe("another proactive two-step: 'want me to log that?' -> 'how much?' -> '2'", () => {
  it("each question ORION asks is the pending item and the next word binds to it", async () => {
    const w = world((m) => (m === "just got back from a long walk" ? { move: "answer", answer: "Nice. Want me to log that?" } : { move: "escalate", tier: "standard" }));
    const first = await w.turn("just got back from a long walk", "agent:main:orion-chat-a");
    expect(first.heard).toBe("Nice. Want me to log that?");
    // his yes binds to the offer; the worker's reply is the next question
    const yes = await w.turn("yes", "agent:main:orion-chat-a", "How many bottles was that?");
    expect(yes.appended).toContain("Want me to log that?");
    // the short answer, on another phone key, binds to THAT question
    const two = await w.turn("2", "agent:main:orion-chat-b");
    expect(two.appended).toContain("How many bottles was that?");
    expect(two.appended).toContain('his "2" answers');
  });
  it("a short answer with no question open gets no invented context", async () => {
    const w = world();
    await w.turn("hows my day", "agent:main:orion-chat-a", "You have gym at 6.");
    const r = await w.turn("2", "agent:main:orion-chat-a");
    expect(r.appended).not.toContain("answers the last thing");
  });
});
