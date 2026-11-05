// w20 round 4 (live gate run 2, 2026-11-05): food removal, "go" / "yeah add it" / "put that in" after a food answer, calories so far, a long note kept whole,
// a list of two things as two rows, and "fix your code" naming the failure and asking before it starts. His words are held-out phrasings in his style.
import { describe, expect, it } from "vitest";
import { rig, type Rig } from "./r4-harness.js";
import type { FoodRun } from "./food-chat.js";
import { readFoodTurn, type FoodContext } from "./food-read.js";
import { waterLogBlock } from "./water-guard.js";
import { parseNote } from "./note-flow.js";
import { readChatAsks, runChatAsks, splitListItems } from "./chat-asks.js";
import { parseTodoDone } from "./todo-done-flow.js";
import { explicitFixSubject, gerund, readSelffixMove, runSelffixMove, subjectOfDiagnosis, type SelffixRun } from "./selffix-flow.js";

const ANSWER = "About 12 g of protein (and ~400 kcal). Want me to log it?";
/** The estimator as an evaluation run sees it: answers and logs, but never leaves an offer file behind. */
function fakeFood() {
  const entries: Array<{ id: string; title: string }> = [];
  const calls: string[][] = [];
  const run: FoodRun = async (args) => {
    calls.push(args);
    if (args[0] === "log-pending" || args[0] === "discard") return { stdout: JSON.stringify({ ok: false, error: "no estimate is waiting" }), code: 1 };
    if (args[0] === "undo") {
      const i = entries.findIndex((e) => e.id === args[1]);
      const gone = i >= 0 ? entries.splice(i, 1)[0] : undefined;
      return { stdout: JSON.stringify(gone ? { ok: true, removed: { title: gone.title, calories: 330 }, dayCalories: 0 } : { ok: false, error: "nothing to undo" }), code: gone ? 0 : 1 };
    }
    if (args.includes("--log")) {
      const id = `FOOD-${entries.length + 1}`; entries.push({ id, title: args[1]! });
      return { stdout: JSON.stringify({ ok: true, summary: `~330 kcal · 17 g protein, 21 g carbs, 20 g fat (${args[1]})`, logged: { id, dayCalories: 330 } }), code: 0 };
    }
    return { stdout: JSON.stringify({ ok: true, summary: "~400 kcal", offer: { id: "fp", text: ANSWER } }), code: 0 };
  };
  const ledger = async (script: string, a: string[]) => {
    if (script === "orion-food-estimate") return run(a);
    if (script === "orion-log" && a[0] === "food-off") return { stdout: `No food entry matching "${a.slice(1).join(" ")}" is logged today.`, code: 1 };
    return { stdout: "", code: 1 };
  };
  return { run, entries, calls, ledger };
}
const logged = (calls: string[][]) => calls.filter((c) => c.includes("--log")).map((c) => c[1]);
const chat = (f = fakeFood()) => ({ f, r: rig({ foodRun: f.run, ledgerRun: f.ledger }) });

describe("a yes after a food answer, with no offer file (a gate / evaluation run writes none)", () => {
  it.each(["yeah add it", "go", "yeah go on", "do it", "put that in", "ok add that", "yep confirm", "sure put it in", "yes log it", "go ahead"])("%s logs the food just discussed", async (yes) => {
    const { f, r } = chat();
    expect(await r.turn("whats the protein in a mcchicken")).toBe(ANSWER);
    const reply = await r.turn(yes);
    expect(reply).toMatch(/Logged/);
    expect(logged(f.calls)).toEqual(["mcchicken"]);
    expect(r.flows).toEqual([]);   // never handed to the scheduler
  });
  it("a turn about something else in between unbinds it", async () => {
    const { f, r } = chat();
    await r.turn("whats the protein in a mcchicken");
    await r.turn("what time is it");
    await r.turn("go");
    expect(logged(f.calls)).toEqual([]);
  });
  it.each(["nah i didnt eat that, take it off", "no remove it", "nvm scrap that", "actually i didnt have that one", "nope, forget it"])("%s declines it and logs nothing", async (no) => {
    const { f, r } = chat();
    await r.turn("how many calories in a chicken wrap");
    expect(await r.turn(no)).toBe("Okay, not logged.");
    expect(logged(f.calls)).toEqual([]);
  });
  it("a correction asks again for the same food", async () => {
    const { f, r } = chat();
    await r.turn("whats the protein in a mcchicken");
    await r.turn("it was a small one");
    expect(f.calls.at(-1)).toEqual(["--text", "mcchicken, it was a small one", "--offer", "--json"]);
  });
});

