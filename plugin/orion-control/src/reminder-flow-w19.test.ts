// Reminders he can actually talk to (w19-reminders): typos, relative and absolute times in 12-hour wording, repeats, "when I get home",
// important, snooze and done, an offered reminder. Held-out phrasings, his style.
process.env.TZ = "Europe/London";
import { describe, expect, it } from "vitest";
import { planReminder, type Extracted, type OfferPort, type PendingOffer, type StoredReminder } from "./reminder-flow.js";

const NOW = new Date(2026, 10, 4, 12, 0);   // Wednesday 12:00
const ms = (h: number, m = 0, d = 4) => new Date(2026, 10, d, h, m).getTime();
const plan = (message: string, extract: Extracted, stored: StoredReminder[] = [], more: Record<string, unknown> = {}) =>
  planReminder({ message, now: NOW, extract: async () => extract, list: async () => stored, ...more });
const args = (p: Awaited<ReturnType<typeof plan>>) => JSON.parse((p as { args: string }).args).steps as Array<Record<string, unknown>>;

describe("setting one: the reply says exactly when and what", () => {
  it("an absolute time", async () => {
    const p = await plan("remind me to call mom at 5", { time: "05:00", label: "call mom" });
    expect(p).toMatchObject({ kind: "call", action: "alarm_set", reply: "I'll remind you at 5:00 PM to call mom." });
    expect(args(p)[0]).toMatchObject({ action: "alarm_set", at: "2026-11-04T17:00", label: "call mom" });
  });

  it("a relative time, with the clock time it lands on", async () => {
    const p = await plan("remind me in 20 min to flip the laundry", { time: null, label: "flip the laundry" });
    expect(p).toMatchObject({ reply: "I'll remind you in 20 minutes, at 12:20 PM, to flip the laundry." });
    expect(args(p)[0]).toMatchObject({ at: "2026-11-04T12:20" });
  });

  it("through typos: remnd, tmrw", async () => {
    const p = await plan("rmind me tmrw at 9 to email prof hale", { time: "09:00", label: "email prof hale" });
    expect(p).toMatchObject({ kind: "call", reply: "I'll remind you tomorrow at 9:00 AM to email prof hale." });
    expect(args(p)[0]).toMatchObject({ at: "2026-11-05T09:00" });
  });

  it("'tomorrow morning' with no clock time is 9 AM, said out loud so he can correct it", async () => {
    const p = await plan("remind me tomorrow morning to ring the bank", { time: null, label: "ring the bank" });
    expect(p).toMatchObject({ reply: "I'll remind you tomorrow at 9:00 AM to ring the bank." });
  });

  it("'tonight' and 'this evening' are 8 PM and 6 PM", async () => {
    expect(await plan("remind me tonight to take the bins out", { time: null, label: "take the bins out" })).toMatchObject({ reply: "I'll remind you at 8:00 PM to take the bins out." });
    expect(await plan("remind me this evening to text sam", { time: null, label: "text sam" })).toMatchObject({ reply: "I'll remind you at 6:00 PM to text sam." });
  });

  it("a part of the day that has already gone is said, not set", async () => {
    const late = new Date(2026, 10, 4, 15, 0);
    const p = await planReminder({ message: "remind me this morning to call him", now: late, extract: async () => ({ time: null, label: "call him" }), list: async () => [] });
    expect(p).toMatchObject({ kind: "say", text: expect.stringMatching(/already past 9:00 AM/) });
  });

  it("'530pm' and 'at 5 pm' read as 12-hour times", async () => {
    expect(await plan("remind me at 530pm to eat", { time: "05:30", label: "eat" })).toMatchObject({ reply: "I'll remind you at 5:30 PM to eat." });
    expect(await plan("remind me at 5 pm to eat", { time: "17:00", label: "eat" })).toMatchObject({ reply: "I'll remind you at 5:00 PM to eat." });
  });

  it("a label like 'my meds' reads as 'about', not 'to my meds'", async () => {
    expect(await plan("remind me at 8pm about my meds", { time: "20:00", label: "my meds" })).toMatchObject({ reply: "I'll remind you at 8:00 PM about my meds." });
  });

  it("important is stored and said", async () => {
    const p = await plan("remind me at 3 to send the form its important", { time: "03:00", label: "send the form" });
    expect(args(p)[0]).toMatchObject({ important: true });
    expect((p as { reply: string }).reply).toBe("I'll remind you at 3:00 PM to send the form. It's marked important, so it gets through even during focus.");
  });
});

