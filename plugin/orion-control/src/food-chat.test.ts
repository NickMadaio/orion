// w14 g-food: food turns carried out through orion-food-estimate (a fake runner here), the pending offer read from the state dir,
// and the routing: an estimate offered, a yes logs it, a correction re-estimates, an unrelated turn in between unbinds the yes.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FoodMemory, PHOTO_LINE, readFoodPending, runFoodTurn, type FoodRun } from "./food-chat.js";
import { registerLocalRouting } from "./local-routing.js";
import type { Decision } from "./front-desk.js";

const NOW = new Date(2026, 10, 2, 13, 0);
const OFFER = "~670 kcal · 27 g protein, 99 g carbs, 18 g fat (chicken burrito and coke, ~640 g). Log it?";
const ESTIMATE = { ok: true, summary: "~670 kcal · 27 g protein, 99 g carbs, 18 g fat (chicken burrito and coke, ~640 g)", estimate: { items: [], totals: { kcal: 667 } }, offer: { id: "fp-1", text: OFFER } };
const LOGGED = { ok: true, logged: { id: "FOOD-0E0C7C2A-6B8B-4E0B-9C1A-3F7E3C0D8A11", day: "2026-11-02", filled: false, dayCalories: 1450 }, entry: { id: "FOOD-0E0C7C2A-6B8B-4E0B-9C1A-3F7E3C0D8A11", title: "Chicken burrito and coke", meal: "Lunch", calories: 667, protein: 27, carbohydrates: 99, fat: 18 } };

function fakeRun(answers: Record<string, unknown>, calls: string[][] = []): FoodRun {
  return async (args) => {
    calls.push(args);
    const key = Object.keys(answers).find((k) => args.join(" ").includes(k));
    const out = key ? answers[key] : { ok: false, error: "unexpected" };
    return { stdout: JSON.stringify(out), code: (out as { ok: boolean }).ok ? 0 : 1 };
  };
}
const dir = () => mkdtempSync(join(tmpdir(), "food-chat-"));

