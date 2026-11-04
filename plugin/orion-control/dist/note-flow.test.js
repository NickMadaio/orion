import { describe, expect, it } from "vitest";
import { countSentences, isBareNoteRequest, isOtherCommand, looksSecret, parseNote, runNote } from "./note-flow.js";
// w18 note: "make a note of something long" kept only the first sentence. The model was told to save "the fact, short,
// in the third person" and orion-brain cut it at 400 characters. Code now keeps his whole text, minus the command words.
const LONG_VOICE = "ok make a note so for the marketing group project we need to meet on thursday and priya is doing the slides but she hasnt started and i said id do the survey thing and also i need to email prof jones about the extension because the deadline moved and i forgot";
const MULTI = "note that the dentist moved my appointment. also the gym card runs out in december!! need to renew it before then. dont forget mum's birthday";
const DR = "note: call dr. smith about the lab report. he said hed be in till 5 p.m. on friday, so go before then";
describe("parseNote", () => {
    it("keeps every word of a voice transcript with no punctuation", () => {
        expect(parseNote(LONG_VOICE)?.text).toBe(LONG_VOICE.replace(/^ok make a note /, ""));
    });
    it("strips only the command words", () => {
        expect(parseNote(MULTI)?.text).toBe("the dentist moved my appointment. also the gym card runs out in december!! need to renew it before then. dont forget mum's birthday");
    });
    it("does not stop at an early period (dr.)", () => {
        expect(parseNote(DR)?.text).toBe("call dr. smith about the lab report. he said hed be in till 5 p.m. on friday, so go before then");
    });
    it.each([
        ["can you make a note that i owe jake 20 quid for the pizza. and also the ticket thing", "i owe jake 20 quid for the pizza. and also the ticket thing"],
        ["orion write this down: the wifi in the library is called study-5g, password on the board. dont tell anyone lol", "the wifi in the library is called study-5g, password on the board. dont tell anyone lol"],
        ["remember that the econ tutorial is moving to room 4. also bring the calculator", "the econ tutorial is moving to room 4. also bring the calculator"],
        ["jot down a note about the thing priya said. she wants to swap labs. i said maybe", "about the thing priya said. she wants to swap labs. i said maybe"],
        ["pls take a quick note: buy oat milk, eggs, the good bread. and tell mum i landed", "buy oat milk, eggs, the good bread. and tell mum i landed"],
    ])("%s", (message, text) => expect(parseNote(message)?.text).toBe(text));
    it("keeps line breaks", () => {
        expect(parseNote("make a note:\nbuy eggs\nemail jones.\nring dentist")?.text).toBe("buy eggs\nemail jones.\nring dentist");
    });
    it.each([
        "can you make a note for me really quickly?", "make a note", "note", "remember to call mum at 5", "what notes do i have",
        "open the notes app", "did you make a note of that?", "i noted that already", "my wifi password is on the sticky note",
    ])("is not a note with content: %s", (message) => expect(parseNote(message)).toBeNull());
});
describe("countSentences", () => {
    it("does not split on abbreviations or times", () => {
        expect(countSentences(DR)).toBe(2);
        expect(countSentences("meet at 3.30 with mr. jones and prof. lee e.g. about the quiz")).toBe(1);
    });
    it("counts runs of punctuation once and an unpunctuated run-on as one", () => {
        expect(countSentences("the dentist moved my appointment. also the gym card runs out!! need to renew it. dont forget mum's birthday")).toBe(4);
        expect(countSentences(LONG_VOICE)).toBe(1);
    });
});
describe("runNote", () => {
    const stub = (stdout = 'Added to "Nick": - [note] x (2026-11-04)', code = 0) => {
        const calls = [];
        return { calls, exec: async (args) => { calls.push(args); return { stdout, code }; } };
    };
    it("saves the full text in one call and confirms with a preview and the length", async () => {
        const s = stub();
        const r = await runNote({ message: MULTI, exec: s.exec });
        expect(s.calls).toHaveLength(1);
        expect(s.calls[0]).toEqual(["learn", "Nick", "note", parseNote(MULTI).text]);
        expect(r.outcome).toBe("done");
        if (r.outcome !== "done")
            return;
        expect(r.reply).toMatch(/^Saved the note \(4 sentences\)/);
        expect(r.reply).toContain("the dentist moved my appointment");
        expect((r.reply ?? "").length).toBeLessThan(160);
    });
    it("gives the length in words for a one-sentence run-on", async () => {
        const r = await runNote({ message: LONG_VOICE, exec: stub().exec });
        if (r.outcome !== "done")
            throw new Error("not done");
        expect(r.reply).toMatch(/^Saved the note \(\d+ words\)/);
    });
    it("says nothing was saved when the script fails", async () => {
        const r = await runNote({ message: DR, exec: stub("boom", 1).exec });
        expect(r.outcome).toBe("say");
        if (r.outcome === "say")
            expect(r.text).toMatch(/nothing was saved/i);
    });
    it("falls back when there is no note content", async () => {
        const s = stub();
        expect((await runNote({ message: "make a note", exec: s.exec })).outcome).toBe("fallback");
        expect(s.calls).toHaveLength(0);
    });
});
describe("routing: the whole note is saved by code, not summarised by the worker", () => {
    it("runs orion-brain learn with every sentence and replies from its output", async () => {
        const { mkdtempSync } = await import("node:fs");
        const { tmpdir } = await import("node:os");
        const { join } = await import("node:path");
        const { registerLocalRouting } = await import("./local-routing.js");
        const handlers = new Map();
        const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
        const fire = async (n, e, c) => { const out = []; for (const fn of handlers.get(n) ?? [])
            out.push(await fn(e, c)); return out; };
        const calls = [];
        registerLocalRouting(api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "nf-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Fri 10:00",
            decideImpl: async () => ({ move: "answer", answer: "Noted!" }), scheduleFlow: async () => ({ outcome: "fallback", reason: "t" }),
            noteFlow: (message) => runNote({ message, exec: async (args) => { calls.push(args); return { stdout: 'Added to "Nick": - [note] x', code: 0 }; } }) });
        const ctx = { runId: "nf1", sessionKey: "agent:main:x" };
        await fire("before_model_resolve", { prompt: DR }, ctx);
        const [built] = (await fire("before_prompt_build", { prompt: DR, messages: [] }, ctx));
        expect(calls).toEqual([["learn", "Nick", "note", "call dr. smith about the lab report. he said hed be in till 5 p.m. on friday, so go before then"]]);
        expect(built?.systemPrompt).toContain("Saved the note (2 sentences)");
    });
});
const VOICE_NOTE = "so the thing is the econ tutor said the midterm covers chapters three to six and not seven and i should do the practice set from the website and also ask priya for her notes from the lecture i missed on tuesday because i was at the doctor and dr. patel said to rest for a few days";
describe("a bare note request waits for the note", () => {
    it.each([
        "make a note", "can you write something down", "take a note real quick", "Can you make a note for me really quickly?",
        "orion jot something down please", "hey can you take a quick note", "write this down",
    ])("bare: %s", (m) => expect(isBareNoteRequest(m)).toBe(true));
    it.each([
        "make a note that the lab moved to friday", "note: call dr. smith", "remember that mum lands at 6", "what notes do i have",
        "make a note of the thing priya said", "write something down about the lab",
    ])("not bare: %s", (m) => expect(isBareNoteRequest(m)).toBe(false));
    it("another clear command is not the note, a long ramble that starts like one is", () => {
        for (const m of ["add buy milk to my to-do", "push gym to 8", "what time is my next class", "remind me to call mum at 5", "move my 3pm to 4", "never mind"])
            expect(isOtherCommand(m)).toBe(true);
        expect(isOtherCommand(VOICE_NOTE)).toBe(false);
        expect(isOtherCommand("add to that the fact that the library closes early on fridays and the printer is broken again so print at the union and tell priya the same thing please")).toBe(false);
    });
    it("runNote with bound saves his whole message as the note", async () => {
        const calls = [];
        const r = await runNote({ message: VOICE_NOTE, bound: true, exec: async (a) => { calls.push(a); return { stdout: 'Added to "Nick": x', code: 0 }; } });
        expect(calls).toEqual([["learn", "Nick", "note", VOICE_NOTE]]);
        expect(r.outcome === "done" && r.reply).toMatch(/^Saved the note \((?:2 sentences|\d+ words)\)/);
    });
});
describe("routing: the note after 'make a note for me really quickly?'", () => {
    const setup = async (nowRef) => {
        const { mkdtempSync } = await import("node:fs");
        const { tmpdir } = await import("node:os");
        const { join } = await import("node:path");
        const { registerLocalRouting } = await import("./local-routing.js");
        const handlers = new Map();
        const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
        const fire = async (n, e, c) => { const out = []; for (const fn of handlers.get(n) ?? [])
            out.push(await fn(e, c)); return out; };
        const calls = [];
        registerLocalRouting(api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "nb-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Fri 10:00",
            now: () => new Date(nowRef.t),
            decideImpl: async () => ({ move: "answer", answer: "Got it." }), scheduleFlow: async () => ({ outcome: "fallback", reason: "t" }),
            noteFlow: (message, bound) => runNote({ message, ...(bound ? { bound } : {}), exec: async (a) => { calls.push(a); return { stdout: 'Added to "Nick": x', code: 0 }; } }) });
        let n = 0;
        const say = async (text, key = "agent:main:nb") => {
            const ctx = { runId: `nb${n++}`, sessionKey: key };
            await fire("before_model_resolve", { prompt: text }, ctx);
            const [built] = (await fire("before_prompt_build", { prompt: text, messages: [] }, ctx));
            return built?.systemPrompt ?? "";
        };
        return { say, calls };
    };
    it("asks, then saves the long voice follow-up whole", async () => {
        const t = { t: Date.UTC(2026, 10, 4, 12, 0) };
        const { say, calls } = await setup(t);
        expect(await say("Can you make a note for me really quickly?")).toContain("Go ahead — what's the note?");
        t.t += 60_000;
        expect(await say(VOICE_NOTE)).toContain("Saved the note");
        expect(calls).toEqual([["learn", "Nick", "note", VOICE_NOTE]]);
        t.t += 1000;
        await say("ok thanks");
        expect(calls).toHaveLength(1);
    });
    it("another command in between unbinds it", async () => {
        const t = { t: Date.UTC(2026, 10, 4, 12, 0) };
        const { say, calls } = await setup(t);
        await say("make a note");
        await say("what time is my next class");
        await say(VOICE_NOTE);
        expect(calls).toEqual([]);
    });
    it("expires after ten minutes and is per chat", async () => {
        const t = { t: Date.UTC(2026, 10, 4, 12, 0) };
        const { say, calls } = await setup(t);
        await say("take a note real quick");
        t.t += 11 * 60_000;
        await say(VOICE_NOTE);
        expect(calls).toEqual([]);
        await say("write something down");
        await say(VOICE_NOTE, "agent:main:other");
        expect(calls).toEqual([]);
    });
});
describe("review: a bound note yields to anything that is not a note", () => {
    it.each([
        "actually class moved to 3pm, can you shift my study block?", "no never mind", "no", "nvm", "never mind", "cancel", "thanks", "yes", "yeah", "ok thanks",
        "the lab is tomorrow right?", "please move gym to 6 because the lab ran over and i have not eaten and the tutor wants to see me after class today",
        "could you remind me about the econ quiz when i get home, it is on thursday and i keep forgetting it",
        "i need to reschedule my dentist thing and also push the gym back to the evening because mum is visiting this weekend and we are going out",
        "add milk to my to-do list and also eggs and the good bread from the bakery on the corner before it shuts at five",
    ])("unbinds: %s", (m) => expect(isOtherCommand(m)).toBe(true));
    it.each([
        "i'm so tired", VOICE_NOTE, MULTI, DR, LONG_VOICE, "the wifi in the library is called study-5g, password on the board",
        "tell priya the lab moved to friday and that i will bring the laptop", "ideas for the marketing project: tiktok campaign, student discount, a pop-up stall",
    ])("stays a note: %s", (m) => expect(isOtherCommand(m)).toBe(false));
});
describe("review: a note that looks like a secret is not saved", () => {
    it.each([
        "my wifi password is Hunter2025!", "the pin is 4821 for the locker", "api key: sk-abcdef1234567890abcdef12", "card number 4242 4242 4242 4242 exp 11/28",
        "token ghp_abcdefghijklmnopqrstuvwx1234", "my bank password: Tr0ub4dor&3",
    ])("secret: %s", (m) => expect(looksSecret(m)).toBe(true));
    it.each(["i'm so tired", "the password is on the sticky note", VOICE_NOTE, "call 07700 900123 about the lab", "book ref 1234 5678 is for the library"])("fine: %s", (m) => expect(looksSecret(m)).toBe(false));
    it("runNote refuses, saves nothing, and says why", async () => {
        const calls = [];
        const exec = async (a) => { calls.push(a); return { stdout: "Added", code: 0 }; };
        for (const r of [await runNote({ message: "make a note my wifi password is Hunter2025!", exec }), await runNote({ message: "Hunter2025! is my password: Hunter2025!", exec, bound: true })]) {
            expect(r.outcome === "say" && r.text).toBe("That looks like a password — I didn't save it.");
        }
        expect(calls).toEqual([]);
    });
});