describe("repeating", () => {
  it("every monday at a time", async () => {
    const p = await plan("every monday remind me to take the bins out at 7pm", { time: "19:00", label: "take the bins out" });
    expect(p).toMatchObject({ kind: "call", reply: "I'll remind you every Monday at 7:00 PM to take the bins out." });
    expect(args(p)[0]).toMatchObject({ at: "2026-11-09T19:00", repeat: { days: [1], time: "19:00" } });
  });

  it("weekdays at 8: the next one is tomorrow morning", async () => {
    const p = await plan("remind me every weekday at 8 to take my pills", { time: "08:00", label: "take my pills" });
    expect(p).toMatchObject({ reply: "I'll remind you every weekday at 8:00 AM to take my pills." });
    expect(args(p)[0]).toMatchObject({ at: "2026-11-05T08:00", repeat: { days: [1, 2, 3, 4, 5], time: "08:00" } });
  });

  it("'every morning' with no time is 9, 'every day' with no time asks", async () => {
    expect(await plan("every morning remind me to drink water", { time: null, label: "drink water" })).toMatchObject({ reply: "I'll remind you every day at 9:00 AM to drink water." });
    expect(await plan("remind me every day to stretch", { time: null, label: "stretch" })).toMatchObject({ kind: "say", pending: true, text: "What time each day?" });
  });

  it("a repeat it cannot do is said plainly", async () => {
    const p = await plan("remind me every other day to stretch", { time: "09:00", label: "stretch" });
    expect(p).toMatchObject({ kind: "say", text: expect.stringMatching(/daily, on weekdays or weekends, or on named days/) });
  });
});

describe("when I get home", () => {
  it("is a place reminder with a day-long expiry", async () => {
    const p = await plan("remind me to text mom when i get home", { time: null, label: "text mom" });
    expect(p).toMatchObject({ kind: "call", reply: "I'll remind you when you get home to text mom." });
    expect(args(p)[0]).toMatchObject({ place: "home", at: "2026-11-05T12:00", label: "text mom" });
  });
});

describe("snooze and done, from chat", () => {
  const fired: StoredReminder[] = [{ id: "a1", label: "call mom", dueAt: ms(11, 58), firedAt: ms(11, 58) }];
  const asked = (m: string, stored = fired) => plan(m, null, stored);

  it.each([["snooze 10 min", 10], ["snooze it for an hour", 60], ["remind me again in 20 min", 20], ["snooze", 10], ["in 15 min", 15], ["later", 10], ["ping me again in like 5", 5], ["snoooze 30 mins", 30]])("%s", async (message, minutes) => {
    const p = await asked(message as string);
    expect(p).toMatchObject({ kind: "call", action: "reminder_snooze" });
    expect(args(p)[0]).toEqual({ action: "reminder_snooze", id: "a1", minutes });
    const due = new Date(NOW.getTime() + (minutes as number) * 60000);
    const said = `${(due.getHours() + 11) % 12 + 1}:${String(due.getMinutes()).padStart(2, "0")} ${due.getHours() < 12 ? "AM" : "PM"}`;
    expect((p as { reply: string }).reply).toBe(`Snoozed. I'll remind you again at ${said}: call mom.`);
  });

  it.each(["done", "did it", "got it", "ok done", "finished"])("%s", async (message) => {
    const p = await asked(message);
    expect(p).toMatchObject({ kind: "call", action: "reminder_done", reply: "Done, marked off: call mom." });
    expect(args(p)[0]).toEqual({ action: "reminder_done", id: "a1" });
  });

  it("a recurring one comes back", async () => {
    const p = await asked("done", [{ id: "r1", label: "take pills", dueAt: ms(8, 0, 5), firedAt: ms(11, 58), repeat: { days: [1, 2, 3, 4, 5], time: "08:00" } }]);
    expect((p as { reply: string }).reply).toBe("Done for today. It comes back every weekday at 8:00 AM.");
  });

  it("an explicit snooze with nothing to snooze says so; a bare 'done' or 'later' with nothing fired is not ours", async () => {
    expect(await asked("snooze", [])).toMatchObject({ kind: "say", text: "There's nothing to snooze right now." });
    expect(await asked("done", [])).toBeUndefined();
    expect(await asked("later", [])).toBeUndefined();
    expect(await asked("in 15 min", [])).toBeUndefined();
  });

  it("a bare 'done' an hour after it fired is about something else (to-dos)", async () => {
    expect(await asked("done", [{ id: "a1", label: "call mom", dueAt: ms(10, 50), firedAt: ms(10, 50) }])).toBeUndefined();
    expect(await asked("snooze", [{ id: "a1", label: "call mom", dueAt: ms(10, 50), firedAt: ms(10, 50) }])).toMatchObject({ kind: "call", action: "reminder_snooze" });
  });
});

