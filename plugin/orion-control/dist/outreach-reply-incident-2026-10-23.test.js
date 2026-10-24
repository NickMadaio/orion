// 2026-10-23: replies to ORION's own proactive messages, as the Mac app and the phone sent them (gateway transcripts
// 97949e09, 5aa4563a, e2c10733; docs/audits/2026-10-23-proactive-reply-and-bedtime.md). Fixtures only: no real paths.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { parseOutreach, planOutreachReply, readShortReply, outreachNote, loopArgs } from "./outreach-reply.js";
const APP = `[Orion app context — factual state supplied by the native app]
Focus session: inactive.
Firm enforcement: not active.
Temporary allowed work apps: none established.
Treat the session status and allowed apps as current operating context. Do not claim an app is blocked, hidden, or quit unless a tool confirms it.

User message:
`;
// 10-20 19:45:32Z, word for word (the Mac's label for a mismatch rung).
const GYM = '[ORION context: 0 min ago you asked "It\'s been 30 min. Gym, now. Phone down." (Gym, planned 20:15-21:45, not started). If he says what he did or is doing, log it.]';
// 10-19 23:03:13Z, word for word (a bedtime line).
const BED = '[ORION context: you messaged him first, 0 min ago: "It\'s 12:02 AM, bedtime. Sleep now and you get 8h 58m before your alarm.". This message MAY be his answer.]';
// The new label orion-reach rows carry from the shared rule.
const BED_NEW = '[ORION context: you messaged him first, 2 min ago (bedtime): "Still up at 12:43 AM — 8h 17m left before your alarm.". His message below is most likely his reply to it.]';
// The phone's context line (orion-remote, 2026-10-23 form) and the 10-16 form.
const PHONE = '[orion-remote] Live facts for this message (read just now, not from Nick):\n- Today\'s calendar: nothing planned.\n- 1 min ago you messaged him first (start): "Time to start: Gym." — his message is most likely his reply to it.\n--- Nick\'s message follows ---\n';
const PHONE_OLD = '- You messaged him first (most recent last): 2:44 AM "Session done. It\'s 2:44 AM — past bedtime; sleep now and you get 6h 16m." — this message may be his answer.';
describe("what ORION said first, read from either prefix", () => {
    it("the Mac's mismatch label: a start line about Gym", () => {
        expect(parseOutreach(`${GYM}\n${APP}I'm meal prepping. That's why. Sorry.`)).toEqual({ text: "It's been 30 min. Gym, now. Phone down.", minutes: 0, kind: "start", title: "Gym" });
    });
    it("the Mac's plain label and the new label: bedtime", () => {
        expect(parseOutreach(`${BED}\n${APP}im doing work shush up`)?.kind).toBe("bedtime");
        expect(parseOutreach(BED_NEW)).toMatchObject({ kind: "bedtime", minutes: 2 });
    });
    it("the phone's lines, new and old", () => {
        expect(parseOutreach(`${PHONE}not yet`)).toEqual({ text: "Time to start: Gym.", minutes: 1, kind: "start", title: "Gym" });
        expect(parseOutreach(PHONE_OLD)?.kind).toBe("bedtime");
    });
    it("no prefix, no outreach", () => expect(parseOutreach(`${APP}whats the weather`)).toBeUndefined());
});
describe("short answers", () => {
    it.each([
        ["yeah", "yes"], ["ok", "yes"], ["on it", "yes"], ["not yet", "not-yet"], ["in 10", "later"], ["10 more min", "later"], ["give me 20 minutes", "later"],
        ["already did", "done"], ["already in bed", "done"], ["done", "done"], ["shush", "stop"], ["im doing work shush up", "stop"],
        ["I'm meal prepping. That's why. Sorry.", "other"], ["nah", "no"],
    ])("%s → %s", (said, kind) => expect(readShortReply(said)?.kind).toBe(kind));
    it("'in 10' is ten minutes", () => expect(readShortReply("in 10")).toEqual({ kind: "later", minutes: 10 }));
    it("a question or a long message is not a short answer", () => {
        expect(readShortReply("what time is gym?")).toBeUndefined();
        expect(readShortReply("can you move gym to tomorrow morning and put the resume block after my lecture please, thanks orion")).toBeUndefined();
    });
});
describe("code's answer to a reply to a start line: the loop it belongs to, by id", () => {
    const gym = parseOutreach(GYM);
    it("10-20 'I'm meal prepping. That's why. Sorry.': defer the Gym loop 25 min, no calendar change, no 'what time'", () => {
        expect(planOutreachReply(gym, "I'm meal prepping. That's why. Sorry.")).toEqual({ text: "Okay, meal prepping first. I'll check back about Gym in 25 min.",
            act: { verb: "defer", minutes: 25, because: "I'm meal prepping. That's why. Sorry." }, find: { what: "Gym" } });
    });
    it("'in 10' / 'not yet' / 'already did' / 'yeah' act on the loop's id (yeah updates it, never opens a new one)", () => {
        expect(loopArgs(planOutreachReply(gym, "in 10").act, "ci-7")).toEqual(["defer", "10", "ci-7", "--because", "in 10"]);
        expect(loopArgs(planOutreachReply(gym, "not yet").act, "ci-7").slice(0, 3)).toEqual(["defer", "15", "ci-7"]);
        expect(loopArgs(planOutreachReply(gym, "already did").act, "ci-7")).toEqual(["done", "ci-7"]);
        expect(loopArgs(planOutreachReply(gym, "yeah").act, "ci-7")).toEqual(["started", "ci-7"]);
    });
    it("'nah' / 'stop' / 'shush' to a start line: nothing destructive in code (no cancel, no calendar change)", () => {
        for (const said of ["nah", "stop", "shush"])
            expect(planOutreachReply(gym, said), said).toBeUndefined();
    });
    it("a real question goes to the worker with the context", () => {
        expect(planOutreachReply(gym, "can i do gym tomorrow instead?")).toBeUndefined();
        expect(outreachNote(gym)).toMatch(/YOU \(ORION\) messaged him first: "It's been 30 min\. Gym, now\. Phone down\."/);
    });
});
describe("code's answer to a reply to a bedtime line: never 'since when', never another reminder", () => {
    const bed = parseOutreach(BED);
    it("10-19 'im doing work shush up'", () => expect(planOutreachReply(bed, "im doing work shush up")?.text).toMatch(/No more bedtime reminders tonight/));
    it("'yeah' / 'going to bed' / 'in 10' / 'already in bed'", () => {
        expect(planOutreachReply(bed, "yeah")?.text).toBe("Night, Nick.");
        expect(planOutreachReply(bed, "in 10")?.text).toMatch(/10 more minutes, then sleep/);
        expect(planOutreachReply(bed, "already in bed")?.text).toBe("Good. Night, Nick.");
    });
    it("10-16 'Yea yea yea I know, just wrapping up my work now. Then sleep. Push my alarm to 12' is a request too: the worker gets it, with the context", () => {
        expect(planOutreachReply(parseOutreach(PHONE_OLD), "Yea yea yea I know, just wrapping up my work now. Then sleep. Push my alarm to 12")).toBeUndefined();
    });
});
function harness({ found = true, deskMove = {} } = {}) {
    const handlers = new Map();
    const desk = [];
    const checkins = [];
    const flows = [];
    registerLocalRouting({ on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) }, {
        warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "lr-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Tue 20:45", now: () => new Date(2026, 9, 20, 20, 45),
        decideImpl: async (input) => { desk.push({ message: input.message, history: input.history }); return deskMove[input.message] ?? { move: "escalate", tier: "standard" }; },
        scheduleFlow: async (message) => { flows.push(message); return { outcome: "say", kind: "ask", text: "What time or how long do you mean? I haven't changed anything." }; },
        checkinRun: async (args) => {
            checkins.push(args);
            if (args[0] === "find")
                return found ? { stdout: '{"open":true,"id":"ci-gym","what":"Gym","block":"cal-4-897c"}', code: 0 } : { stdout: '{"open":false,"matches":0}', code: 1 };
            return { stdout: args[0] === "defer" ? "Fair — back in 25 min about Gym." : "ok", code: 0 };
        }
    });
    const fire = async (name, event, ctx) => {
        const out = [];
        for (const fn of handlers.get(name) ?? [])
            out.push(await fn(event, ctx));
        return out;
    };
    let n = 0;
    const turn = async (prompt) => {
        const ctx = { runId: `o${n += 1}`, sessionKey: "agent:main:orion-chat-9311fb49" };
        await fire("before_model_resolve", { prompt }, ctx);
        await fire("before_agent_reply", { prompt }, ctx);
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        return { all: `${built?.prependContext ?? ""}\n${built?.systemPrompt ?? ""}\n${built?.appendContext ?? ""}` };
    };
    return { turn, desk, checkins, flows };
}
describe("the turns, through the routing hooks", () => {
    it("10-20: the front desk sees ORION's Gym line as its last turn; code sets the check-in and answers; the schedule flow never runs", async () => {
        const h = harness();
        const t = await h.turn(`${GYM}\n${APP}I'm meal prepping. That's why. Sorry.`);
        expect(h.desk[0]).toEqual({ message: "I'm meal prepping. That's why. Sorry.", history: [{ role: "assistant", content: "It's been 30 min. Gym, now. Phone down." }] });
        expect(h.checkins).toEqual([["find", "--what", "Gym"], ["defer", "25", "ci-gym", "--because", "I'm meal prepping. That's why. Sorry."]]);
        expect(h.flows).toEqual([]);
        expect(t.all).toMatch(/meal prepping first\. I'll check back about Gym in 25 min/);
        expect(t.all).not.toMatch(/What time or how long/);
    });
    it("10-19: 'im doing work shush up' after the bedtime line is answered as a reply to it", async () => {
        const h = harness();
        const t = await h.turn(`${BED}\n${APP}im doing work shush up`);
        expect(t.all).toMatch(/No more bedtime reminders tonight/);
        expect(t.all).not.toMatch(/Since when/);
        expect(h.flows).toEqual([]);
    });
    it("a longer reply reaches the worker with ORION's message as the conversation so far", async () => {
        const h = harness();
        const t = await h.turn(`${BED}\n${APP}honestly i think i need to finish this essay, how much sleep do i get if i stop at 1`);
        expect(t.all).toMatch(/YOU \(ORION\) messaged him first: "It's 12:02 AM, bedtime/);
    });
});
// Review 2026-10-23 (CRITICAL 1, HIGH 2): code answers only a WHOLE short reply; a request that also contains one goes to the turn.
describe("requests after a proactive line are never taken by the short-answer path", () => {
    it.each(["set an alarm for 8 am", "remind me in 10 min to call mom", "i am working for an hour", "whats my first class tomorrow", "play some music",
        "log 2 hours of essay work", "remind me when the laundry is done", "already did the reading, add gym tomorrow at 7", "not yet, but can you move gym to 8",
        "stop the focus session"])("'%s' is not a short answer", (said) => {
        expect(readShortReply(said)).toBeUndefined();
        expect(planOutreachReply(parseOutreach(BED), said)).toBeUndefined();
        expect(planOutreachReply(parseOutreach(GYM), said)).toBeUndefined();
    });
    it("'8 am' is never minutes", () => expect(readShortReply("8 am")).toBeUndefined());
    it.each([
        [BED, "set an alarm for 8 am"], [BED, "whats my first class tomorrow"], [BED, "play some music"], [BED, "log 2 hours of essay work"],
        [GYM, "remind me in 10 min to call mom"], [GYM, "i am working for an hour"], [GYM, "already did the reading, add gym tomorrow at 7"],
        [GYM, "not yet, but can you move gym to 8"], [GYM, "stop the focus session"], [BED, "remind me when the laundry is done"],
    ])("through the hooks: %#: no code reply, no check-in call, the turn keeps the context", async (label, said) => {
        const h = harness();
        const t = await h.turn(`${label}\n${APP}${said}`);
        expect(h.checkins).toEqual([]);
        expect(t.all).not.toMatch(/No more bedtime reminders|more minutes, then sleep|I'll check (?:in|back)/);
    });
    it("a desk tool pick ('play some music' as media) is never answered by the short-answer path, even for 'yeah'", async () => {
        const h = harness({ deskMove: { yeah: { move: "tool", tool: "media", args: {} } } });
        const t = await h.turn(`${BED}\n${APP}yeah`);
        expect(t.all).not.toMatch(/Night, Nick/);
    });
    it("'already did the reading, add gym tomorrow at 7': the add still reaches the schedule flow", async () => {
        const h = harness();
        await h.turn(`${GYM}\n${APP}already did the reading, add gym tomorrow at 7`);
        expect(h.flows).toEqual(["already did the reading, add gym tomorrow at 7"]);
    });
    it("no loop for the start line (or several): code does nothing, never the newest check-in", async () => {
        const h = harness({ found: false });
        const t = await h.turn(`${GYM}\n${APP}in 10`);
        expect(h.checkins).toEqual([["find", "--what", "Gym"]]);
        expect(t.all).not.toMatch(/I'll check in then/);
    });
});