describe("runFoodTurn", () => {
  it("an ask runs an offered estimate and replies with the offer", async () => {
    const calls: string[][] = [];
    const out = await runFoodTurn({ kind: "ask", text: "chicken burrito and a coke", question: "how many calories in a chicken burrito and a coke" }, { run: fakeRun({ "--text": ESTIMATE }, calls), stateDir: dir(), now: NOW });
    expect(calls[0]).toEqual(["--text", "chicken burrito and a coke", "--ask", "how many calories in a chicken burrito and a coke", "--offer", "--json"]);
    expect(out.text).toBe(OFFER);
  });
  it("an ask without the question text still runs (older callers)", async () => {
    const calls: string[][] = [];
    await runFoodTurn({ kind: "ask", text: "chicken burrito" }, { run: fakeRun({ "--text": ESTIMATE }, calls), stateDir: dir(), now: NOW });
    expect(calls[0]).toEqual(["--text", "chicken burrito", "--offer", "--json"]);
  });
  it("a photo with a question gets the inbox's answer, never a log; one already logged is said to be logged", async () => {
    const d = dir();
    const turn = { kind: "photo", question: "how much protein is in this" } as const;
    expect((await runFoodTurn(turn, { run: fakeRun({}), stateDir: d, now: NOW })).text).toBe(PHOTO_LINE);
    const row = (extra: object, text: string) => JSON.stringify({ id: "fp-9", at: new Date(NOW.getTime() - 5 * 60_000).toISOString(), expiresAt: new Date(NOW.getTime() + 3600_000).toISOString(), via: "inbox", offerText: text, estimate: {}, ...extra });
    writeFileSync(join(d, "food-pending.json"), row({}, "About 42 g of protein (and ~650 kcal). Want me to log it?"));
    const calls: string[][] = [];
    const out = await runFoodTurn(turn, { run: fakeRun({}, calls), stateDir: d, now: NOW });
    expect(out.text).toBe("About 42 g of protein (and ~650 kcal). Want me to log it?");
    expect(calls).toEqual([]);
    writeFileSync(join(d, "food-pending.json"), row({ logged: { id: "FOOD-1" } }, "Logged ~650 kcal — bowl: 42 g protein, 70 g carbs, 18 g fat. Fix anything?"));
    expect((await runFoodTurn(turn, { run: fakeRun({}), stateDir: d, now: NOW })).text).toBe("That photo is already in your log. Logged ~650 kcal — bowl: 42 g protein, 70 g carbs, 18 g fat. Fix anything?");
  });
  it("a yes logs the offer and says how to undo it", async () => {
    const out = await runFoodTurn({ kind: "yes" }, { run: fakeRun({ "log-pending": LOGGED }), stateDir: dir(), now: NOW });
    expect(out.text).toBe('Logged chicken burrito and coke as lunch: 667 kcal, 27 g protein, 99 g carbs, 18 g fat. 1450 kcal today. Say "undo" to take it off.');
    expect(out.logged?.id).toBe(LOGGED.logged.id);
  });
  it("a no drops it; a correction re-estimates", async () => {
    expect((await runFoodTurn({ kind: "no" }, { run: fakeRun({ discard: { ok: true, discarded: true } }), stateDir: dir(), now: NOW })).text).toBe("Okay, not logged.");
    const calls: string[][] = [];
    const out = await runFoodTurn({ kind: "revise", correction: "it was a small one" }, { run: fakeRun({ "--revise": { ...ESTIMATE, offer: { id: "fp-2", text: "~400 kcal · smaller. Log it?" } } }, calls), stateDir: dir(), now: NOW });
    expect(calls[0]).toEqual(["--revise", "it was a small one", "--json"]);
    expect(out.text).toBe("~400 kcal · smaller. Log it?");
  });
  it("a no to 'Fix anything?' says it stays logged, and a correction reports the updated entry", async () => {
    const stays = await runFoodTurn({ kind: "no" }, { run: fakeRun({ discard: { ok: true, discarded: 1, kept: true, say: "Okay, it stays logged." } }), stateDir: dir(), now: NOW });
    expect(stays.text).toBe("Okay, it stays logged.");
    const fixed = await runFoodTurn({ kind: "revise", correction: "it was 2 slices" }, { run: fakeRun({ "--revise": { ...ESTIMATE, offer: { id: "fp-3", text: "Updated ~800 kcal — pizza slice: 33 g protein, 99 g carbs, 30 g fat. Fix anything?" }, logged: { id: "FOOD-X" } } }), stateDir: dir(), now: NOW });
    expect(fixed.text).toBe("Updated ~800 kcal — pizza slice: 33 g protein, 99 g carbs, 30 g fat. Fix anything?");
    expect(fixed.logged?.id).toBe("FOOD-X");
  });
  it("readFoodPending carries the logged entry's id, and the memory treats 'Fix anything?' as the offer's own line", () => {
    const d = dir();
    writeFileSync(join(d, "food-pending.json"), JSON.stringify({ offers: [{ id: "a", name: "pizza", at: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 60_000).toISOString(), via: "inbox", offerText: "Logged ~630 kcal — pizza: 1 g protein, 1 g carbs, 1 g fat. Fix anything?", logged: { id: "FOOD-9" }, estimate: {} }] }));
    const view = readFoodPending(d, NOW);
    expect(view?.loggedId).toBe("FOOD-9");
    expect(new FoodMemory().bound("s", view!, "Logged ~630 kcal — pizza: 1 g protein, 1 g carbs, 1 g fat. Fix anything?")).toBe(true);
    expect(new FoodMemory().bound("s", view!, "Is this food? I couldn't tell. My guess: x. Log it?")).toBe(true);
  });
  it("readFoodPending counts only the open offers; the logged one is carried apart", () => {
    const d = dir();
    const row = (id: string, name: string, minutes: number, extra: object = {}) => ({ id, name, at: new Date(NOW.getTime() - minutes * 60_000).toISOString(), expiresAt: new Date(NOW.getTime() + 3600_000).toISOString(), via: "inbox", offerText: `${name}.`, estimate: {}, ...extra });
    writeFileSync(join(d, "food-pending.json"), JSON.stringify({ offers: [row("a", "burger", 20), row("b", "pizza", 5, { logged: { id: "FOOD-9" } })] }));
    expect(readFoodPending(d, NOW)).toMatchObject({ loggedId: "FOOD-9", count: 1, names: ["burger"] });
  });
  it("a failure is one honest sentence", async () => {
    const out = await runFoodTurn({ kind: "ask", text: "toast" }, { run: fakeRun({ "--text": { ok: false, error: "the local model took longer than 45 s" } }), stateDir: dir(), now: NOW });
    expect(out.text).toBe("I couldn't estimate that just now (the local model took longer than 45 s), so nothing was logged. Tell me again in a bit.");
  });
  it("a photo in chat points to the phone's food inbox unless an inbox estimate is fresh", async () => {
    const d = dir();
    expect((await runFoodTurn({ kind: "photo" }, { run: fakeRun({}), stateDir: d, now: NOW })).text).toBe(PHOTO_LINE);
    writeFileSync(join(d, "food-pending.json"), JSON.stringify({ id: "fp-9", at: new Date(NOW.getTime() - 5 * 60_000).toISOString(), expiresAt: new Date(NOW.getTime() + 3600_000).toISOString(), via: "inbox", offerText: `Food photo: ${OFFER}`, estimate: {} }));
    expect((await runFoodTurn({ kind: "photo" }, { run: fakeRun({}), stateDir: d, now: NOW })).text).toBe(`Food photo: ${OFFER}`);
  });
  it("a meal he ate is logged at once, then sized, and the offer fills that entry", async () => {
    const d = dir();
    writeFileSync(join(d, "health-log.json"), JSON.stringify({ schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [] }));
    const calls: string[][] = [];
    const run = fakeRun({ "--entry": { ...ESTIMATE, offer: { id: "fp-3", text: `${ESTIMATE.summary}. Add those numbers to your lunch?` } } }, calls);
    const out = await runFoodTurn({ kind: "meal", read: { kind: "meal", meal: "Lunch", title: "Chicken burrito and a coke", notes: "", at: NOW } }, { run, stateDir: d, now: NOW });
    const rows = (JSON.parse(readFileSync(join(d, "health-log.json"), "utf8")) as { nutritionLog: Record<string, Array<{ id: string }>> }).nutritionLog["2026-11-02"]!;
    expect(rows).toHaveLength(1);
    expect(calls[0]).toEqual(["--entry", rows[0]!.id, "--offer", "--json"]);
    expect(out.text).toBe(`Logged lunch at 1:00 PM: Chicken burrito and a coke. That's 1 meal logged for today. My estimate: ${ESTIMATE.summary}. Add those numbers to your lunch?`);
  });
  it("a meal whose estimate fails keeps the plain log reply", async () => {
    const d = dir();
    writeFileSync(join(d, "health-log.json"), JSON.stringify({ schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [] }));
    const out = await runFoodTurn({ kind: "meal", read: { kind: "meal", meal: "Lunch", title: "Pasta", notes: "", at: NOW } }, { run: fakeRun({}), stateDir: d, now: NOW });
    expect(out.text).toBe("Logged lunch at 1:00 PM: Pasta. That's 1 meal logged for today; I couldn't estimate the calories just now.");
  });
});