describe("listing and cancelling", () => {
  const stored: StoredReminder[] = [
    { id: "a1", label: "call mom", dueAt: ms(17) },
    { id: "r1", label: "take pills", dueAt: ms(8, 0, 5), repeat: { days: [1, 2, 3, 4, 5], time: "08:00" } },
    { id: "p1", label: "text mom", dueAt: ms(12, 0, 5), place: "home" },
    { id: "f1", label: "already rang", dueAt: ms(11, 0), firedAt: ms(11, 0) },
  ];
  it("says recurring and place ones the way he set them, and leaves out the fired", async () => {
    expect(await plan("whats my reminders", null, stored)).toMatchObject({ text: "You have 3 reminders: call mom at 5:00 PM, take pills every weekday at 8:00 AM and text mom when you get home." });
  });
  it("cancels a place reminder by what it is for", async () => {
    const p = await plan("cancel the home reminder", null, stored);
    expect(p).toMatchObject({ kind: "say" });
    const q = await plan("cancel the pills reminder", null, stored);
    expect(args(q)[0]).toEqual({ action: "reminder_cancel", id: "r1" });
  });
});

describe("offering one", () => {
  const port = (pending: PendingOffer | null = null, seen: string[] = [], today = 0) => {
    const recorded: PendingOffer[] = []; const cleared: string[] = [];
    const offers: OfferPort = { pending: async () => pending, clear: async (k) => { cleared.push(k); }, record: async (o) => { if (seen.includes(o.label) || today + recorded.length >= 3) return false; recorded.push(o); return true; } };
    return { offers, recorded, cleared };
  };

  it("something he says he has to do, with a day, is offered a reminder", async () => {
    const { offers, recorded } = port();
    const p = await plan("i need to email prof hale tomorrow", null, [], { offers });
    expect(p).toMatchObject({ kind: "say", text: "Want a reminder tomorrow at 10 AM to email prof hale?" });
    expect(recorded[0]).toMatchObject({ label: "email prof hale", at: "2026-11-05T10:00", source: "chat" });
  });

  it("never twice, never past the daily few, never for a question or a thing with no day", async () => {
    expect(await plan("i need to email prof hale tomorrow", null, [], { offers: port(null, ["email prof hale"]).offers })).toBeUndefined();
    expect(await plan("i need to email prof hale tomorrow", null, [], { offers: port(null, [], 3).offers })).toBeUndefined();
    expect(await plan("do i need to email prof hale tomorrow?", null, [], { offers: port().offers })).toBeUndefined();
    expect(await plan("i need to email prof hale", null, [], { offers: port().offers })).toBeUndefined();
    expect(await plan("i need to sleep tomorrow", null, [], { offers: port().offers })).toBeUndefined();
    expect(await plan("remind me tomorrow at 9 to email prof hale", { time: "09:00", label: "email prof hale" }, [], { offers: port().offers })).toMatchObject({ kind: "call" });
  });

  it("his yes sets the offered reminder, once", async () => {
    const offer: PendingOffer = { key: "k1", label: "Finish resume", at: "2026-11-05T09:00", offeredAt: NOW.getTime() - 120000, source: "deadline" };
    const { offers, cleared } = port(offer);
    const p = await plan("yes please", null, [], { offers });
    expect(p).toMatchObject({ kind: "call", action: "alarm_set", reply: "I'll remind you tomorrow at 9:00 AM to Finish resume." });
    expect(args(p)[0]).toMatchObject({ at: "2026-11-05T09:00", label: "Finish resume" });
    expect(cleared).toEqual(["k1"]);
  });

  it("a yes with no offer waiting is not a reminder turn", async () => {
    expect(await plan("yes please", null, [], { offers: port().offers })).toBeUndefined();
  });
});
