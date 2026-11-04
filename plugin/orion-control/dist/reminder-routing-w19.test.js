// The new reminder turns through the real routing hooks, not just the planner (w19-reminders): a typo'd request, a repeat, a snooze, a "done",
// an offered reminder. The worker is told the exact call and the exact sentence to say; the model never works out a time.
process.env.TZ = "Europe/London";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { fileOfferPort } from "./reminder-offers.js";
const NOW = new Date(2026, 10, 4, 12, 0); // Wednesday noon
function harness(opts = {}) {
    const handlers = new Map();
    const api = { on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) };
    const fire = async (name, event, ctx) => { const out = []; for (const fn of handlers.get(name) ?? [])
        out.push(await fn(event, ctx)); return out; };
    const dir = mkdtempSync(join(tmpdir(), "rr-"));
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), brainSearch: async () => "", clock: () => "Wed 12:00", now: () => NOW,
        decideImpl: async () => opts.decision ?? { move: "escalate", tier: "quick" },
        extractReminder: async (m) => (opts.extract ? opts.extract(m) : null), listReminders: async () => opts.stored ?? [],
        ...(opts.offerDir ? { offerPort: fileOfferPort(opts.offerDir, () => NOW) } : {}) });
    let n = 0;
    return async (said) => {
        const ctx = { runId: `w19-${(n += 1)}`, sessionKey: "agent:main:orion-chat-w19" };
        await fire("before_model_resolve", { prompt: said }, ctx);
        const [built] = (await fire("before_prompt_build", { prompt: said, messages: [] }, ctx));
        return `${built?.systemPrompt ?? ""}\n${built?.appendContext ?? ""}`;
    };
}
describe("through the hooks", () => {
    it("a request full of typos still sets the reminder, with the sentence to say", async () => {
        const turn = harness({ extract: () => ({ time: "17:00", label: "call mom" }) });
        const prompt = await turn("remnd me to call mom at 5pm");
        expect(prompt).toMatch(/"action":"alarm_set","at":"2026-11-04T17:00","label":"call mom"/);
        expect(prompt).toMatch(/I'll remind you at 5:00 PM to call mom\./);
    });
    it("every monday is a repeat, said as one", async () => {
        const turn = harness({ extract: () => ({ time: "09:00", label: "send the timesheet" }) });
        const prompt = await turn("every monday at 9 remind me to send the timesheet");
        expect(prompt).toMatch(/"repeat":\{"days":\[1\],"time":"09:00"\}/);
        expect(prompt).toMatch(/I'll remind you every Monday at 9:00 AM to send the timesheet\./);
    });
    it("when i get home is a place reminder", async () => {
        const turn = harness({ extract: () => ({ time: null, label: "text mom" }) });
        expect(await turn("remind me to text mom when i get home")).toMatch(/"place":"home"/);
    });
    it("'snooze 15' after one went off is a reminder_snooze on that one, not a new alarm", async () => {
        const turn = harness({ stored: [{ id: "a9k2z", label: "call mom", dueAt: NOW.getTime() - 120_000, firedAt: NOW.getTime() - 120_000 }] });
        const prompt = await turn("snooze 15");
        expect(prompt).toMatch(/"action":"reminder_snooze","id":"a9k2z","minutes":15/);
        expect(prompt).toMatch(/Snoozed\. I'll remind you again at 12:15 PM: call mom\./);
        expect(prompt).not.toMatch(/alarm_set/);
    });
    it("'did it' after one went off is reminder_done", async () => {
        const turn = harness({ stored: [{ id: "a9k2z", label: "call mom", dueAt: NOW.getTime() - 120_000, firedAt: NOW.getTime() - 120_000 }] });
        expect(await turn("did it")).toMatch(/"action":"reminder_done","id":"a9k2z"/);
    });
    it("something he has to do is offered a reminder, once, and his yes sets it", async () => {
        const offerDir = mkdtempSync(join(tmpdir(), "offers-"));
        const turn = harness({ offerDir, extract: () => null });
        const first = await turn("i need to email prof hale tomorrow");
        expect(first).toMatch(/Want a reminder tomorrow at 10 AM to email prof hale\?/);
        const yes = await turn("yeah sure");
        expect(yes).toMatch(/"action":"alarm_set","at":"2026-11-05T10:00","label":"email prof hale"/);
        expect(yes).toMatch(/I'll remind you tomorrow at 10:00 AM to email prof hale\./);
        const again = await turn("i need to email prof hale tomorrow");
        expect(again).not.toMatch(/Want a reminder/);
    });
});