describe("put that in", () => {
  it.each([
    ["ive just had a banana, put that in", "a banana"], ["just ate two slices of toast, log that", "two slices of toast"], ["had a bowl of porridge pls add it", "a bowl of porridge"], ["i just had a protein bar and put it in", "a protein bar"],
  ])("%s is a log of the food, not a question about a start time", async (m, food) => {
    const { f, r } = chat();
    expect(await r.turn(m)).toMatch(/Logged/);
    expect(logged(f.calls)).toEqual([food]);
    expect(r.flows).toEqual([]);
  });
  it("a statement with no instruction is not touched", () => {
    expect(readFoodTurn("ive just had a banana", { now: new Date(), mealsOn: false } as FoodContext)).toBeNull();
  });
});

describe("removal reads the food log, never water", () => {
  it.each(["remove the eggs", "take the eggs off", "delete the eggs", "scrap the eggs", "nah take that off, i didnt have the eggs"])("%s takes the eggs off and reads it back", async (m) => {
    const { f, r } = chat();
    expect(await r.turn("log 2 eggs on toast for breakfast")).toMatch(/Logged/);
    const reply = await r.turn(m);
    expect(reply).toContain("Took 2 eggs on toast for breakfast off");
    expect(f.entries).toEqual([]);   // the entry is really gone
    expect(f.calls.filter((c) => c[0] === "undo")).toHaveLength(1);
    expect(reply).not.toMatch(/water/i);
  });
  it("scrap that one, wasnt a banana takes the banana off", async () => {
    const { f, r } = chat();
    await r.turn("ive just had a banana, put that in");
    expect(await r.turn("scrap that one, wasnt a banana")).toContain("Took a banana off");
    expect(f.entries).toEqual([]);
  });
  it("with nothing logged it says so, in the same words, and logs nothing", async () => {
    const { f, r } = chat();
    await r.turn("how many calories in a chicken wrap");
    await r.turn("nah");
    const reply = await r.turn("remove the eggs");
    expect(reply).toMatch(/don't have eggs in today's food log, so nothing was taken off/);
    expect(f.calls.some((c) => c.includes("--log"))).toBe(false);
  });
  it.each([["remove the eggs"], ["take it off"], ["nah i didnt eat that, take it off"], ["scrap the banana"], ["delete that meal"]])("the water guard blocks orion-log water on %s", (m) => {
    expect(waterLogBlock(m, "/Users/x/scripts/orion-log water 1")).toMatch(/never a water log/);
    expect(waterLogBlock(m, "/Users/x/scripts/orion-log water 2 eggs on toast for breakfast")).toMatch(/never a water log/);
  });
  it.each(["just finished a big bottle of water", "i drank 2 bottles", "had a bottle of water, remove the last one but add 2 bottles of water"])("%s may log water", (m) => {
    expect(waterLogBlock(m, "orion-log water 1")).toBeUndefined();
  });
  it("water-off and other commands are never blocked", () => {
    expect(waterLogBlock("take it off", "orion-log water-off 1")).toBeUndefined();
    expect(waterLogBlock("take it off", "orion-tasks list")).toBeUndefined();
  });
  it("the hook blocks the worker's water write on a removal turn", async () => {
    const { r } = chat();
    await r.turn("remove the eggs");
    const res = (await r.fire("before_tool_call", { toolName: "exec", params: { command: "/Users/x/scripts/orion-log water 2 eggs on toast for breakfast" } }, { runId: "r4-1", sessionKey: "agent:main:orion-chat-r4" })) as Array<{ block?: boolean } | undefined>;
    expect(res.some((x) => x?.block === true)).toBe(true);
  });
});

