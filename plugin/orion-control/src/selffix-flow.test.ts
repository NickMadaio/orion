import { describe, expect, it } from "vitest";
import { asksFix, asksWhy, laterAt, readSelffixMove, runSelffixMove, spokenWhen, type SelffixRun } from "./selffix-flow.js";
import type { FixItem } from "./selffix-store.js";

const NOW = new Date(2026, 10, 4, 14, 0, 0);
const iso = (d: Date): string => d.toISOString();
const offered: FixItem = { id: "sf-aaaaaa", signature: "wrong-tool:app_open", title: "t", status: "offered", offeredAt: iso(new Date(NOW.getTime() - 10 * 60_000)) };
const ctx = (items: FixItem[] = [], extra = {}) => ({ stateDir: "/x", now: NOW, items, bound: true, ...extra });

describe("why phrasings (held-out, casual)", () => {
  it.each([
    "why did you do that", "why'd you say that", "whyd u say amazon isnt a site", "that was wrong", "thats wrong lol", "you messed up",
    "u messed that up", "why didnt you open safari", "why didn't you just open it", "u got that wrong", "what went wrong there", "why would you open an app called amazon uk",
  ])("%s is a why", (m) => { expect(asksWhy(m)).toBe(true); expect(readSelffixMove(m, ctx())?.kind).toBe("why"); });
  it.each(["why is the sky blue", "open safari for me", "why am i so tired", "what time is gym", "remind me why i started this"])("%s is not", (m) => {
    expect(readSelffixMove(m, ctx())).toBeUndefined();
  });
  it.each(["why did u put get a gp first??", "why did you schedule gym before class", "why did you put econ at 9"])("%s is about his plan, left to the plan-why flow", (m) => {
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
  it("an answer binds only when the offer was ORION's last message in that chat", () => {
    for (const m of ["yes", "no", "later", "tomorrow at 9", "start it"]) expect(readSelffixMove(m, ctx([offered], { bound: false }))).toBeUndefined();
    expect(readSelffixMove("yes", { stateDir: "/x", now: NOW, items: [offered] })).toBeUndefined();
  });
  it.each([
    "ok set a 25 min timer", "start my focus session", "tomorrow i have a quiz", "no i dont think the gym is open", "sure what time is it", "yes i finished the quiz",
    "later i need to study for econ", "no add gym tomorrow", "start the gym block", "tonight im going out", "ok remind me at 5",
  ])("%s is not an answer to the fix offer even while it is waiting", (m) => {
    expect(readSelffixMove(m, ctx([offered]))).toBeUndefined();
  });
  it.each(["yes.", "Yes please", "ok", "Now!", "tonight", "tomorrow morning", "at 8pm", "tomorrow at 9am", "no thanks", "skip", "nvm"])("%s is a bare answer", (m) => {
    expect(readSelffixMove(m, ctx([offered]))).toBeDefined();
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

describe("fix requests (his exact words, then held-out)", () => {
  it.each([
    "Can you modify something in your own code?", "can you go ahead and go into the code and fix it", "go into the code and fix it", "can you fix that yourself",
    "fix your code", "Fix your code.", "can u fix ur code", "fix it yourself", "fix urself pls", "go in and fix your own code", "can you change your own code to fix that",
    "just go into your code and fix it lol", "ok so fix ur code then", "can you fix yourself", "modify your code so it stops doing that", "why dont you just fix your code",
    "can you edit your own code", "i want you to fix that in your code",
  ])("%s is a fix request", (m) => { expect(asksFix(m)).toBe(true); expect(readSelffixMove(m, ctx())).toEqual({ kind: "fix", about: m.trim() }); });
  it.each([
    "fix my resume", "can you fix the wifi", "fix it", "fix that", "update yourself", "how do i fix my code", "can you fix the bug in my project code", "open vs code",
    "what does your code do", "fix the typo in my essay", "remind me to fix the sink", "my code wont compile can you fix it", "can you fix this sentence for me",
  ])("%s is not", (m) => { expect(asksFix(m)).toBe(false); expect(readSelffixMove(m, ctx())?.kind).not.toBe("fix"); });
  it("a fix request to one of his own pushes is left to the outreach flow", () => {
    expect(readSelffixMove("fix your code", ctx([], { outreach: true }))).toBeUndefined();
  });
  it("it wins over a waiting offer: 'fix your code' while an offer is open is a request, not a bare answer", () => {
    expect(readSelffixMove("fix your code", ctx([offered]))?.kind).toBe("fix");
  });
});

const started = { ok: true, status: "started", item: { id: "sf-1", title: "Fix: wrong tool on \"open amazon uk\"", status: "started" } };
const item = (status: string, extra = {}) => ({ id: "sf-1", title: "Fix: wrong tool on \"open amazon uk\"", status, projectId: "project-1", ...extra });
const FIX = { kind: "fix", about: "go into the code and fix it" } as const;
const fixable = { ok: true, diagnosis: { says: "You asked me to fix this.", fixable: true, kind: "requested" } };

/** w20 r4: "fix your code" confirms the subject in one line first; this runs the ask, then his yes, on the same script. */
async function confirmed(move: Parameters<typeof runSelffixMove>[0], run: ReturnType<typeof script>) {
  const ask = await runSelffixMove(move, run, NOW);
  expect(ask.text).toMatch(/^I'll start a fix for: .+\. Go\?$/);
  expect(run.calls.some((c) => /^orion-selffix (?:propose|accept|start)/.test(c))).toBe(false);   // nothing is created or started before his yes
  expect(ask.hold).toBeDefined();
  return runSelffixMove({ kind: "fix-go", hold: ask.hold! }, run, NOW);
}

describe("running a fix request", () => {
  it("no earlier diagnosis: diagnoses with --request, proposes, accepts now, and says what started and where to watch it", async () => {
    const run = script({ "orion-selffix list": { ok: true, items: [] }, "orion-selfcheck why": fixable, "orion-selffix propose": { ok: true, status: "offered", item: item("offered") }, "orion-selffix accept": started });
    const out = await confirmed(FIX, run);
    expect(run.calls[1]).toMatch(/^orion-selfcheck why .*--request --json$/);
    expect(run.calls.some((c) => c.startsWith("orion-selffix propose --stdin --requested"))).toBe(true);
    expect(run.calls.at(-1)).toBe("orion-selffix accept sf-1 --now");
    expect(out.text).toMatch(/started a fix project/i);
    expect(out.text).toContain("open amazon uk");
    expect(out.text).toMatch(/Projects tab/);
    expect(out.text).toMatch(/nothing edits my live code directly/);
    expect(out.offered).toBeUndefined();
  });
  it("reuses a recent offered diagnosis: no new diagnosis, no second propose", async () => {
    const run = script({ "orion-selffix list": { ok: true, items: [item("offered", { offeredAt: new Date(NOW.getTime() - 3600_000).toISOString() })] }, "orion-selffix accept": started });
    const out = await confirmed(FIX, run);
    expect(run.calls.map((c) => c.split(" ").slice(0, 2).join(" "))).toEqual(["orion-selffix list", "orion-selffix accept"]);
    expect(out.text).toMatch(/Projects tab/);
  });
  it("a parked project is started, not duplicated", async () => {
    const run = script({ "orion-selffix list": { ok: true, items: [item("parked", { remindAt: new Date(NOW.getTime() + 3600_000).toISOString() })] }, "orion-selffix start": started });
    const out = await confirmed(FIX, run);
    expect(run.calls.at(-1)).toBe("orion-selffix start sf-1");
    expect(out.text).toMatch(/Projects tab/);
  });
  it("one already started: said once, nothing else runs", async () => {
    const run = script({ "orion-selffix list": { ok: true, items: [item("started", { startedAt: new Date(NOW.getTime() - 600_000).toISOString() })] } });
    const out = await runSelffixMove(FIX, run, NOW);
    expect(run.calls).toHaveLength(1);
    expect(out.text).toMatch(/already started/);
    expect(out.text).toMatch(/Projects tab/);
  });
  it("the second ask while the first is open is a duplicate from propose: still one project", async () => {
    const run = script({ "orion-selffix list": { ok: true, items: [] }, "orion-selfcheck why": fixable, "orion-selffix propose": { ok: true, status: "duplicate", item: item("started") } });
    const out = await confirmed(FIX, run);
    expect(run.calls.some((c) => c.startsWith("orion-selffix accept"))).toBe(false);
    expect(out.text).toMatch(/already started/);
  });
  it("a refused start (execution disabled) is one message with the exact reason, and nothing is retried", async () => {
    const run = script({ "orion-selffix list": { ok: true, items: [item("offered", { offeredAt: NOW.toISOString() })] }, "orion-selffix accept": { ok: true, status: "parked", reason: "Execution is disabled. Choose Enable & start to enable local execution.", remindAt: new Date(2026, 10, 4, 19, 30).toISOString() } });
    const out = await confirmed(FIX, run);
    expect(out.text).toMatch(/couldn't start it/);
    expect(out.text).toContain("Execution is disabled. Choose Enable & start to enable local execution.");
    expect(out.text).toMatch(/Projects tab/);
    expect(run.calls.filter((c) => c.startsWith("orion-selffix accept"))).toHaveLength(1);
    expect(out.offered).toBeUndefined();
  });
  it("a script failure says why from its own words and stops", async () => {
    const run = (async (s: string, a: string[]) => (a[0] === "list" ? { stdout: JSON.stringify({ ok: true, items: [] }), code: 0 } : s === "orion-selfcheck" ? { stdout: JSON.stringify(fixable), code: 0 } : a[0] === "propose" ? { stdout: JSON.stringify({ ok: true, status: "offered", item: item("offered") }), code: 0 } : { stdout: "", code: 3, stderr: "NOTHING WAS CHANGED: the project could not be created: disk full" })) as SelffixRun;
    const ask = await runSelffixMove(FIX, run, NOW);
    const out = await runSelffixMove({ kind: "fix-go", hold: ask.hold! }, run, NOW);
    expect(out.text).toContain("disk full");
    expect(out.text).toMatch(/nothing was started/);
  });
  it("nothing on record and an unreadable record are both said plainly, with no project", async () => {
    const none = script({ "orion-selffix list": { ok: true, items: [] }, "orion-selfcheck why": { ok: true, diagnosis: null } });
    expect((await runSelffixMove(FIX, none, NOW)).text).toMatch(/nothing was started/);
    expect(none.calls.some((c) => c.startsWith("orion-selffix propose"))).toBe(false);
    const broken = script({ "orion-selffix list": { ok: true, items: [] } });
    expect((await runSelffixMove(FIX, broken, NOW)).text).toMatch(/couldn't read back/);
  });
});
