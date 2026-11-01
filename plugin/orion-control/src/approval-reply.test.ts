// Gate run-1101020721 saf-send-message-v: messages_send came back needs_approval (nothing sent), and the generic no-effect line ("I didn't
// actually do that…") replaced the confirm prompt. A held send is said as its draft plus a question; it is never sent from here.
// Phrasings are held out of scripts/eval/gate/scenarios.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { approvalAsk } from "./approval-reply.js";
import { registerLocalRouting } from "./local-routing.js";

const HELD = JSON.stringify({ tool: { id: "openclaw:orion-control:orion_task_run", name: "orion_task_run", description: "Run an Orion TaskGraph" },
  result: { executed: false, outcome: "NO MESSAGE WAS SENT. NOT DONE. THIS IS NOT A SUCCESS.", reportToUser: "I have NOT send that message yet", status: "needs_approval", validation: { valid: false, status: "needs_approval", issues: [{ code: "approval_required" }] }, steps: [] } }, null, 2);
const sendCall = (recipient: string, body: string) => `tool_call ${JSON.stringify({ id: "orion_task_run", args: { steps: [{ action: "messages_send", recipient, body }] } })}`;

describe("approvalAsk", () => {
  it.each([["priya", "running 10 min behind"], ["mum", "on the train now"], ["sam", "cant make it tonight sorry"]])("%s: the draft, not sent, and a question", (who, body) => {
    const line = approvalAsk([{ canonical: sendCall(who, body), stdout: HELD }]);
    expect(line).toContain(`"${body}"`);
    expect(line).toContain(who.charAt(0).toUpperCase() + who.slice(1));
    expect(line).toMatch(/haven't sent it/i);
    expect(line).toMatch(/\?$/);
    expect(line).not.toMatch(/\bSent\b|\bDone\b/);
  });
  it("the graph form is read too", () => {
    const canonical = `orion_task_run ${JSON.stringify({ graph: { goal: "text", steps: [{ id: "s1", action: "messages_send", arguments: { recipient: "priya", body: "omw" } }] } })}`;
    expect(approvalAsk([{ canonical, stdout: HELD }])).toContain('"omw"');
  });
  it("a send that went through, or no held result, is not an approval ask", () => {
    expect(approvalAsk([{ canonical: sendCall("priya", "omw"), stdout: '{"executed": true, "outcome": "DONE — this really happened"}' }])).toBeUndefined();
    expect(approvalAsk([])).toBeUndefined();
  });
});

// Wave 4 review finding 4: any tool output saying "NO MESSAGE WAS SENT" read as a held send. Only an orion_task_run result with a
// structured needs_approval status is held.
describe("only a structured needs_approval from orion_task_run is held", () => {
  it("a failed send's text is not an approval ask", () => {
    const failed = JSON.stringify({ result: { executed: false, outcome: "NO MESSAGE WAS SENT. NOT DONE.", status: "failed" } });
    expect(approvalAsk([{ canonical: sendCall("priya", "omw"), stdout: failed }])).toBeUndefined();
  });
  it("another tool's output quoting the phrase is not held", () => {
    const status = JSON.stringify({ result: { status: "needs_approval" } });
    expect(approvalAsk([{ canonical: "exec cat notes.txt", stdout: "NO MESSAGE WAS SENT" }])).toBeUndefined();
    expect(approvalAsk([{ canonical: "exec orion-brain search x", stdout: status }])).toBeUndefined();
  });
  it("a status buried in plain text is not structured", () => {
    expect(approvalAsk([{ canonical: sendCall("priya", "omw"), stdout: 'log: "status": "needs_approval" (old run)' }])).toBeUndefined();
  });
});

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
function router() {
  const handlers = new Map<string, Handler[]>();
  const api = { on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) };
  const fire = async (name: string, event: Record<string, unknown>, ctx: Record<string, unknown>) => {
    const out: unknown[] = [];
    for (const fn of handlers.get(name) ?? []) out.push(await fn(event, ctx));
    return out;
  };
  registerLocalRouting(api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "appr-")), "r.jsonl"), brainSearch: async () => "",
    clock: () => "Mon 10:00", now: () => new Date(2026, 10, 2, 10, 0), decideImpl: async () => ({ move: "tool", tool: "app_open", args: { application: "Messages" } }) as never,
    scheduleFlow: async () => ({ outcome: "fallback", reason: "t" }) });
  return { fire };
}

describe("through the router: the held send is said as a draft and a question", () => {
  it.each(["msg priya saying running 10 min behind", "tell sam i cant make it tonight sorry"])("%s", async (said) => {
    const { fire } = router();
    const ctx = { runId: `appr-${said.length}`, sessionKey: "agent:main:orion-chat-appr" };
    await fire("before_model_resolve", { prompt: said }, ctx);
    await fire("before_prompt_build", { prompt: said, messages: [] }, ctx);
    const who = said.includes("priya") ? "priya" : "sam";
    const body = said.includes("priya") ? "running 10 min behind" : "i cant make it tonight sorry";
    await fire("after_tool_call", { toolName: "tool_call", params: { id: "orion_task_run", args: { steps: [{ action: "messages_send", recipient: who, body }] } }, result: HELD }, ctx);
    const messages = [{ role: "user", content: said }, { role: "assistant", content: "Sent it!" }];
    await fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Sent it!", hadDeterministicSideEffect: true, messages }, ctx);
    const final = String(messages[1]!.content);
    expect(final).toContain(`"${body}"`);
    expect(final).toMatch(/haven't sent it/i);
    expect(final).not.toMatch(/didn't actually do that|Sent it/);
  });
});
