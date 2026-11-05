import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { answersWebOffer, listReply, readChatAsks, runChatAsks, type ChatDeps } from "./chat-asks.js";
import { emptyReplyLine, isBlank, whyEmptyLine } from "./empty-reply.js";
import { outreachStale, stripOutreachEcho } from "./outreach-stale.js";
import { registerLocalRouting } from "./local-routing.js";
import type { Decision } from "./front-desk.js";

const NAG = "You've been avoiding bed for 45 min. Get up. We're doing it now.";
const label = (min: number) => `[ORION context: you messaged him first, ${min} min ago: "${NAG}". This message MAY be his answer.]\n`;

describe("chat asks are read in his words", () => {
  it.each([
    ["open amazon uk", "url"], ["open youtube in safari", "url"], ["opne netflix pls", "url"], ["can you open reddit on my browser", "url"], ["yo launch spotify", "app"], ["pull up discord", "app"],
  ])("%s", (m, kind) => { expect(readChatAsks(m)?.[0]).toMatchObject({ kind: "open", req: { kind } }); });
  it.each([
    ["add milk to my list", "milk"], ["pls add oat milk to my list", "oat milk"], ["put bin bags on my to do list", "bin bags"], ["can you stick toothpaste on the list", "toothpaste"], ["add some bread to my shopping list", "bread"],
  ])("%s", (m, item) => { expect(readChatAsks(m)).toEqual([{ kind: "list-add", item }]); });
  it.each(["whats on my todo list", "what's on my to do list rn", "whats on my list", "show me my to-dos", "read me my tasks", "what to-dos do i have left"])("%s reads the list", (m) => {
    expect(readChatAsks(m)).toEqual([{ kind: "todo-list" }]);
  });
  it("two asks in one message are both read", () => {
    expect(readChatAsks("open spotify and add milk to my list")).toEqual([{ kind: "open", req: { kind: "app", name: "spotify" } }, { kind: "list-add", item: "milk" }]);
  });
  it.each(["add milk to my calendar", "add gym to my schedule tomorrow", "open the door", "whats on my calendar", "add a call with mum at 5 to my list", "open spotify and move gym to 6"])("%s is not one of them", (m) => {
    expect(readChatAsks(m)).toBeNull();
  });
  it("yes to the web player", () => {
    for (const m of ["yeah", "yeah do it", "yes please", "sure", "go ahead", "ok"]) expect(answersWebOffer(m), m).toBe(true);
    for (const m of ["yeah what about tomorrow", "no", "open it in chrome please"]) expect(answersWebOffer(m), m).toBe(false);
  });
});

const deps = (over: Partial<ChatDeps> = {}): ChatDeps & { seen: string[] } => {
  const seen: string[] = [];
  return { seen, open: async (a) => { seen.push(`open ${a.join(" ")}`); return { stdout: "", code: 0 }; }, installed: async (n) => n.toLowerCase() !== "spotify",
    tasks: async (a) => { seen.push(`tasks ${a.join("|")}`); return a[0] === "add" ? { stdout: `Added "${a[1]}" to Orion.`, code: 0 } : { stdout: '- Milk\n- Email careers · due 2026-11-06 · high\n- Pay rent · OVERDUE', code: 0 }; }, ...over };
};