describe("how many calories have i had", () => {
  const health = { schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [], nutritionLog: { "2026-11-05": [{ title: "Eggs on toast", calories: 330, protein: 17 }, { title: "Banana", calories: 105, protein: 1 }] } };
  it.each(["how many calories have i had", "how many cals have i eaten", "calories ive had so far", "how many calories did i have", "how much protein have i had"])("%s is answered from today's log", async (m) => {
    const f = fakeFood();
    const r = rig({ foodRun: f.run, health });
    const reply = String(await r.turn(m));
    expect(reply).toMatch(/435 kcal|18 g of protein/);
    expect(reply).not.toMatch(/couldn't estimate/);
    expect(f.calls).toEqual([]);   // never sized as a meal
  });
  it("a food's calories are still sized", async () => {
    const f = fakeFood();
    const r = rig({ foodRun: f.run, health });
    expect(await r.turn("how many calories in a banana")).toBe(ANSWER);
  });
});

describe("a note keeps his whole text", () => {
  const LONG = "had a rough day on the orion plan, it overran massively. i need to split it in half tomorrow and chase the week 9 slides. also remember the idempotency bit";
  it.each(["jot this down: ", "note this down: ", "write this down - ", "jot that down, ", "make a note: ", "note that ", "put this down: ", "log this as a note: ", "save it: "])("%s<long text> is saved whole through the note flow", async (lead) => {
    const saved: string[] = [];
    const r = rig({ noteFlow: async (m) => { saved.push(m); return { outcome: "done", calls: ['exec orion-brain learn "Nick" "note" <his full text>'], outputs: ["Added to Nick"], reply: `Saved the note (3 sentences): "${LONG.slice(0, 40)}…"` }; } });
    const reply = String(await r.turn(`${lead}${LONG}`));
    expect(saved).toEqual([`${lead}${LONG}`]);
    expect(parseNote(`${lead}${LONG}`)?.text).toBe(LONG);
    expect(reply).toContain("Saved the note");
    expect(reply).not.toMatch(/smallest step|focus session|a lot at once/i);
  });
  it("a plain statement of a rough day is not a note", () => {
    expect(parseNote("had a rough day, it overran")).toBeNull();
  });
});

describe("a list of two things is two rows", () => {
  it.each([
    ["add oat milk and a phone charger cable to my list", ["oat milk", "phone charger cable"]], ["put eggs and bread on my list", ["eggs", "bread"]], ["add toothpaste, bin bags and a lightbulb to my shopping list", ["toothpaste", "bin bags", "lightbulb"]],
    ["pls add salt and pepper to my list", ["salt and pepper"]], ["stick milk & cereal on the list", ["milk", "cereal"]],
  ])("%s", (m, items) => {
    expect(readChatAsks(m)).toEqual(items.map((item) => ({ kind: "list-add", item })));
  });
  it("each is its own orion-tasks add and the reply names both", async () => {
    const adds: string[][] = [];
    const out = await runChatAsks(readChatAsks("add oat milk and a phone charger cable to my list")!, { open: async () => ({ stdout: "", code: 0 }), installed: async () => true, tasks: async (a) => { adds.push(a); return { stdout: `Added "${a[1]}"`, code: 0 }; } });
    expect(adds).toEqual([["add", "Oat milk"], ["add", "Phone charger cable"]]);
    expect(out.text).toBe("Added oat milk and phone charger cable to your list as separate items.");
  });
  it("a failure on one row is said for that row alone", async () => {
    const out = await runChatAsks(readChatAsks("add eggs and bread to my list")!, { open: async () => ({ stdout: "", code: 0 }), installed: async () => true, tasks: async (a) => (a[1] === "Bread" ? { stdout: "", code: 1 } : { stdout: `Added "${a[1]}"`, code: 0 }) });
    expect(out.text).toBe("Added eggs to your list. I couldn't add bread to your list: nothing was added.");
  });
  it("splitListItems keeps pairs that are one food", () => {
    expect(splitListItems("fish and chips and mushy peas")).toEqual(["fish and chips", "mushy peas"]);
  });
  it.each(["tick off eggs", "tick off the charger cable", "cross off bread"])("%s completes just that one item", (m) => {
    expect(parseTodoDone(m)?.words).toBe(m.replace(/^(?:tick off|cross off)\s+(?:the\s+)?/, ""));
  });
});

describe("fix your code names the failure and asks first", () => {
  it.each([
    ["can you change your own code so you can open websites without asking me", "opening websites without asking me"],
    ["fix your code so you can close apps when i say", "closing apps when i say"],
    ["go into your code and fix it so you could stop asking permission", "stopping asking permission"],
    ["modify your code to be able to set timers", "setting timers"],
  ])("%s -> %s", (m, subject) => { expect(explicitFixSubject(m)).toBe(subject); });
  it("gerunds", () => { expect([gerund("open"), gerund("close"), gerund("run"), gerund("set"), gerund("play")]).toEqual(["opening", "closing", "running", "setting", "playing"]); });
  it("without a stated goal the subject is the previous request and what went wrong", () => {
    expect(subjectOfDiagnosis({ message: "open youtube in safari", kind: "no-action" })).toBe('"open youtube in safari" (I gave up without trying)');
    expect(subjectOfDiagnosis({})).toMatch(/^the last thing that went wrong/);
  });
  const script = (calls: string[]): SelffixRun => async (s, a, input) => {
    calls.push([s, ...a].join(" ") + (input ? ` <${input.slice(0, 400)}>` : ""));
    if (a[0] === "list") return { stdout: JSON.stringify({ ok: true, items: [] }), code: 0 };
    if (s === "orion-selfcheck") return { stdout: JSON.stringify({ ok: true, diagnosis: { message: "hello alright push my bedtime", kind: "no-action", signature: "no-action:reply", title: "Fix: no action on bedtime", fixable: true, failingExample: {} } }), code: 0 };
    if (a[0] === "propose") return { stdout: JSON.stringify({ ok: true, status: "offered", item: { id: "sf-1", title: "t", status: "offered" } }), code: 0 };
    return { stdout: JSON.stringify({ ok: true, status: "started" }), code: 0 };
  };
  it("a stated goal is the subject even when the last failure was about something else, and nothing starts before the yes", async () => {
    const calls: string[] = [];
    const r = rig({ selffixRun: script(calls) });
    expect(await r.turn("can you change your own code so you can open websites without asking me")).toBe("I'll start a fix for: opening websites without asking me. Go?");
    expect(calls.some((c) => /propose|accept|start/.test(c.split(" ")[1] ?? ""))).toBe(false);
    expect(await r.turn("yes")).toMatch(/started a fix project/);
    expect(calls.find((c) => c.includes("propose"))).toContain("Fix: opening websites without asking me");
    expect(calls.find((c) => c.includes("propose"))).toContain('"title":"Fix: opening websites without asking me"');
  });
  it("the run waits for a yes: 'no' or another message starts nothing", async () => {
    const calls: string[] = [];
    const r = rig({ selffixRun: script(calls) });
    await r.turn("fix your code");
    expect(await r.turn("no")).toMatch(/won't start it/);
    await r.turn("fix your code");
    await r.turn("whats the weather");
    await r.turn("yes");
    expect(calls.some((c) => c.includes("accept") || c.includes("propose"))).toBe(false);
  });
  it("a yes with nothing asked is not a fix", () => {
    expect(readSelffixMove("yes", { stateDir: "/x", now: new Date(), items: [] })).toBeUndefined();
  });
  it("runSelffixMove 'fix-drop' says nothing started", async () => {
    expect((await runSelffixMove({ kind: "fix-drop" }, script([]))).text).toMatch(/won't start it/);
  });
});
