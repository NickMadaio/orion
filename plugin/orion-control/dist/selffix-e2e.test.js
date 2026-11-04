// w19 selffix: "why did you do that" -> a diagnosis read from his own turns -> an offer -> now / later / no, through the real routing hooks and
// the real scripts/orion-selfcheck and scripts/orion-selffix on a temp state dir. The project library is a stand-in; nothing live is touched.
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
const SCRIPTS = fileURLToPath(new URL("../../../scripts/", import.meta.url));
const NOW = new Date(2026, 10, 4, 14, 0);
function world() {
    const root = mkdtempSync(join(tmpdir(), "w19-selffix-"));
    const dir = join(root, "ctl");
    mkdirSync(join(dir, "chats"), { recursive: true });
    const at = (h, m, s = 0) => new Date(2026, 10, 4, h, m, s).toISOString();
    writeFileSync(join(dir, "chats", "c.json"), JSON.stringify({ id: "c", title: "t", createdAt: at(13, 0), updatedAt: at(13, 5), messages: [
            { role: "user", text: "open amazon uk", id: "u1", at: at(13, 0) },
            { role: "orion", text: "I couldn't run that lookup just now. I could not do that.", id: "o1", at: at(13, 0, 15) },
        ] }));
    writeFileSync(join(dir, "task-ledger.jsonl"), `${JSON.stringify({ taskId: "t1", status: "failed", createdAt: at(13, 0, 5), steps: [{ stepId: "s", status: "failed_permanent", request: { action: "app_open", arguments: { application: "amazon uk" } }, error: "Application \"amazon uk\" was not found in /Applications." }] })}\n`);
    const calls = join(root, "projects.log");
    const fake = join(root, "fake-projects");
    writeFileSync(fake, `#!/usr/bin/env node\nimport { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(calls)}, process.argv.slice(2)[0] + "\\n");\nconsole.log(JSON.stringify(process.argv[2] === "add" ? { id: "project-e2e" } : { launched: true }));\n`);
    chmodSync(fake, 0o755);
    const env = { ...process.env, ORION_CONTROLLED_DIR: dir, ORION_NOW: NOW.toISOString(), ORION_PROJECTS_BIN: fake, ORION_BRAIN_VAULT: join(root, "vault"), ORION_BRIDGE_BIN: "/nonexistent" };
    const run = (script, args, input) => new Promise((resolve) => {
        const child = execFile(process.execPath, [join(SCRIPTS, script), ...args], { env }, (e, stdout) => resolve({ stdout: String(stdout ?? ""), code: e ? 1 : 0 }));
        child.stdin?.end(input ?? "");
    });
    const handlers = new Map();
    const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    const fire = async (n, e, c) => { const o = []; for (const fn of handlers.get(n) ?? [])
        o.push(await fn(e, c)); return o; };
    const desk = [];
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(root, "r.jsonl"), progressDir: join(root, "tp"), stateDir: dir, clock: () => "Wed 14:00", now: () => NOW,
        decideImpl: async (i) => { desk.push(i.message); return { move: "escalate" }; },
        brainSearch: async () => "", scheduleFlow: async () => ({ outcome: "fallback", reason: "test" }), realityRun: async () => ({ stdout: "ok", code: 0 }), selffixRun: run, });
    let n = 0;
    const reply = async (prompt) => {
        const ctx = { runId: `w19-${n += 1}`, sessionKey: "agent:main:orion-chat-w19" };
        await fire("before_model_resolve", { prompt }, ctx);
        const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx));
        return direct?.reply?.text;
    };
    const projectCalls = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : []);
    return { dir, reply, desk, projectCalls };
}
describe("why did you do that, then now / later / no", () => {
    it("diagnoses from his own turn and offers; a repeat is a duplicate, not another offer", async () => {
        const w = world();
        const text = await w.reply("why didnt you open amazon uk");
        expect(text).toMatch(/^I treated "amazon uk" as an app name, so I tried to open an app that doesn't exist\. That's a routing mistake on my side\./);
        expect(text).toMatch(/Start on it now, or later\?$/);
        expect(w.desk).toEqual([]);
        expect(w.projectCalls()).toEqual([]);
        expect(await w.reply("that was wrong")).toMatch(/already have a fix project for this \(waiting for your answer\)/);
    });
    it("later: parks the project, schedules the reminder, does not start it", async () => {
        const w = world();
        await w.reply("why'd u do that");
        const text = await w.reply("tomorrow at 9");
        expect(text).toMatch(/parked it\. It won't run until you say so\. I'll remind you tomorrow at 9:00 AM/);
        expect(w.projectCalls()).toEqual(["add"]);
        const reminders = JSON.parse(readFileSync(join(w.dir, "reminders.json"), "utf8"));
        expect(reminders[0].label).toBe("the fix project for 'open amazon uk' is waiting. Start it?");
        expect(new Date(reminders[0].dueAt).getHours()).toBe(9);
    });
    it("now: creates it and starts the run, saying it goes through the pipeline with its reviews", async () => {
        const w = world();
        await w.reply("you messed up");
        const text = await w.reply("yeah do it now");
        expect(text).toMatch(/starting the fix project now/);
        expect(text).toMatch(/nothing edits my live code directly/);
        expect(w.projectCalls()).toEqual(["add", "launch"]);
    });
    it("no: nothing is created and the decision is recorded", async () => {
        const w = world();
        await w.reply("why did you do that");
        expect(await w.reply("nah leave it")).toMatch(/dropped it/);
        expect(w.projectCalls()).toEqual([]);
        expect(JSON.parse(readFileSync(join(w.dir, "selffix.json"), "utf8")).items[0].status).toBe("declined");
    });
});
