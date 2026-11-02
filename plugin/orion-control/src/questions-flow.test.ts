// Wave 12 L1 (2026-11-02): ORION's questions for Nick in chat. Phrasings are Nick-style (lowercase, typos, run-on) and held out of
// scripts/eval/gate/scenarios/. The script runner is faked; replies are built from its JSON.
import { describe, expect, it } from "vitest";
import { readQuestionsMove, runQuestionsMove, asksForQuestions, dropsQuestion, type QuestionsRun } from "./questions-flow.js";
import { answeredLine, awaitingRow, type QuestionRow } from "./questions-store.js";

const NOW = new Date("2026-11-02T15:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const row = (over: Partial<QuestionRow> = {}): QuestionRow => ({ id: "q-aaaaaa", q: "Who is Sam?", status: "open", priority: "normal", created: ago(600), askCount: 0, ...over });
const askedPush = (min = 10, over: Partial<QuestionRow> = {}) => row({ status: "asked", askedAt: ago(min), askedVia: "push", askedText: "Question for you: Who is Sam?", askCount: 1, ...over });
const ctx = (rows: QuestionRow[], over = {}) => ({ stateDir: "/nonexistent", now: NOW, rows, ...over });

function fake(answer: (args: string[]) => unknown = () => ({ ok: true })): { run: QuestionsRun; calls: string[][] } {
  const calls: string[][] = [];
  const run: QuestionsRun = async (args) => { calls.push(args); const out = answer(args); return out === undefined ? { stdout: "", code: 1 } : { stdout: JSON.stringify(out), code: 0 }; };
  return { run, calls };
}

describe("front-desk routes: what do you wanna ask me / forget that question", () => {
  it.each([
    "what do you wanna ask me",
    "any questions for me",
    // held out, his style
    "yo what do u wanna ask me",
    "any qs for me orion",
    "u got any questions for me or nah",
  ])("lists: %s", (m) => expect(asksForQuestions(m)).toBe(true));

  it.each([
    "forget that question",
    // held out, his style
    "forget that question lol",
    "nah drop that question its dumb",
    "dont ask me that one again",
  ])("drops: %s", (m) => expect(dropsQuestion(m)).toBeDefined());

  it.each(["what did i ask you to do", "remind me to ask sam about gym", "forget the wifi thing", "what time is it", "any plans for me today"])("not a questions route: %s", (m) => {
    expect(asksForQuestions(m)).toBe(false);
    expect(dropsQuestion(m)).toBeUndefined();
  });

  it("list says the top question, marks it asked in chat, and names up to two more", async () => {
    const rows = [row(), row({ id: "q-bbbbbb", q: "Do you prefer gym mornings?", created: ago(500) }), row({ id: "q-cccccc", q: "Is Priya in your DS lab?", created: ago(400) }), row({ id: "q-dddddd", q: "Fourth?", created: ago(300) })];
    const move = readQuestionsMove("any qs for me orion", ctx(rows));
    expect(move?.kind).toBe("list");
    const { run, calls } = fake();
    const out = await runQuestionsMove(move!, run);
    expect(calls).toEqual([["asked", "q-aaaaaa", "--via", "chat", "--text", "Who is Sam?", "--json"]]);
    expect(out.text).toBe("A few things I've been wondering. First: Who is Sam? After that: Do you prefer gym mornings? / Is Priya in your DS lab?");
  });

  it("list with nothing open says so, and writes nothing", async () => {
    const { run, calls } = fake();
    const out = await runQuestionsMove(readQuestionsMove("what do you wanna ask me", ctx([]))!, run);
    expect(calls).toEqual([]);
    expect(out.text).toMatch(/^Nothing right now/);
  });

  it("forget that question drops the one on the table; by name when he names it; nothing when none", async () => {
    const { run, calls } = fake();
    const onTable = readQuestionsMove("forget that question lol", ctx([askedPush()]));
    expect(onTable).toEqual({ kind: "drop", id: "q-aaaaaa", q: "Who is Sam?" });
    expect((await runQuestionsMove(onTable!, run)).text).toBe('Okay, dropped it. I won\'t ask "Who is Sam?" again.');
    expect(calls[0]!.slice(0, 2)).toEqual(["drop", "q-aaaaaa"]);
    const named = readQuestionsMove("drop the question about priya pls", ctx([row(), row({ id: "q-cccccc", q: "Is Priya in your DS lab?" })]));
    expect(named).toMatchObject({ kind: "drop", id: "q-cccccc" });
    const none = readQuestionsMove("forget that question", ctx([row()]));
    expect((await runQuestionsMove(none!, fake().run)).text).toBe("There's no question of mine waiting on you.");
  });
});

describe("his reply to ORION's question binds as the answer", () => {
  it("a reply to the pushed question is answered through orion-questions", async () => {
    const move = readQuestionsMove("hes my gym buddy from uni we lift tuesdays", ctx([askedPush()], { lastPush: { text: "Question for you: Who is Sam?", at: ago(10) } }));
    expect(move).toEqual({ kind: "answer", id: "q-aaaaaa", q: "Who is Sam?", text: "hes my gym buddy from uni we lift tuesdays" });
    const { run, calls } = fake(() => ({ ok: true, kept: "vault", fact: "Who is Sam? → hes my gym buddy" }));
    const out = await runQuestionsMove(move!, run);
    expect(calls).toEqual([["answer", "q-aaaaaa", "hes my gym buddy from uni we lift tuesdays", "--json"]]);
    expect(out.text).toBe("Got it, thanks. I'll remember that.");
  });

  it("the app's label naming the question binds it too", () => {
    expect(readQuestionsMove("sam's my roommate", ctx([askedPush(60)], { label: "Question for you: Who is Sam?" }))?.kind).toBe("answer");
  });

  it("not when something newer was sent, the label is another message, it is too old, or it is his own request/question", () => {
    expect(readQuestionsMove("my gym buddy", ctx([askedPush()], { lastPush: { text: "Gym, now.", at: ago(2) } }))).toBeUndefined();
    expect(readQuestionsMove("my gym buddy", ctx([askedPush()], { label: "It's 12:02 AM, bedtime." }))).toBeUndefined();
    expect(readQuestionsMove("my gym buddy", ctx([askedPush(200)]))).toBeUndefined();
    expect(readQuestionsMove("can you move gym to 7", ctx([askedPush()]))).toBeUndefined();
    expect(readQuestionsMove("what time is my class?", ctx([askedPush()]))).toBeUndefined();
    expect(readQuestionsMove("my gym buddy", ctx([row()]))).toBeUndefined();
  });

  it("a question listed in chat binds for 30 min", () => {
    const chat = row({ status: "asked", askedAt: ago(5), askedVia: "chat", askedText: "Who is Sam?", askCount: 1 });
    expect(awaitingRow([chat], NOW, {})?.id).toBe("q-aaaaaa");
    expect(awaitingRow([{ ...chat, askedAt: ago(45) }], NOW, {})).toBeUndefined();
  });

  it("idk / ask me later is a skip, not an answer", async () => {
    const move = readQuestionsMove("idk ask me later", ctx([askedPush()]));
    expect(move).toEqual({ kind: "skip", id: "q-aaaaaa", q: "Who is Sam?" });
    const { run, calls } = fake();
    expect((await runQuestionsMove(move!, run)).text).toBe("No worries, I'll ask another time.");
    expect(calls[0]).toEqual(["skip", "q-aaaaaa", "--json"]);
  });

  it("a failed write is said plainly", async () => {
    const out = await runQuestionsMove({ kind: "answer", id: "q-aaaaaa", q: "Who is Sam?", text: "x" }, fake(() => undefined).run);
    expect(out.text).toMatch(/couldn't save that/);
  });
});

describe("the worker knows the questions queue and its own-notes commands", () => {
  it("GENERAL and BRAIN instructions advertise orion-questions and own-note edit/unlearn, with when to write a question", async () => {
    const { GENERAL_INSTRUCTIONS, BRAIN_INSTRUCTIONS } = await import("./job-instructions.js");
    for (const prompt of [GENERAL_INSTRUCTIONS, BRAIN_INSTRUCTIONS]) expect(prompt).toMatch(/orion-questions add "<question>" --why/);
    // GENERAL is at its size budget (reschedule-incident test): the own-notes commands live in BRAIN, where notes are worked on.
    expect(GENERAL_INSTRUCTIONS).toMatch(/unsure of a fact, preference, person or routine of his\? add it, never guess/);
    expect(BRAIN_INSTRUCTIONS).toMatch(/orion-brain mine \| unlearn <id> \| edit <id>/);
    expect(BRAIN_INSTRUCTIONS).toMatch(/learn --own/);
  });
});

describe("answers reach every later turn (state card line)", () => {
  it("the newest answered facts, within 30 days", () => {
    const rows = [
      row({ id: "q-1", status: "answered", answeredAt: ago(60), fact: "Who is Sam? → my gym buddy" }),
      row({ id: "q-2", status: "answered", answeredAt: new Date(NOW.getTime() - 40 * 86400_000).toISOString(), fact: "old → gone" }),
      row({ id: "q-3", status: "dropped", fact: "dropped → no" }),
    ];
    expect(answeredLine(rows, NOW)).toBe("- He answered your questions (his own words; use them): Who is Sam? → my gym buddy");
    expect(answeredLine([], NOW)).toBe("");
  });
});