describe("several offers and a filled meal (wave 14 review)", () => {
  const CHOOSE = { ok: true, choose: [{ id: "a", name: "cheeseburger and fries", kcal: 1138 }, { id: "b", name: "caesar salad", kcal: 318 }], say: 'You have 2 estimates waiting: the cheeseburger and fries (~1138 kcal) and the caesar salad (~318 kcal). Which should I log? Say "the cheeseburger", or "all of them".' };
  const SAID = { ...LOGGED, say: "Logged the cheeseburger and fries, ~1138 kcal (lunch · 49 g protein, 117 g carbs, 54 g fat). 1450 kcal today." };
  it("a yes with several waiting asks which, and logs nothing", async () => {
    const out = await runFoodTurn({ kind: "yes" }, { run: fakeRun({ "log-pending": CHOOSE }), stateDir: dir(), now: NOW });
    expect(out.text).toBe(CHOOSE.say);
    expect(out.logged).toBeUndefined();
  });
  it("a pick logs the one he named and says which", async () => {
    const calls: string[][] = [];
    const out = await runFoodTurn({ kind: "pick", which: "the burger" }, { run: fakeRun({ "log-pending": SAID }, calls), stateDir: dir(), now: NOW });
    expect(calls[0]).toEqual(["log-pending", "--pick", "the burger", "--json"]);
    expect(out.text).toBe('Logged the cheeseburger and fries, ~1138 kcal (lunch · 49 g protein, 117 g carbs, 54 g fat). 1450 kcal today. Say "undo" to take it off.');
    expect(out.logged?.id).toBe(LOGGED.logged.id);
  });
  it("undo of a filled meal says it was put back", async () => {
    const restored = { ok: true, restored: true, entry: { id: "abc-1", title: "Burger and fries", calories: 0 }, day: "2026-11-02", dayCalories: 5 };
    const out = await runFoodTurn({ kind: "undo", id: "abc-1" }, { run: fakeRun({ undo: restored }), stateDir: dir(), now: NOW });
    expect(out.text).toBe("Put burger and fries back as it was (0 kcal). 5 kcal today.");
  });
  it("a no that names an offer sends the name; a choose answer is relayed", async () => {
    const calls: string[][] = [];
    const named = await runFoodTurn({ kind: "no", which: "nah not the salad" }, { run: fakeRun({ discard: { ok: true, discarded: 1 } }, calls), stateDir: dir(), now: NOW });
    expect(calls[0]).toEqual(["discard", "--pick", "nah not the salad", "--json"]);
    expect(named.text).toBe("Okay, not logged.");
    const ask = await runFoodTurn({ kind: "no" }, { run: fakeRun({ discard: CHOOSE }), stateDir: dir(), now: NOW });
    expect(ask.text).toBe(CHOOSE.say);
  });
  it("a correction that names an offer revises that one; an unnamed one with several waiting is asked back", async () => {
    const calls: string[][] = [];
    await runFoodTurn({ kind: "revise", correction: "the burger was small", which: "the burger was small" }, { run: fakeRun({ "--revise": ESTIMATE }, calls), stateDir: dir(), now: NOW });
    expect(calls[0]).toEqual(["--revise", "the burger was small", "--pick", "the burger was small", "--json"]);
    const ask = await runFoodTurn({ kind: "revise", correction: "it was small" }, { run: fakeRun({ "--revise": CHOOSE }), stateDir: dir(), now: NOW });
    expect(ask.text).toBe(CHOOSE.say);
  });
  it("logging several at once remembers every id, and undo removes them all", async () => {
    const both = { ...SAID, logged: { ...LOGGED.logged, id: "FOOD-b", ids: ["FOOD-a", "FOOD-b"] } };
    const logged = await runFoodTurn({ kind: "pick", which: "both" }, { run: fakeRun({ "log-pending": both }), stateDir: dir(), now: NOW });
    expect(logged.logged).toEqual({ id: "FOOD-b", ids: ["FOOD-a", "FOOD-b"] });
    const memory = new FoodMemory();
    memory.logged("s", logged.logged!.id, 1000, logged.logged!.ids);
    expect(memory.lastLogged("s")).toEqual({ id: "FOOD-b", ids: ["FOOD-a", "FOOD-b"], at: 1000 });
    const calls: string[][] = [];
    const removal = (args: string[]) => ({ ok: true, removed: { id: args[1], title: args[1] === "FOOD-a" ? "Cheeseburger" : "Salad", calories: 500 }, day: "2026-11-02", dayCalories: args[1] === "FOOD-a" ? 800 : 300 });
    const run: FoodRun = async (args) => { calls.push(args); return { stdout: JSON.stringify(removal(args)), code: 0 }; };
    const undone = await runFoodTurn({ kind: "undo", id: "FOOD-b", ids: ["FOOD-a", "FOOD-b"] }, { run, stateDir: dir(), now: NOW });
    expect(calls.map((c) => c[1])).toEqual(["FOOD-a", "FOOD-b"]);
    expect(undone.text).toBe("Took cheeseburger and salad off (1000 kcal). 300 kcal today.");
  });
  it("a single log still remembers one id", () => {
    const memory = new FoodMemory();
    memory.logged("s", "FOOD-a", 5);
    expect(memory.lastLogged("s")).toEqual({ id: "FOOD-a", ids: ["FOOD-a"], at: 5 });
  });
  it("readFoodPending reads the keyed file: the newest live offer, with how many wait and their names", () => {
    const d = dir();
    const row = (id: string, name: string, minutes: number) => ({ id, name, at: new Date(NOW.getTime() - minutes * 60_000).toISOString(), expiresAt: new Date(NOW.getTime() + 3600_000).toISOString(), via: "inbox", offerText: `Food photo: ${name}. Log it?`, estimate: {} });
    writeFileSync(join(d, "food-pending.json"), JSON.stringify({ offers: [row("a", "cheeseburger and fries", 20), row("b", "caesar salad", 10), { ...row("c", "old toast", 300), expiresAt: new Date(NOW.getTime() - 1000).toISOString() }] }));
    expect(readFoodPending(d, NOW)).toEqual({ at: NOW.getTime() - 10 * 60_000, via: "inbox", offerText: "Food photo: caesar salad. Log it?", count: 2, names: ["cheeseburger and fries", "caesar salad"] });
  });
});

