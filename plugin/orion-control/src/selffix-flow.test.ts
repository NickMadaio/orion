import { describe, expect, it } from "vitest";
import { asksWhy, laterAt, readSelffixMove, runSelffixMove, spokenWhen, type SelffixRun } from "./selffix-flow.js";
import type { FixItem } from "./selffix-store.js";

const NOW = new Date(2026, 10, 4, 14, 0, 0);
const iso = (d: Date): string => d.toISOString();
const offered: FixItem = { id: "sf-aaaaaa", signature: "wrong-tool:app_open", title: "t", status: "offered", offeredAt: iso(new Date(NOW.getTime() - 10 * 60_000)) };
const ctx = (items: FixItem[] = [], extra = {}) => ({ stateDir: "/x", now: NOW, items, ...extra });

describe("why phrasings (held-out, casual)", () => {
  it.each([
    "why did you do that", "why'd you say that", "whyd u say amazon isnt a site", "that was wrong", "thats wrong lol", "you messed up",
    "u messed that up", "why didnt you open safari", "why didn't you just open it", "u got that wrong", "what went wrong there", "why would you open an app called amazon uk",
  ])("%s is a why", (m) => { expect(asksWhy(m)).toBe(true); expect(readSelffixMove(m, ctx())?.kind).toBe("why"); });
  it.each(["why is the sky blue", "open safari for me", "why am i so tired", "what time is gym", "remind me why i started this"])("%s is not", (m) => {
    expect(readSelffixMove(m, ctx())).toBeUndefined();
  });
  it("a why to one of his own pushes is left to the outreach flow", () => {
    expect(readSelffixMove("why did you tell me that", ctx([], { outreach: true }))).toBeUndefined();
  });
});

describe("answering the offer", () => {
  it.each(["yes", "yeah do it", "now pls", "sure", "start it", "yep go for it"])("%s -> now", (m) => expect(readSelffixMove(m, ctx([offered]))).toEqual({ kind: "now", id: "sf-aaaaaa" }));
  it.each(["no", "nah dont", "nope not needed", "nvm"])("%s -> no", (m) => expect(readSelffixMove(m, ctx([offered]))).toEqual({ kind: "no", id: "sf-aaaaaa" }));
  it.each(["later", "not now", "tonight", "tomorrow", "after dinner", "yeah later"])("%s -> later", (m) => expect(readSelffixMove(m, ctx([offered]))?.kind).toBe("later"));
  it("later carries the time he named", () => {
    const m = readSelffixMove("tomorrow at 9", ctx([offered]));
    expect(m).toMatchObject({ kind: "later", id: "sf-aaaaaa" });
    expect(new Date((m as { at: string }).at).getHours()).toBe(9);
    expect(new Date((m as { at: string }).at).getDate()).toBe(5);
  });
  it("answers nothing without an open offer, or after 3 hours, or when he asks for something else", () => {
    expect(readSelffixMove("yes", ctx())).toBeUndefined();
    expect(readSelffixMove("yes", ctx([{ ...offered, offeredAt: iso(new Date(NOW.getTime() - 4 * 3600_000)) }]))).toBeUndefined();
    expect(readSelffixMove("no add gym tomorrow", ctx([offered]))).toBeUndefined();
    expect(readSelffixMove("sure what time is it?", ctx([offered]))).toBeUndefined();
  });
  it("yes to a reminder that fired starts the parked project; later re-parks it", () => {
    const parked: FixItem = { id: "sf-bbbbbb", signature: "s", title: "t", status: "parked", projectId: "project-1", remindAt: iso(new Date(NOW.getTime() - 20 * 60_000)) };
    expect(readSelffixMove("yeah start it", ctx([parked]))).toEqual({ kind: "start", id: "sf-bbbbbb" });
    expect(readSelffixMove("later", ctx([parked]))).toMatchObject({ kind: "later", id: "sf-bbbbbb", reparking: true });
    expect(readSelffixMove("start the fix project", ctx([{ ...parked, remindAt: iso(new Date(NOW.getTime() + 3600_000)) }]))).toEqual({ kind: "start", id: "sf-bbbbbb" });
  });
});

describe("laterAt and spokenWhen", () => {
  it("reads clocks and days, leaves the default evening to the script", () => {
    expect(laterAt("later", NOW)).toBeUndefined();
    expect(new Date(laterAt("tonight at 8", NOW)!).getHours()).toBe(20);
    expect(new Date(laterAt("tomorrow", NOW)!).getHours()).toBe(19);
    expect(new Date(laterAt("in the morning", NOW)!).getDate()).toBe(5);
    expect(spokenWhen(new Date(2026, 10, 4, 19, 30).toISOString(), NOW)).toBe("tonight at 7:30 PM");
    expect(spokenWhen(new Date(2026, 10, 5, 9, 0).toISOString(), NOW)).toBe("tomorrow at 9:00 AM");
  });
});

