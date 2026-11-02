// Wave 12 L1 (2026-11-02): the learning is real. A question ORION wrote, asked as a push, answered by Nick in chat, reaches the context
// later turns get: the state card of every worker turn, and the recall path's "What he told you" from his Nick note. Real routing hooks,
// the real scripts/orion-questions on a temp state dir and a temp vault; nothing live is read or written.
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
const SCRIPT = fileURLToPath(new URL("../../../scripts/orion-questions", import.meta.url));
const NOW = new Date(2026, 10, 2, 15, 0);
function world() {
    const root = mkdtempSync(join(tmpdir(), "w12-questions-"));
    const dir = join(root, "ctl");
    mkdirSync(dir);
    const vault = join(root, "vault");
    mkdirSync(join(vault, "20 Areas/Me"), { recursive: true });
    const note = join(vault, "20 Areas/Me/Nick.md");
    writeFileSync(note, "---\ntitle: Nick\n---\n\n## Learned\n- [fact] DS lab partner is Priya (2026-10-16)\n");
    const env = { ...process.env, ORION_CONTROLLED_DIR: dir, ORION_BRAIN_VAULT: vault, ORION_NOW: NOW.toISOString(), ORION_BRIDGE_BIN: "/nonexistent" };
    const script = (...args) => execFileSync(process.execPath, [SCRIPT, ...args], { env, encoding: "utf8" });
    const run = (args) => new Promise((resolve) => execFile(process.execPath, [SCRIPT, ...args], { env }, (e, stdout) => resolve({ stdout: String(stdout ?? ""), code: e ? 1 : 0 })));
    const handlers = new Map();
    const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    const fire = async (n, e, c) => { const o = []; for (const fn of handlers.get(n) ?? [])
        o.push(await fn(e, c)); return o; };
    const desk = [];
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(root, "r.jsonl"), progressDir: join(root, "tp"), stateDir: dir, clock: () => "Mon 15:00", now: () => NOW,
        decideImpl: async (i) => { desk.push(i.message); return { move: "escalate" }; },
        brainSearch: async () => "", scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }), realityRun: async () => ({ stdout: "ok", code: 0 }),
        questionsRun: run, nickNote: () => readFileSync(note, "utf8"), });
    let n = 0;
    const ctxOf = () => ({ runId: `w12-${n += 1}`, sessionKey: "agent:main:orion-chat-w12" });
    const reply = async (prompt) => {
        const ctx = ctxOf();
        await fire("before_model_resolve", { prompt }, ctx);
        const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx));
        return direct?.reply?.text;
    };
    const prompt = async (text) => {
        const ctx = ctxOf();
        await fire("before_model_resolve", { prompt: text }, ctx);
        const [built] = (await fire("before_prompt_build", { prompt: text, messages: [] }, ctx));
        return built?.systemPrompt ?? "";
    };
    return { dir, note, script, reply, prompt, desk };
}
describe("question → answer → memory a later turn reads", () => {
    it("ORION's question, pushed and answered in chat, is kept and reaches the next turns", async () => {
        const w = world();
        // ORION writes the question (the worker's exec), then the proactive path asks it as a push into his chat thread.
        const added = JSON.parse(w.script("add", "Who is Sam?", "--why", "he said he lifts with Sam", "--topic", "person", "--json"));
        const id = added.added.id;
        w.script("asked", id, "--via", "push", "--text", "Question for you: Who is Sam?");
        writeFileSync(join(w.dir, "outreach.jsonl"), `${JSON.stringify({ id: "r1", text: "Question for you: Who is Sam?", at: new Date(NOW.getTime() - 12 * 60_000).toISOString(), channel: "phone", kind: "question" })}\n`);
        // His answer, his style. Code binds it to the question: no desk, no model.
        expect(await w.reply("hes my gym buddy from uni we lift tuesdays")).toBe("Got it, thanks. I'll remember that.");
        expect(w.desk).toEqual([]);
        const rows = readFileSync(join(w.dir, "questions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
        expect(rows.find((r) => r.id === id)?.status).toBe("answered");
        expect(readFileSync(w.note, "utf8")).toMatch(/- \[answer\] Who is Sam\? → hes my gym buddy from uni we lift tuesdays #answer \(2026-11-02\)/);
        // A later ordinary turn: the worker's state card carries the answer.
        const later = await w.prompt("should i hit the gym with someone today");
        expect(later).toMatch(/He answered your questions \(his own words; use them\): Who is Sam\? → hes my gym buddy from uni we lift tuesdays/);
        // A later recall turn: "What he told you" from his Nick note includes it.
        const recall = await w.prompt("do you remember who sam is");
        expect(recall).toMatch(/What he told you[\s\S]*\[answer\] Who is Sam\? → hes my gym buddy from uni we lift tuesdays #answer/);
    });
    it("any questions for me → the top one, and his next message answers it; forget that question drops it", async () => {
        const w = world();
        w.script("add", "Do you prefer the gym in the morning or the evening?", "--topic", "preference");
        w.script("add", "Is Priya in your DS lab or your CS lab?", "--topic", "person");
        expect(await w.reply("any qs for me orion")).toBe("A few things I've been wondering. First: Do you prefer the gym in the morning or the evening? After that: Is Priya in your DS lab or your CS lab?");
        expect(await w.reply("evenings def i'm dead in the mornings")).toBe("Got it, thanks. I'll remember that.");
        expect(readFileSync(w.note, "utf8")).toMatch(/Do you prefer the gym in the morning or the evening\? → evenings def/);
        expect(await w.reply("nah drop the question about priya its fine")).toBe('Okay, dropped it. I won\'t ask "Is Priya in your DS lab or your CS lab?" again.');
        expect(await w.reply("what do you wanna ask me")).toMatch(/^Nothing right now/);
    });
});
