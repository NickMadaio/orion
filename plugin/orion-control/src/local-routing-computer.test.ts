/*
 2026-10-31. The computer loop inside the live chat route: registerLocalRouting's before_prompt_build hands a screen task to
 maybeRunComputerTask (fake bridge, no Mac) and the loop's reply becomes the turn's fixed reply, with no desk call and no
 model call. Everything that is not a screen task must pass through untouched.
*/
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { AxNode, Observation } from "./computer-ax.js";
import { type ComputerBridge, type ElementRef } from "./computer-bridge.js";
import { resetComputerPending } from "./computer-loop.js";
import type { Decision } from "./front-desk.js";
import { registerLocalRouting } from "./local-routing.js";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function fakeApi() {
  const handlers = new Map<string, Handler[]>();
  return {
    api: { on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) },
    fire: async (name: string, event: Record<string, unknown>, ctx: Record<string, unknown> = {}) => {
      const out = [];
      for (const fn of handlers.get(name) ?? []) out.push(await fn(event, ctx));
      return out;
    },
  };
}

const node = (role: string, label: string | null, extra: Partial<AxNode> = {}): AxNode => ({ role, label, value: null, x: 10, y: 10, width: 20, height: 20, children: [], ...extra });

/** A tiny Mac: Safari with closable tabs, or Notes where File > New Note opens an empty note. */
class TinyMac implements ComputerBridge {
  ops: string[] = [];
  front = "com.apple.Safari";
  tabs = ["Econ notes", "YouTube", "Reddit"];
  note: { text: string } | null = null;
  async observe(): Promise<Observation> {
    this.ops.push("observe");
    if (this.front === "com.apple.Notes") {
      return { appName: "Notes", bundleId: this.front, windowTitle: "Notes", element: { role: "AXWindow", label: "Notes", children: this.note ? [node("AXTextArea", null, { value: this.note.text })] : [] } };
    }
    return { appName: "Safari", bundleId: this.front, windowTitle: this.tabs[0] ?? "Safari", element: { role: "AXWindow", label: "Safari", children: [
      node("AXTabGroup", null, { children: this.tabs.map((t) => node("AXRadioButton", t, { children: [node("AXButton", "Close Tab")] })) }),
      node("AXStaticText", null, { value: "MKTG2201 Segmentation" }),
    ] } };
  }
  async openApp(ref: { name: string; bundleId?: string }) { this.ops.push(`open:${ref.name}`); if (ref.bundleId) this.front = ref.bundleId; }
  async press(_b: string, ref: ElementRef) { this.ops.push(`press:${ref.label}`); const i = Number(ref.path.split(".")[1]); this.tabs = this.tabs.filter((_, k) => k !== i); }
  async setValue(_b: string, _r: ElementRef, value: string) { this.ops.push(`set:${value}`); if (this.note) this.note = { text: value }; }
  async menu(_b: string, path: readonly string[]) { this.ops.push(`menu:${path.join(">")}`); if (path.join(">") === "File>New Note") this.note = { text: "" }; else throw new Error("no such menu item"); }
  async menuItems() { return []; }
  async key(_b: string, name: string) { this.ops.push(`key:${name}`); }
  async type(_b: string, text: string) { this.ops.push(`type:${text}`); }
  async click() { this.ops.push("click"); }
}

const CTX = { runId: "r1", sessionKey: "agent:main:orion-chat-1" };
const SPOKEN_HEADER = "Nick SAID this out loud (voice transcript).\n";

function setup(opts: { observe?: boolean; control?: boolean; mac?: TinyMac; computer?: boolean } = {}) {
  const mac = opts.mac ?? new TinyMac();
  const f = fakeApi();
  const counts = { desk: 0, summarize: 0 };
  registerLocalRouting(f.api, {
    warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lrc-")), "routing.jsonl"), clock: () => "Sat 18:00",
    decideImpl: async (): Promise<Decision> => { counts.desk += 1; return { move: "escalate", tier: "standard", say: "One moment.", ms: 10 }; },
    scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }), brainSearch: async () => "",
    ...(opts.computer === false ? {} : { computer: {
      bridge: mac, enabled: { observe: opts.observe ?? true, control: opts.control ?? true }, sleep: async () => {},
      summarize: async () => { counts.summarize += 1; return "A Safari page about MKTG2201 segmentation."; },
    } }),
  });
  const turn = async (prompt: string, ctx: Record<string, unknown> = CTX) => {
    await f.fire("before_model_resolve", { prompt }, ctx);
    const [built] = (await f.fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ systemPrompt?: string; appendContext?: string } | undefined>;
    const [reply] = await f.fire("before_agent_reply", { cleanedBody: prompt }, ctx);
    return { built, reply, text: `${built?.systemPrompt ?? ""}\n${built?.appendContext ?? ""}` };
  };
  return { mac, f, counts, turn };
}