const script = (replies: Record<string, unknown>): SelffixRun & { calls: string[] } => {
  const calls: string[] = [];
  const run = (async (s: string, args: string[]) => {
    calls.push(`${s} ${args.join(" ")}`);
    const hit = replies[`${s} ${args[0]}`];
    return hit === undefined ? { stdout: "", code: 1 } : { stdout: JSON.stringify(hit), code: 0 };
  }) as SelffixRun & { calls: string[] };
  run.calls = calls;
  return run;
};
const diag = { ok: true, diagnosis: { says: "I treated \"amazon uk\" as an app name, so I tried to open an app that doesn't exist. That's a routing mistake on my side.", fixable: true } };

describe("running a move", () => {
  it("why: answers in first person, from the record, and offers now or later", async () => {
    const run = script({ "orion-selfcheck why": diag, "orion-selffix propose": { ok: true, status: "offered", item: { id: "sf-1", status: "offered" } } });
    const out = await runSelffixMove({ kind: "why", about: "why didnt you open amazon" }, run, NOW);
    expect(out.text).toMatch(/^I treated "amazon uk" as an app name/);
    expect(out.text).toMatch(/I can open a fix project for this\. Start on it now, or later\?$/);
    expect(run.calls.some((c) => c.startsWith("orion-selffix accept"))).toBe(false);
  });
  it("why: an unfixable cause is not offered as a fix", async () => {
    const run = script({ "orion-selfcheck why": { ok: true, diagnosis: { says: "It was refused: permission denied.", fixable: false } } });
    const out = await runSelffixMove({ kind: "why", about: "why" }, run, NOW);
    expect(out.text).toBe("It was refused: permission denied.");
    expect(run.calls).toHaveLength(1);
  });
  it("why: an open fix for the same issue is named, not duplicated", async () => {
    const run = script({ "orion-selfcheck why": diag, "orion-selffix propose": { ok: true, status: "duplicate", item: { id: "sf-1", status: "parked" } } });
    const out = await runSelffixMove({ kind: "why", about: "why" }, run, NOW);
    expect(out.text).toMatch(/already have a fix project for this \(parked, waiting for you to start it\), so I won't open another/);
    expect(out.text).not.toMatch(/Start on it now/);
  });
  it("why: nothing on record and a failed read are both said plainly", async () => {
    expect((await runSelffixMove({ kind: "why", about: "x" }, script({ "orion-selfcheck why": { ok: true, diagnosis: null } }), NOW)).text).toMatch(/no recent turns/);
    expect((await runSelffixMove({ kind: "why", about: "x" }, script({}), NOW)).text).toMatch(/couldn't read back/);
  });
  it("now: says it started and that it runs through the project pipeline with its reviews", async () => {
    const out = await runSelffixMove({ kind: "now", id: "sf-1" }, script({ "orion-selffix accept": { ok: true, status: "started" } }), NOW);
    expect(out.text).toMatch(/starting the fix project now/);
    expect(out.text).toMatch(/normal project pipeline with its reviews, so nothing edits my live code directly/);
  });
  it("now: a refused start is said as parked with its reason and reminder", async () => {
    const out = await runSelffixMove({ kind: "now", id: "sf-1" }, script({ "orion-selffix accept": { ok: true, status: "parked", reason: "Execution is disabled.", remindAt: new Date(2026, 10, 4, 19, 30).toISOString() } }), NOW);
    expect(out.text).toMatch(/didn't start \(Execution is disabled\.\)/);
    expect(out.text).toMatch(/tonight at 7:30 PM/);
  });
  it("later: passes the time, says it is parked and when the reminder is, never claims it started", async () => {
    const run = script({ "orion-selffix accept": { ok: true, status: "parked", remindAt: new Date(2026, 10, 5, 9, 0).toISOString() } });
    const out = await runSelffixMove({ kind: "later", id: "sf-1", at: "2026-11-05T09:00:00.000Z" }, run, NOW);
    expect(run.calls[0]).toBe("orion-selffix accept sf-1 --later --at 2026-11-05T09:00:00.000Z");
    expect(out.text).toMatch(/parked it\. It won't run until you say so\. I'll remind you tomorrow at 9:00 AM/);
  });
  it("no: records the decision; a script failure is not reported as done", async () => {
    expect((await runSelffixMove({ kind: "no", id: "sf-1" }, script({ "orion-selffix decline": { ok: true } }), NOW)).text).toMatch(/dropped it/);
    expect((await runSelffixMove({ kind: "now", id: "sf-1" }, script({}), NOW)).text).toMatch(/nothing was started/);
    expect((await runSelffixMove({ kind: "later", id: "sf-1" }, script({}), NOW)).text).toMatch(/nothing was created/);
  });
});