describe("running them", () => {
  it("opens a site directly and says so", async () => {
    const d = deps();
    const out = await runChatAsks(readChatAsks("open amazon uk")!, d);
    expect(d.seen).toEqual(["open https://www.amazon.co.uk"]);
    expect(out.text).toBe("Opened amazon.co.uk.");
  });
  it("names the browser he asked for", async () => {
    const d = deps();
    const out = await runChatAsks(readChatAsks("open youtube in safari")!, d);
    expect(d.seen).toEqual(["open -a Safari https://www.youtube.com"]);
    expect(out.text).toBe("Opened youtube.com in Safari.");
  });
  it("an app that is not installed says so and offers the web player; the other ask still runs, with no time asked", async () => {
    const d = deps();
    const out = await runChatAsks(readChatAsks("open spotify and add milk to my list")!, d);
    expect(out.text).toBe("Spotify isn't installed on this Mac. Want me to open the Spotify web player instead? Added milk to your list.");
    expect(out.offer?.url).toBe("https://open.spotify.com");
    expect(d.seen).toEqual(['tasks add|Milk']);
  });
  it("a failed open is said plainly, a failed add never claims", async () => {
    const out = await runChatAsks(readChatAsks("open reddit and add eggs to my list")!, deps({ open: async () => ({ stdout: "", code: 1 }), tasks: async () => ({ stdout: "boom", code: 1 }) }));
    expect(out.text).toBe("I couldn't open reddit.com: nothing opened. I couldn't add eggs to your list: nothing was added.");
  });
  it("reads the list from the to-do source", async () => {
    const out = await runChatAsks(readChatAsks("whats on my todo list")!, deps());
    expect(out.text).toBe("You have 3 on your list: Milk; Email careers (due 11-06); Pay rent (overdue).");
    expect(listReply("Nothing on Orion.")).toBe("Nothing on your list right now.");
  });
  it("a list read that fails is an honest line, never blank", async () => {
    const out = await runChatAsks(readChatAsks("whats on my todo list")!, deps({ tasks: async () => { throw new Error("x"); } }));
    expect(isBlank(out.text)).toBe(false);
    expect(out.text).toMatch(/couldn't read your list/);
  });
});

describe("a stale outreach", () => {
  const o = { text: NAG, minutes: 3, kind: "start" as const };
  it("is stale once ORION replied after it was sent", () => {
    expect(outreachStale(o, 1_000_000, 1_060_000)).toBe(true);
    expect(outreachStale(o, undefined, 1_060_000)).toBe(false);
    expect(outreachStale(o, 1_000_000, 1_000_000 + 10 * 60_000)).toBe(false);
  });
  it("never rides on a reply", () => {
    expect(stripOutreachEcho(`I'm good, thanks. ${NAG}`, [NAG])).toBe("I'm good, thanks.");
    expect(stripOutreachEcho("You've been avoiding bed for 61 min. Get up. We're doing it now.", [NAG])).toBe("");
    expect(stripOutreachEcho("Fine, sure.", [NAG])).toBe("Fine, sure.");
  });
  it("blank replies become an honest line with a retry", () => {
    expect(isBlank("  ")).toBe(true); expect(isBlank("...")).toBe(true); expect(isBlank("ok")).toBe(false);
    expect(emptyReplyLine("the list read timed out")).toBe("I came back with nothing just now: the list read timed out. Say go and I'll retry it.");
    expect(whyEmptyLine()).toMatch(/last reply came back blank/);
  });
});

type H = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function rig(chat: ChatDeps = deps(), extra: Record<string, unknown> = {}) {
  const handlers = new Map<string, H[]>();
  const api = { on: (n: string, fn: H) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
  registerLocalRouting(api as never, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "r3c-")), "r.jsonl"), clock: () => "Tue 01:30", now: () => new Date(2026, 10, 5, 1, 30),
    decideImpl: async () => ({ move: "escalate", fallback: "timeout", ms: 1 }) as Decision, brainSearch: async () => "", chatRun: chat, ...extra,
    scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }) } as never);
  let n = 0;
  const fire = async (name: string, e: Record<string, unknown>, ctx: Record<string, unknown>) => { const out = []; for (const fn of handlers.get(name) ?? []) out.push(await fn(e, ctx)); return out; };
  return async (said: string, session = "agent:main:orion-chat-r3", worker = "") => {
    const ctx = { runId: `r3-${++n}`, sessionKey: session };
    await fire("before_model_resolve", { prompt: said }, ctx);
    const [reply] = (await fire("before_agent_reply", { cleanedBody: said }, ctx)) as Array<{ handled?: boolean; reply?: { text: string } } | undefined>;
    const [built] = (await fire("before_prompt_build", { prompt: said, messages: [] }, ctx)) as Array<{ systemPrompt: string; prependContext?: string } | undefined>;
    const messages = [{ role: "user", content: said }, { role: "assistant", content: [{ type: "text", text: worker }] }];
    for (let pass = 0; pass < 5; pass += 1) {   // the work check may revise a blank reply; the last pass is the one delivered
      const [verdict] = (await fire("before_agent_finalize", { lastAssistantMessage: worker, messages, hadDeterministicSideEffect: false }, ctx)) as Array<{ action?: string } | undefined>;
      if (verdict?.action !== "revise") break;
    }
    const final = (messages[1]!.content as Array<{ text: string }>).map((b) => b.text).join("");
    return { reply, built, final };
  };
}

