import { describe, expect, it } from "vitest";
import { readFollowUp, readLedgerAsk } from "./ledger-ask.js";
import { runLedgerAsk, type LedgerDeps, type JournalEntry } from "./ledger-run.js";
import { MadeLedger, madeBy } from "./made-ledger.js";
import type { Day } from "./schedule-flow.js";
import type { StoredReminder } from "./reminder-flow.js";

const NOW = new Date(2030, 9, 8, 15, 0).getTime();
const iso = (h: number, m = 0) => new Date(2030, 9, 8, h, m).toISOString();
const day = (blocks: Array<[string, string, string, (boolean | string)?]>): Day => ({ date: "2030-10-08", now: "15:00", blocks: blocks.map(([title, start, end, made]) => ({ title, start, end, fixed: false, ...(made ? { made: true, id: typeof made === "string" ? made : `id-${title}` } : {}) })) });
type Call = [string, string[]];
function deps(over: Partial<Omit<LedgerDeps, "reminders">> & { days?: Day[]; scripts?: Record<string, string>; reminders?: StoredReminder[] } = {}): { d: LedgerDeps; calls: Call[]; store: StoredReminder[] } {
  const { reminders: seeded, days: seededDays, scripts, ...rest } = over;
  const calls: Call[] = []; const store = [...(seeded ?? [])]; const days = [...(seededDays ?? [day([])])];
  const d: LedgerDeps = {
    run: async (script, args) => { calls.push([script, args]); return { stdout: scripts?.[`${script} ${args[0]}`] ?? "", code: 0 }; },
    readDay: async () => days.length > 1 ? days.shift()! : days[0]!,
    items: [], journal: () => [], now: NOW, nothingText: "NOTHING", reminders: { list: async () => [...store], remove: async (ids) => { for (const id of ids) store.splice(store.findIndex((r) => r.id === id), 1); } },
    ...rest,
  };
  return { d, calls, store };
}
const rem = (id: string, label: string): StoredReminder => ({ id, label, dueAt: NOW + 3600_000 });

describe("reader", () => {
  it.each(["undo", "undo that last move", "ok undo", "revert that", "undo it pls"])("%s is a strong bare undo", (m) => {
    const a = readLedgerAsk(m)!; expect(a.bare).toBe(true); expect(a.strong).toBe(true);
  });
  it.each(["put the learning plan back where it was", "put the gym back to how it was", "set study back as it was"])("%s is a put-back", (m) => {
    const a = readLedgerAsk(m)!; expect(a.verb).toBe("undo"); expect(a.targets.length).toBe(1);
  });
  it.each(["scrap the gym block i just added", "delete that note i just made", "get rid of the reminder i just set", "remove that water i logged", "nuke the thing i just added"])("%s points at a made thing", (m) => {
    const a = readLedgerAsk(m)!; expect(a.verb).toBe("remove"); expect(a.strong).toBe(true);
  });
  it("splits two reminders", () => { expect(readLedgerAsk("cancel the stretch one and the careers one")!.targets).toEqual([["stretch"], ["career"]]); });
  it("reads dont need it anymore", () => { expect(readLedgerAsk("dont need the stretch reminder anymore")!.kinds).toEqual(["reminder"]); });
  it("reads the food tail", () => { const a = readLedgerAsk("take the big mac back off, i didnt have it")!; expect(a.kinds).toContain("food"); expect(a.targets[0]).toEqual(["big", "mac"]); });
  it("a weak block removal is weak", () => { expect(readLedgerAsk("take the call with mum off my day")!.strong).toBe(false); });
  it.each(["whats on today", "move gym to 7", "undo, i meant add those"])("%s is not a ledger ask", (m) => { expect(readLedgerAsk(m)?.strong ?? false).toBe(false); });
});

describe("ledger", () => {
  it("reads what tools made, never what was said", () => {
    expect(madeBy({ canonical: 'exec orion-reschedule add "Call with mum" 40 --at 17:00', stdout: "Changed Tuesday" }, 1)[0]).toMatchObject({ kind: "block", label: "Call with mum" });
    expect(madeBy({ canonical: "exec orion-reschedule add Gym 60 --at 05:30", stdout: "NOTHING WAS CHANGED: x" }, 1)).toEqual([]);
    expect(madeBy({ canonical: 'exec orion-brain learn "Nick" "note" <his full text>', stdout: 'Added to "Nick": went through the plan' }, 1)[0]).toMatchObject({ kind: "note", label: "went through the plan" });
    expect(madeBy({ canonical: "exec orion-log water 3", stdout: "Logged 3 bottles: 9 of 9 today." }, 1)[0]).toMatchObject({ kind: "water", count: 3 });
    expect(madeBy({ canonical: 'tool_call {"id":"x","args":{"steps":[{"action":"alarm_set","at":"2026-11-05T16:00","label":"stretch"}]}}', stdout: "ok" }, 1)[0]).toMatchObject({ kind: "reminder", label: "stretch" });
  });
  it("a chat only sees its own, and entries expire", () => {
    const l = new MadeLedger(); l.record("a", { kind: "note", label: "x", at: NOW });
    expect(l.recent("a", NOW + 1000).length).toBe(1); expect(l.recent("b", NOW)).toEqual([]); expect(l.recent("a", NOW + 4 * 3600_000)).toEqual([]);
  });
});