describe("readFoodPending and FoodMemory", () => {
  it("reads a live offer and ignores an expired one", () => {
    const d = dir();
    expect(readFoodPending(d, NOW)).toBeUndefined();
    writeFileSync(join(d, "food-pending.json"), JSON.stringify({ at: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 60_000).toISOString(), via: "chat", offerText: OFFER, estimate: {} }));
    expect(readFoodPending(d, NOW)?.offerText).toBe(OFFER);
    expect(readFoodPending(d, new Date(NOW.getTime() + 120_000))).toBeUndefined();
  });
  it("a turn about something else after the offer unbinds it", () => {
    const m = new FoodMemory();
    const pending = { at: NOW.getTime(), via: "chat" as const, offerText: OFFER };
    expect(m.bound("s", pending)).toBe(true);
    m.otherTurn("s", NOW.getTime() + 1000);
    expect(m.bound("s", pending)).toBe(false);
    expect(m.bound("s", pending, "Gym, now")).toBe(false);
    expect(new FoodMemory().bound("s", pending, "Some other push")).toBe(false);
    expect(new FoodMemory().bound("s", pending, OFFER)).toBe(true);
  });
});

// ---- through the real routing ----
type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function route(foodRun: FoodRun) {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (n: string, fn: Handler) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
  const fire = async (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => { const o: unknown[] = []; for (const fn of handlers.get(n) ?? []) o.push(await fn(e, c)); return o; };
  const d = dir();
  writeFileSync(join(d, "health-log.json"), JSON.stringify({ schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [] }));
  const flows: string[] = [];
  let clock = NOW.getTime();
  registerLocalRouting(api, { warm: false, mode: "on", logPath: join(d, "r.jsonl"), progressDir: join(d, "tp"), stateDir: d, clock: () => "Mon 13:00", now: () => new Date(clock),
    decideImpl: async () => ({ move: "answer", answer: "Sounds tasty!" }) as Decision, brainSearch: async () => "",
    scheduleFlow: async (m: string) => { flows.push(m); return { outcome: "fallback", reason: "test" }; },
    readDayJson: async () => undefined, readDeadlines: async () => ({ events: [], tasks: [] }), listReminders: async () => [], foodRun,
  } as never);
  let n = 0;
  const turn = async (prompt: string, extra: Record<string, unknown> = {}) => {
    clock += 30_000;
    const ctx = { runId: `f-${n += 1}`, sessionKey: "agent:main:orion-chat-food" };
    await fire("before_model_resolve", { prompt, ...extra }, ctx);
    const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx)) as Array<{ reply?: { text: string } } | undefined>;
    await fire("before_prompt_build", { prompt, messages: [] }, ctx);
    return direct?.reply?.text;
  };
  return { turn, dir: d, flows, offer: (text: string) => writeFileSync(join(d, "food-pending.json"), JSON.stringify({ id: "fp-x", at: new Date(clock).toISOString(), expiresAt: new Date(clock + 1800_000).toISOString(), via: "chat", offerText: text, estimate: {} })) };
}