describe("through the routing", () => {
  it("open amazon uk is opened by code, with a stale nag in the prompt", async () => {
    const turn = rig();
    await turn(`${label(0)}whats on today`);
    const r = await turn(`${label(2)}open amazon uk`);
    expect(r.reply?.handled).toBe(true);
    expect(r.reply?.reply?.text).toBe("Opened amazon.co.uk.");
  });
  it("whats on my todo list is answered from the list, not left to the worker", async () => {
    const turn = rig();
    const r = await turn("whats on my todo list");
    expect(r.reply?.handled).toBe(true);
    expect(r.reply?.reply?.text).toMatch(/^You have 3 on your list/);
  });
  it("add milk to my list needs no time", async () => {
    const turn = rig();
    const r = await turn("add milk to my list");
    expect(r.reply?.reply?.text).toBe("Added milk to your list.");
  });
  it("the web player offer is answered by a yes", async () => {
    const d = deps();
    const turn = rig(d);
    const first = await turn("open spotify");
    expect(first.reply?.reply?.text).toMatch(/web player/);
    const yes = await turn("yeah do it");
    expect(yes.reply?.reply?.text).toBe("Opened open.spotify.com.");
    expect(d.seen).toEqual(["open https://open.spotify.com"]);
  });
  it("after ORION replied, the old nag is not the context of the next turn", async () => {
    const turn = rig();
    await turn(`${label(0)}hey`);
    const r = await turn(`${label(1)}hey how are you`);
    expect(r.built?.prependContext ?? "").not.toMatch(/MAY be his answer|Bed starts|short reply to that/);
    expect(r.built?.prependContext ?? "").toMatch(/Do not repeat it/);
  });
  it("a blank worker reply goes out as an honest line, and why-did-you-do-that is about it", async () => {
    const turn = rig();
    const r = await turn("hows my week looking", undefined, "");
    expect(r.final).toMatch(/^I came back with nothing just now/);
    const why = await turn("why did you do that");
    expect(why.reply?.reply?.text).toMatch(/last reply came back blank/);
  });
  it("the nag is cut out of a reply that glued it on", async () => {
    const turn = rig();
    await turn(`${label(0)}hey`, undefined, "hi");
    const r = await turn(`${label(1)}hey how are you`, undefined, `I'm good, thanks. ${NAG}`);
    expect(r.final).toBe("I'm good, thanks.");
    const only = await turn(`${label(1)}go`, undefined, NAG);
    expect(only.final).toMatch(/lost track/);
  });
  it("can you fix your own code reaches the self-fix flow even with the old nag label on the prompt", async () => {
    const calls: string[] = [];
    const turn = rig(deps(), { stateDir: mkdtempSync(join(tmpdir(), "r3s-")), selffixRun: async (script: string, args: string[]) => { calls.push(`${script} ${args[0]}`); return { stdout: "{}", code: 0 }; } });
    await turn(`${label(0)}hey`);
    await turn(`${label(1)}can you fix your own code so you can open websites properly`);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.join(" ")).toMatch(/orion-self/);
  });
});