const FIXED = /Your whole reply must be exactly/;
beforeEach(() => resetComputerPending());

describe("local routing: the computer loop", () => {
  it("'close my safari tabs' runs the loop, replies from it, and never asks the desk or the model", async () => {
    const { mac, counts, turn } = setup();
    const out = await turn("close my safari tabs");
    expect(out.text).toMatch(FIXED);
    expect(out.text).toMatch(/clos/i);
    expect(mac.ops.some((o) => o.startsWith("press:Close Tab") || o.startsWith("menu:"))).toBe(true);
    expect(counts).toEqual({ desk: 0, summarize: 0 });
    expect(out.reply).toBeUndefined();
  });

  it("'open notes and make a note called groceries' runs its steps on the bridge", async () => {
    const { mac, turn } = setup();
    const out = await turn("open notes and make a note called groceries");
    expect(mac.ops).toEqual(expect.arrayContaining(["open:Notes", "menu:File>New Note"]));
    expect(mac.note?.text).toBe("groceries");
    expect(out.text).toMatch(/groceries/);
  });

  it("'whats on my screen' is answered from the screen read (summary), with no actions", async () => {
    const { mac, counts, turn } = setup();
    const out = await turn("whats on my screen");
    expect(out.text).toMatch(/segmentation/i);
    expect(counts.summarize).toBe(1);
    expect(mac.ops.every((o) => o === "observe")).toBe(true);
  });

  it("the gate's own phrasings reach the loop", async () => {
    for (const phrase of ["open notes and make one called econ ideas", "look at my screen and summarise the slide in 3 bullets", "close the 2 tabs that arent econ in safari", "close all the junk tabs"]) {
      const { mac, turn } = setup();
      const out = await turn(phrase);
      expect(out.text, phrase).toMatch(FIXED);
      expect(mac.ops.length, phrase).toBeGreaterThan(0);
    }
  });

  it("ordinary schedule and chat turns never reach the bridge", async () => {
    const phrases = ["move gym to 6", "whats on my calendar today", "push my lecture to 3", "remind me at 5 to call mom", "thanks", "im tired", "put study block at 7", "text annika that im gonna be late", "how long is my commute", "what should i do next"];
    for (const phrase of phrases) {
      const { mac, turn } = setup();
      await turn(phrase);
      expect(mac.ops, phrase).toEqual([]);
    }
  });

  it("without options.computer nothing changes: the desk is asked and no reply is fixed", async () => {
    const { counts, turn } = setup({ computer: false });
    const out = await turn("close my safari tabs");
    expect(counts.desk).toBe(1);
    expect(out.text).not.toMatch(/clos(ed|ing) .*tab/i);
  });

  it("observe on, control off: an honest line, and the bridge is never touched", async () => {
    const { mac, turn } = setup({ control: false });
    const out = await turn("close my safari tabs");
    expect(out.text).toMatch(/not allowed to control the screen.*switched off/i);
    expect(mac.ops).toEqual([]);
    const read = await turn("whats on my screen");
    expect(read.text).toMatch(/segmentation/i);
  });

  it("observe off: reading the screen says so honestly", async () => {
    const { mac, turn } = setup({ observe: false });
    const out = await turn("whats on my screen");
    expect(out.text).toMatch(/not allowed to read the screen/i);
    expect(mac.ops).toEqual([]);
  });

  it("half a spoken sentence is not acted on", async () => {
    const { mac, turn } = setup();
    await turn(`${SPOKEN_HEADER}close my safari tabs and`);
    expect(mac.ops).toEqual([]);
  });

  it("inside a quiet window a spoken screen task is dropped, not run", async () => {
    const { mac, turn } = setup();
    await turn(`${SPOKEN_HEADER}shush, dont reply unless i say orion`);
    const out = await turn(`${SPOKEN_HEADER}close my safari tabs`);
    expect(mac.ops).toEqual([]);
    expect(out.text).toMatch(FIXED);
  });
});