describe("food through the routing", () => {
  it("ask → offer, then yes → logged; the desk never answers either", async () => {
    const calls: string[][] = [];
    let r: ReturnType<typeof route>;
    const run: FoodRun = async (args) => { calls.push(args); if (args[0] === "--text") { r.offer(OFFER); return { stdout: JSON.stringify(ESTIMATE), code: 0 }; } return { stdout: JSON.stringify(LOGGED), code: 0 }; };
    r = route(run);
    expect(await r.turn("how many calories in a chicken burrito and a coke")).toBe(OFFER);
    expect(await r.turn("yeah log it")).toMatch(/^Logged chicken burrito and coke as lunch: 667 kcal/);
    expect(calls.map((c) => c[0])).toEqual(["--text", "log-pending"]);
  });
  it("his protein question is answered and offered, with nothing logged until the yes (2026-11-04)", async () => {
    const calls: string[][] = [];
    let r: ReturnType<typeof route>;
    const ANSWER = "About 6 g of protein (and ~190 kcal). Want me to log it?";
    const run: FoodRun = async (args) => { calls.push(args); if (args[0] === "--text") { r.offer(ANSWER); return { stdout: JSON.stringify({ ...ESTIMATE, offer: { id: "fp-1", text: ANSWER } }), code: 0 }; } return { stdout: JSON.stringify(LOGGED), code: 0 }; };
    r = route(run);
    expect(await r.turn("how much protein is a Nature Valley protein salted caramel nut bar?")).toBe(ANSWER);
    expect(calls.map((c) => c[0])).toEqual(["--text"]);
    expect(calls[0]).toContain("--ask");
    expect(calls.flat()).not.toContain("--log");
    expect(await r.turn("yeah")).toMatch(/^Logged /);
    expect(calls.map((c) => c[0])).toEqual(["--text", "log-pending"]);
  });
  it("a yes after an unrelated turn is not the food's", async () => {
    const calls: string[][] = [];
    let r: ReturnType<typeof route>;
    const run: FoodRun = async (args) => { calls.push(args); if (args[0] === "--text") r.offer(OFFER); return { stdout: JSON.stringify(ESTIMATE), code: 0 }; };
    r = route(run);
    await r.turn("how many calories in a bagel");
    await r.turn("what's the weather like");
    await r.turn("yes");
    expect(calls.map((c) => c[0])).toEqual(["--text"]);
  });
  it("an image attachment in chat gets the food-inbox pointer, not a desk draft", async () => {
    const r = route(async () => ({ stdout: "{}", code: 1 }));
    expect(await r.turn("log this", { attachments: [{ kind: "image", mimeType: "image/jpeg" }] })).toBe(PHOTO_LINE);
  });
  it("without a food runner nothing changes: the meal is logged the old way", async () => {
    const r = route(undefined as unknown as FoodRun);
    expect(await r.turn("how many calories in a bagel")).not.toBe(OFFER);
  });
});

import { instructionsFor } from "./local-routing.js";
import { FOOD_TOOL, GENERAL_INSTRUCTIONS } from "./job-instructions.js";
describe("the worker's toolbelt", () => {
  it("carries orion-food-estimate on a food turn, and stays inside the general budget otherwise", () => {
    expect(instructionsFor(undefined, "how much protein was in that burrito")).toContain("orion-food-estimate --text");
    expect(instructionsFor(undefined, "turn the lights on")).toBe(GENERAL_INSTRUCTIONS);
    expect(FOOD_TOOL).toMatch(/never guess the numbers/);
  });
});
