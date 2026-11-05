// Wave 6 (2026-11-01): knowledge moves through the real routing hooks. The desk is wrong on purpose (it would draft or search);
// code answers from the scripts' JSON, and nothing from the desk or a tool internal reaches the reply. Held-out Nick-style phrasings.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import type { Decision } from "./front-desk.js";
import type { KnowledgeRun } from "./knowledge-run.js";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;

function route(knowledgeRun: KnowledgeRun) {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (n: string, fn: Handler) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
  const fire = async (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => { const o: unknown[] = []; for (const fn of handlers.get(n) ?? []) o.push(await fn(e, c)); return o; };
  const dir = mkdtempSync(join(tmpdir(), "wave6-"));
  const desk: string[] = [];
  registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), stateDir: dir, clock: () => "Sun 13:00", now: () => new Date(2026, 10, 1, 13, 0),
    decideImpl: async (i: { message: string }) => { desk.push(i.message); return { move: "answer", answer: "I couldn't run that lookup just now." } as Decision; },
    brainSearch: async () => "",
    scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }),
    realityRun: async () => ({ stdout: "ok", code: 0 }),
    // The ledger is wired as in production: a restore phrase must reach the knowledge route past the ledger's own asks (r5 review HIGH 1).
    ledgerRun: async () => ({ stdout: "", code: 0 }),
    knowledgeRun,
  } as never);
  let n = 0;
  const turn = async (prompt: string) => {
    const ctx = { runId: `w6-${n += 1}`, sessionKey: "agent:main:orion-chat-wave6" };
    await fire("before_model_resolve", { prompt }, ctx);
    const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx)) as Array<{ reply?: { text: string } } | undefined>;
    return direct?.reply?.text;
  };
  return { turn, desk };
}

describe("knowledge moves are code's, before the desk", () => {
  it("forget: the saved entry is archived and named; the desk is never asked", async () => {
    const applied: string[][] = [];
    const r = route(async (_s, args) => {
      if (args[1] === "--apply") { applied.push(args.slice(2)); return { stdout: JSON.stringify({ archived: [{ id: "abcdef0123", text: "Nick's gym bag is blue" }], missing: [] }), code: 0 }; }
      return { stdout: JSON.stringify({ matches: [{ id: "abcdef0123", text: "Nick's gym bag is blue", where: "x", copies: 1 }] }), code: 0 };
    });
    const reply = await r.turn("yo can u erase what you saved about my gym bag");
    expect(applied).toEqual([["abcdef0123"]]);
    expect(reply).toMatch(/^Forgot "Nick's gym bag is blue"\./);
    expect(reply).not.toMatch(/lookup/i);
    expect(r.desk).toEqual([]);
    const undo: string[][] = [];
    const r2 = route(async (_s, args) => { undo.push(args); return { stdout: JSON.stringify(args[1] === "--restore" ? { restored: [{ id: "abcdef0123", text: "Nick's gym bag is blue" }] } : args[1] === "--apply" ? { archived: [{ id: "abcdef0123", text: "Nick's gym bag is blue" }] } : { matches: [{ id: "abcdef0123", text: "Nick's gym bag is blue" }] }), code: 0 }; });
    await r2.turn("forget what i told you about my gym bag");
    expect(await r2.turn("wait put it back")).toBe("Put back \"Nick's gym bag is blue\".");
    expect(undo.at(-1)).toEqual(["forget", "--restore", "abcdef0123"]);
  });

  it("links and profile answer from the scripts", async () => {
    const r = route(async (_s, args) => ({ stdout: JSON.stringify(args[0] === "links"
      ? { found: true, subject: "atlas", title: "Atlas", links: [{ label: "Resume", kind: "features", dir: "in" }] }
      : { name: "Nick", classes: ["CS3000"], gym: "90 min every day", home: "London" }), code: 0 }));
    expect(await r.turn("whats connected to atlas")).toBe("Atlas links to: Resume (features it).");
    const me = await r.turn("tell me everything u know about me");
    expect(me).toMatch(/Classes: CS3000\./);
    expect(me).toMatch(/Gym: 90 min every day\./);
    expect(r.desk).toEqual([]);
  });

  it("trash: a folder is asked about by name; the yes moves it, never rm", async () => {
    const calls: string[][] = [];
    const r = route(async (script, args) => {
      calls.push([script, ...args]);
      if (args[0] === "find") return { stdout: JSON.stringify({ matches: [{ path: "/h/Downloads/scratch", shown: "Downloads/scratch", name: "scratch", kind: "folder", items: 2 }] }), code: 0 };
      return { stdout: JSON.stringify({ ok: true, from: "Downloads/scratch", to: "/h/.Trash/scratch", id: "t" }), code: 0 };
    });
    expect(await r.turn("get rid of the folder called scratch in my downloads")).toBe("Move the folder \"scratch\" (Downloads/scratch, 2 items) to the Trash? Say yes and I'll do it.");
    expect(calls.map((c) => c[1])).toEqual(["find"]);
    expect(await r.turn("yep")).toMatch(/^Moved the folder scratch \(Downloads\) to the Trash\./);
    expect(calls.at(-1)).toEqual(["orion-trash", "move", "/h/Downloads/scratch", "--confirm", "scratch"]);
    expect(calls.flat()).not.toContain("rm");
  });

  it("an ordinary yes with nothing pending is not a trash confirmation", async () => {
    const calls: string[][] = [];
    const r = route(async (script, args) => { calls.push([script, ...args]); return { stdout: "{}", code: 0 }; });
    await r.turn("yep");
    expect(calls).toEqual([]);
  });
});
