// w18 voiceself: "open spotify" / "pull up safari" is the existing app_open action, never "I can't pull up apps on your Mac".
// Live 11-03: the desk answered with a drafted refusal (the move "answer"), so no tool ran. Code now picks the one call.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { appOpenName, toolDirective } from "./tool-moves.js";
import type { Decision } from "./front-desk.js";

describe("appOpenName", () => {
  it("names the app in open / pull up / launch phrasings", () => {
    const cases: Array<[string, string]> = [
      ["open spotify", "spotify"], ["pull up safari", "safari"], ["can u pull up chrome real quick", "chrome"], ["launch discord pls", "discord"],
      ["bring up the notes app", "notes"], ["yo open up Xcode", "Xcode"], ["pull up safari again", "safari"],
    ];
    for (const [m, app] of cases) expect(appOpenName(m), m).toBe(app);
  });
  it("is not fooled by things that are not apps", () => {
    for (const m of ["open my tasks", "pull up my schedule", "open the door", "pull up the mouse button mapper again", "open the mouse thing", "start a focus session",
      "pull up what i have tomorrow", "open it", "open a new tab", "what does open source mean", "start my day", "pull up the plan", "launch into the story"])
      expect(appOpenName(m), m).toBeNull();
  });
});

describe("the directive", () => {
  const answer = { move: "answer", answer: "I can't pull up apps on your Mac" } as Decision;
  it("is one app_open call whatever the desk drafted", () => {
    for (const d of [answer, { move: "tool", tool: "app_open", args: { application: "spotify" } } as Decision, undefined]) {
      const t = toolDirective(d, "open spotify");
      expect(t).toMatchObject({ kind: "call", action: "app_open" });
      expect(t && t.kind === "call" && JSON.parse(t.args)).toEqual({ steps: [{ action: "app_open", application: "spotify" }] });
    }
  });
  it("an escalation keeps the worker's own judgement", () => expect(toolDirective({ move: "escalate" } as Decision, "open spotify")).toBeNull());
});

describe("through the routing (the 11-03 desk draft no longer answers)", () => {
  type H = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
  async function turn(said: string) {
    const handlers = new Map<string, H[]>();
    const api = { on: (n: string, fn: H) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    registerLocalRouting(api as never, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "aod-")), "r.jsonl"), clock: () => "Tue 18:00",
      decideImpl: async () => ({ move: "answer", answer: "I can't pull up apps on your Mac." }) as Decision, brainSearch: async () => "",
      scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }) } as never);
    const ctx = { runId: "aod-1", sessionKey: "agent:main:orion-chat-aod" };
    const fire = async (n: string, e: Record<string, unknown>) => { const out = []; for (const fn of handlers.get(n) ?? []) out.push(await fn(e, ctx)); return out; };
    await fire("before_model_resolve", { prompt: said });
    const [reply] = (await fire("before_agent_reply", { cleanedBody: said })) as Array<{ handled?: boolean } | undefined>;
    const [built] = (await fire("before_prompt_build", { prompt: said, messages: [] })) as Array<{ systemPrompt: string } | undefined>;
    return { reply, built };
  }
  it("open spotify and pull up safari run app_open", async () => {
    for (const [said, app] of [["open spotify", "spotify"], ["pull up safari", "safari"]] as const) {
      const { reply, built } = await turn(said);
      expect(reply?.handled, said).toBeFalsy();
      expect(built?.systemPrompt, said).toContain(`{"steps":[{"action":"app_open","application":"${app}"}]}`);
    }
  });
});
