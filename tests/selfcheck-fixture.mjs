// A fixture state directory for the self-check tests: one conversation with a routing mistake, one clean turn, one dropped turn.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const jl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const secret = "sk" + "-live-" + "abcdefghijklmnop1234";

export function writeFixtureDir(dir, { day = "2026-11-04" } = {}) {
  mkdirSync(join(dir, "chats"), { recursive: true });
  mkdirSync(join(dir, "local-routing"), { recursive: true });
  const T = (hhmmss) => `${day}T${hhmmss}Z`;
  const messages = [
    { role: "user", text: "whats on my plan", id: "u1", at: T("09:00:00") },
    { role: "orion", text: "You have class at 10 and the gym at 5.", id: "o1", at: T("09:00:08") },
    { role: "user", text: "open amazon uk", id: "u2", at: T("11:29:49") },
    { role: "orion", text: "I couldn't run that lookup just now. I could not do that.", id: "o2", at: T("11:30:04") },
    { role: "user", text: "no amazon is a website", id: "u3", at: T("11:30:30") },
    { role: "orion", text: "Done: opened Safari.", id: "o3", at: T("11:30:40") },
    { role: "user", text: "remind me to call mum", id: "u4", at: T("12:10:00") },
  ];
  writeFileSync(join(dir, "chats", "chat-a.json"), JSON.stringify({ id: "a", title: "t", createdAt: T("09:00:00"), updatedAt: T("12:10:00"), messages }));
  writeFileSync(join(dir, "local-routing", "shadow.jsonl"), jl([
    { at: T("09:00:02.000"), message: "whats on my plan", decision: { move: "answer", ms: 900 }, flow: "day-read", tools: 0, findings: [[]] },
    { at: T("11:29:52.100"), message: "open amazon uk", decision: { move: "tool", tool: "app_open", args: { application: "Amazon UK" }, ms: 2300 }, flow: null, tools: 2, findings: [[]] },
    { at: T("11:30:32.000"), message: "no amazon is a website", decision: { move: "ask", answer: "Which one?", ms: 100 }, flow: null, tools: 0, findings: [["failure not mentioned"]] },
  ]));
  writeFileSync(join(dir, "task-ledger.jsonl"), jl([
    { taskId: "t1", status: "failed", createdAt: T("11:30:01.000"), steps: [{ stepId: "step-1", status: "failed_permanent", request: { action: "app_open", arguments: { application: "amazon uk", note: `token=${secret}` } }, error: 'Application "amazon uk" was not found in /Applications, /Applications/Utilities.' }] },
    { taskId: "t0", status: "completed", createdAt: T("08:00:00.000"), steps: [{ stepId: "step-1", status: "completed", request: { action: "weather_now", arguments: { location: "London" } } }] },
  ]));
  return { day, secret };
}