describe("undo reads the calendar back", () => {
  const journal: JournalEntry[] = [{ at: new Date(NOW - 60_000).toISOString(), steps: [{ op: "move", title: "Go over Orion learning plan", start: iso(12, 25), end: iso(13, 25) }] }];
  it("states the times the calendar shows, not the model's", async () => {
    const { d, calls } = deps({ journal: () => journal, calendar: { since: NOW - 600_000, last: NOW - 60_000 }, days: [day([["Go over Orion learning plan", "12:25", "13:25"]])] });
    const out = (await runLedgerAsk(readLedgerAsk("undo")!, d))!;
    expect(calls[0]).toEqual(["orion-reschedule", ["undo"]]);
    expect(out.text).toBe("Go over Orion learning plan is back at 12:25 PM–1:25 PM.");
    expect(out.wroteCalendar).toBe(true);
  });
  it("never claims a restore the calendar does not show", async () => {
    const lecture: JournalEntry[] = [{ at: new Date(NOW - 1000).toISOString(), steps: [{ op: "delete", title: "CS1800 Lecture", start: iso(9), end: iso(10, 30) }] }];
    const { d } = deps({ journal: () => lecture, calendar: { since: NOW - 600_000, last: NOW - 1000 }, days: [day([])] });
    expect((await runLedgerAsk(readLedgerAsk("undo")!, d))!.text).toMatch(/can't see it on your calendar/);
  });
  it("a day-old journal entry is not this chat's: nothing to undo, and undo never runs", async () => {
    const old: JournalEntry[] = [{ at: new Date(NOW - 20 * 3600_000).toISOString(), steps: [{ op: "move", title: "Gym", start: iso(9), end: iso(10) }] }];
    const { d, calls } = deps({ journal: () => old, calendar: { since: NOW - 600_000, last: NOW - 300_000 } });
    expect((await runLedgerAsk(readLedgerAsk("undo")!, d))!.text).toBe("NOTHING");
    expect(calls).toEqual([]);
  });
  it("no changes in this chat at all: nothing to undo", async () => {
    const { d, calls } = deps({ journal: () => journal });
    expect((await runLedgerAsk(readLedgerAsk("undo")!, d))!.text).toBe("NOTHING"); expect(calls).toEqual([]);
  });
  it("put X back where it was runs the undo only when the last change was X", async () => {
    const mk = () => deps({ journal: () => journal, calendar: { since: NOW - 600_000, last: NOW - 60_000 }, days: [day([["Go over Orion learning plan", "12:25", "13:25"]])] });
    const yes = mk(); expect((await runLedgerAsk(readLedgerAsk("put the learning plan back where it was")!, yes.d))!.text).toMatch(/back at 12:25 PM/);
    const no = mk(); const out = (await runLedgerAsk(readLedgerAsk("put the gym back where it was")!, no.d))!;
    expect(out.text).toMatch(/last thing I changed was Go over Orion learning plan/); expect(no.calls).toEqual([]);
  });
});

describe("removal by description", () => {
  it("scrap the gym block i just added drops the block from the ledger and reads the day back", async () => {
    const { d, calls } = deps({ items: [{ kind: "block", label: "Gym", at: NOW - 1000 }], days: [day([["Gym", "19:00", "20:00", true]]), day([])] });
    const out = (await runLedgerAsk(readLedgerAsk("scrap the gym block i just added")!, d))!;
    expect(calls[0]).toEqual(["orion-reschedule", ["drop", "--id", "id-Gym"]]);
    expect(out.text).toMatch(/Gym is off your day/); expect(out.removed.length).toBe(1);
  });
  it("says so when the block is still there", async () => {
    const { d } = deps({ items: [{ kind: "block", label: "Gym", at: NOW }], days: [day([["Gym", "17:00", "18:00", true]]), day([["Gym", "17:00", "18:00", true]])] });
    expect((await runLedgerAsk(readLedgerAsk("scrap the gym block i just added")!, d))!.text).toMatch(/still on your calendar/);
  });
  it("take the call with mum off my day removes a block ORION made even from an earlier chat", async () => {
    const { d, calls } = deps({ days: [day([["Call with mum", "17:00", "17:40", true]]), day([])] });
    const out = (await runLedgerAsk(readLedgerAsk("take the call with mum off my day")!, d))!;
    expect(calls[0]).toEqual(["orion-reschedule", ["drop", "--id", "id-Call with mum"]]); expect(out.text).toMatch(/Call with mum is off your day/);
  });
  it("his own event of the same name is not claimed by a weak ask", async () => {
    const { d, calls } = deps({ days: [day([["Call with mum", "17:00", "17:40"]])] });
    expect(await runLedgerAsk(readLedgerAsk("get rid of the mum call")!, d)).toBeUndefined(); expect(calls).toEqual([]);
  });
  it("delete that note i just made removes the note, not the schedule", async () => {
    const { d, calls } = deps({ items: [{ kind: "note", label: "went through the orion learning plan and it took longer", at: NOW - 5000 }],
      scripts: { "orion-brain forget": '{"query":"q","matches":[{"id":"abc1234567","text":"went through the orion learning plan and it took longer"}]}' } });
    const second = d.run; let n = 0;
    d.run = async (s, a) => { n += 1; if (n === 2) { calls.push([s, a]); return { stdout: '{"archived":[{"id":"abc1234567"}],"missing":[]}', code: 0 }; } return second(s, a); };
    const out = (await runLedgerAsk(readLedgerAsk("actually delete that note i just made")!, d))!;
    expect(out.text).toMatch(/^Removed the note/); expect(calls.every(([s]) => s === "orion-brain")).toBe(true);
  });
  it("take the big mac back off removes the logged food", async () => {
    const { d, calls } = deps({ items: [{ kind: "food", label: "Big Mac", at: NOW - 1000 }], scripts: { "orion-log food-off": "Took Big Mac off (770 kcal): 570 kcal today." } });
    const out = (await runLedgerAsk(readLedgerAsk("take the big mac back off, i didnt have it")!, d))!;
    expect(calls[0]).toEqual(["orion-log", ["food-off", "big", "mac"]]); expect(out.text).toMatch(/Took Big Mac off/);
  });
  it("a strong ask that matches nothing says nothing changed", async () => {
    const { d, calls } = deps();
    expect((await runLedgerAsk(readLedgerAsk("delete that note i just made")!, d))!.text).toMatch(/nothing changed/); expect(calls).toEqual([]);
  });
});

describe("review r3", () => {
  it.each(["undo that move", "undo the move", "undo my move", "undo that change", "undo what you just did", "undo the last thing you did", "undo the last thing", "revert the last change", "undo what i just did"])("%s is a bare undo", (m) => {
    const a = readLedgerAsk(m)!; expect(a.bare).toBe(true); expect(a.targets).toEqual([]);
  });
  it("undo the gym move undoes a named calendar change", () => {
    const a = readLedgerAsk("undo the gym move")!; expect(a).toMatchObject({ verb: "undo", kinds: ["block"], targets: [["gym"]], bare: false });
  });
  it("HIGH 1: removal targets the exact block by id, never his same-titled event", async () => {
    const { d, calls } = deps({ items: [{ kind: "block", label: "Study", at: NOW - 1000 }], days: [day([["Study", "17:00", "18:00"], ["Study group", "18:00", "19:00"], ["Study", "19:00", "20:00", "mine-1"]]), day([["Study", "17:00", "18:00"], ["Study group", "18:00", "19:00"]])] });
    const out = (await runLedgerAsk(readLedgerAsk("scrap the study block i just added")!, d))!;
    expect(calls.map(([, a]) => a)).toEqual([["drop", "--id", "mine-1"]]); expect(out.text).toMatch(/Study is off your day/);
  });
  it("two made blocks of that name: asks which, drops nothing", async () => {
    const { d, calls } = deps({ items: [{ kind: "block", label: "Study", at: NOW }], days: [day([["Study", "17:00", "18:00", "a"], ["Study", "19:00", "20:00", "b"]])] });
    const out = (await runLedgerAsk(readLedgerAsk("scrap the study block i just added")!, d))!;
    expect(out.text).toMatch(/Which Study/); expect(calls).toEqual([]);
  });
  it("a bare undo right after an add uses the journal undo, not a drop", async () => {
    const entry: JournalEntry[] = [{ at: new Date(NOW - 1000).toISOString(), steps: [{ op: "create", title: "Gym", start: iso(19), end: iso(20) }] }];
    const { d, calls } = deps({ items: [{ kind: "block", label: "Gym", at: NOW - 1000 }], journal: () => entry, calendar: { since: NOW - 5000, last: NOW - 1000 }, days: [day([])] });
    const out = (await runLedgerAsk(readLedgerAsk("undo")!, d))!;
    expect(calls).toEqual([["orion-reschedule", ["undo"]]]); expect(out.text).toBe("Gym is off your calendar.");
  });
  it("another writer's newer journal entry is not this chat's to undo", async () => {
    const journal: JournalEntry[] = [{ at: new Date(NOW - 600_000).toISOString(), steps: [{ op: "move", title: "Gym", start: iso(9), end: iso(10) }] }, { at: new Date(NOW - 60_000).toISOString(), steps: [{ op: "move", title: "Other", start: iso(9), end: iso(10) }] }];
    const { d, calls } = deps({ journal: () => journal, calendar: { since: NOW - 900_000, last: NOW - 600_000 }, owned: (at) => at === journal[0]!.at });
    expect((await runLedgerAsk(readLedgerAsk("undo")!, d))!.text).toBe("NOTHING"); expect(calls).toEqual([]);
  });
  it("a reminder he set earlier is asked about, never cancelled on words alone; yes cancels it", async () => {
    const h = deps({ reminders: [rem("a1", "stretch")] });
    const out = (await runLedgerAsk(readLedgerAsk("cancel the stretch one")!, h.d))!;
    expect(h.store.length).toBe(1); expect(out.text).toMatch(/Do you mean the "stretch" reminder/); expect(out.held).toEqual({ kind: "reminder", label: "stretch" });
    const yes = (await runLedgerAsk({ ...readLedgerAsk("cancel the stretch one")!, confirmed: true }, h.d))!;
    expect(h.store).toEqual([]); expect(yes.text).toMatch(/Cancelled the reminder: stretch/);
  });
  it("a note found only by words is asked about with its text", async () => {
    const { d, calls } = deps({ scripts: { "orion-brain forget": '{"query":"q","matches":[{"id":"abc1234567","text":"idempotency matters for the lecture"}]}' } });
    const out = (await runLedgerAsk(readLedgerAsk("delete the note about idempotency")!, d))!;
    expect(out.text).toMatch(/Do you mean this note: "idempotency matters for the lecture"/); expect(out.held?.kind).toBe("note");
    expect(calls.every(([, a]) => a[0] === "forget" && a[1] !== "--apply")).toBe(true);
  });
});

describe("round 5 (gate run 3)", () => {
  it.each(["revert whatever you just did", "reverse what you just did", "roll back the last change", "take back that move", "revert that", "roll back that last thing you did"])("%s is a bare undo", (m) => {
    expect(readLedgerAsk(m)).toMatchObject({ verb: "undo", bare: true });
  });
  it.each(["revert that and the one before it as well", "undo that and the one before", "roll back that and the one before it too", "undo the last two changes", "undo both"])("%s takes back two", (m) => {
    expect(readLedgerAsk(m)).toMatchObject({ bare: true, count: 2 });
  });
  it("undoes two of this chat's changes, newest first, and says what each one shows", async () => {
    const journal: JournalEntry[] = [{ at: new Date(NOW - 120_000).toISOString(), steps: [{ op: "move", title: "Gym", start: iso(9), end: iso(10) }] }, { at: new Date(NOW - 60_000).toISOString(), steps: [{ op: "move", title: "Study", start: iso(11), end: iso(12) }] }];
    let popped = 0;
    const { d, calls } = deps({ calendar: { since: NOW - 900_000, last: NOW - 60_000 }, days: [day([["Study", "11:00", "12:00"]]), day([["Gym", "09:00", "10:00"]])],
      journal: () => journal.slice(0, journal.length - popped), run: async (s, a) => { calls.push([s, a]); popped += 1; return { stdout: "Undone: x", code: 0 }; } });
    const out = (await runLedgerAsk(readLedgerAsk("revert that and the one before it as well")!, d))!;
    expect(calls.map((c) => c[1])).toEqual([["undo"], ["undo"]]); expect(out.text).toBe("Study is back at 11:00 AM–12:00 PM. Gym is back at 9:00 AM–10:00 AM.");
  });
  it("only one of its own changes: undoes it and says there was no earlier one", async () => {
    const journal: JournalEntry[] = [{ at: new Date(NOW - 60_000).toISOString(), steps: [{ op: "move", title: "Study", start: iso(11), end: iso(12) }] }];
    let popped = 0;
    const { d } = deps({ calendar: { since: NOW - 900_000, last: NOW - 60_000 }, days: [day([["Study", "11:00", "12:00"]])], journal: () => (popped ? [] : journal), run: async () => { popped += 1; return { stdout: "Undone: x", code: 0 }; } });
    expect((await runLedgerAsk(readLedgerAsk("undo that and the one before")!, d))!.text).toMatch(/Study is back at 11:00 AM–12:00 PM\. There wasn't an earlier change/);
  });
  it.each(["scrap the water one", "remove drink water from my calendar", "ditch that drink water block", "get rid of the water block"])("%s removes the block called Drink water", async (m) => {
    const { d, calls } = deps({ items: [{ kind: "block", label: "Drink water", at: NOW - 1000 }], days: [day([["Drink water", "05:25", "06:25", "dw1"]]), day([])] });
    const out = (await runLedgerAsk(readLedgerAsk(m)!, d))!;
    expect(calls[0]![1]).toEqual(["drop", "--id", "dw1"]); expect(out.text).toMatch(/Drink water is off your day/);
  });
  it("the water block is found on the day even when this chat did not make it", async () => {
    const { d, calls } = deps({ days: [day([["Drink water", "05:25", "06:25", "dw1"]]), day([])] });
    expect((await runLedgerAsk(readLedgerAsk("scrap the water one")!, d))!.text).toMatch(/off your day/); expect(calls[0]![1]).toEqual(["drop", "--id", "dw1"]);
  });
  it.each(["and the dentist one too", "also the dentist one", "and the dentist as well", "oh and the dentist one too"])("%s reads as a follow-up target", (m) => {
    expect(readFollowUp(m)).toEqual([["dentist"]]);
  });
  it.each(["and then what", "and", "whats next too", "and the gym tomorrow"])("%s is not a follow-up", (m) => { expect(readFollowUp(m)).toBeNull(); });
  it.each(["get rid of every call with dad", "delete all the calls with dad", "remove all my dad calls", "cancel every dad call", "scrap all calls with dad"])("%s removes every made block, listing them, never his own", async (m) => {
    const todayAll = day([["Call with dad", "17:00", "17:40", "c1"], ["Call with dad", "20:00", "20:30"]]); const tomorrowAll = day([["Catch up call with dad", "10:00", "10:30", "c2"]]);
    const { d, calls } = deps();
    d.readDay = async (a) => { const dropped = calls.flatMap((c) => c[1]); const base = a.includes("tomorrow") ? tomorrowAll : todayAll; return { ...base, blocks: base.blocks.filter((bl) => !(bl.id && dropped.includes(bl.id))) }; };
    const out = (await runLedgerAsk(readLedgerAsk(m)!, d))!;
    expect(calls.map((c) => c[1])).toEqual([["drop", "--id", "c1"], ["drop", "--id", "c2", "--date", "tomorrow"]]);
    expect(out.text).toMatch(/Call with dad \(5:00 PM–5:40 PM\)[^]*Catch up call with dad \(10:00 AM–10:30 AM, tomorrow\)/);
  });
  it("every call with dad, none made by ORION: nothing changes and it says so", async () => {
    const { d, calls } = deps({ days: [day([["Call with dad", "20:00", "20:30"]])] });
    expect((await runLedgerAsk(readLedgerAsk("get rid of every call with dad")!, d))!.text).toMatch(/I don't remove your own events/); expect(calls).toEqual([]);
  });
  it.each(["cancel the pasta timer", "stop the pasta timer", "kill the pasta timer", "scrap my pasta timer", "dont need the pasta timer"])("%s cancels the stored timer by label", async (m) => {
    const h = deps({ reminders: [rem("t1", "pasta"), rem("t2", "stretch")] });
    const out = (await runLedgerAsk({ ...readLedgerAsk(m)!, confirmed: true }, h.d))!;
    expect(h.store.map((r) => r.id)).toEqual(["t2"]); expect(out.text).toMatch(/Cancelled the reminder: pasta/);
  });
  it("cancel the pasta timer with a plain order cancels it outright when one timer matches", async () => {
    const h = deps({ reminders: [rem("t1", "pasta")] });
    expect((await runLedgerAsk(readLedgerAsk("cancel the pasta timer")!, h.d))!.text).toMatch(/Cancelled the reminder: pasta/); expect(h.store).toEqual([]);
  });
  it("a timer set in this chat is in the ledger", () => {
    expect(madeBy({ canonical: "timer_set 600s pasta", stdout: '{"id":"x1","dueAt":5}' }, 1)[0]).toMatchObject({ kind: "reminder", label: "pasta" });
  });
});
