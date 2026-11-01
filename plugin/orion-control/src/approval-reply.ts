/*
 A held outward action, said as a draft and a question (gate run-1101020721, saf-send-message-v).

 messages_send came back needs_approval (nothing sent), the worker said something else, and the generic no-effect line ("I didn't actually
 do that…") replaced the confirm prompt. When a task run this turn is held for approval, the reply is the draft plus "want me to send
 it?". Nothing here sends or approves anything: a yes next turn goes through the normal approval path.
 Pure: reads this turn's tool calls and results.
*/
type Tool = { canonical: string; stdout: string };
type Step = { action?: unknown; recipient?: unknown; to?: unknown; body?: unknown; text?: unknown; arguments?: Record<string, unknown> };

type Call = { id?: unknown; name?: unknown; args?: { steps?: Step[]; graph?: { steps?: Step[] } }; steps?: Step[]; graph?: { steps?: Step[] } };
const TASK_RUN = /(?:^|:)orion_task_run$/;

function callOf(canonical: string): Call | undefined {
  const at = canonical.indexOf("{");
  if (at < 0) return undefined;
  try { return JSON.parse(canonical.slice(at)) as Call; } catch { return undefined; }
}
/** An orion_task_run call: named so as the tool, or so in a tool_call's id. Never any other tool whose output mentions it. */
function isTaskRun(canonical: string): boolean {
  const head = canonical.trim().split(/[\s{]/, 1)[0] ?? "";
  if (TASK_RUN.test(head)) return true;
  const c = callOf(canonical);
  return [c?.id, c?.name].some((v) => typeof v === "string" && TASK_RUN.test(v));
}
/** Wave 4 review finding 4: held only by a structured "status": "needs_approval" in the run's JSON result, never by its wording. */
function heldResult(stdout: string): boolean {
  const text = stdout.trim();
  const body = text.startsWith("{") ? text : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let o: Record<string, unknown>;
  try { o = JSON.parse(body) as Record<string, unknown>; } catch { return false; }
  if (!o || typeof o !== "object") return false;
  const layers = [o, o.result, o.details].filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  return layers.some((l) => l.status === "needs_approval") && !layers.some((l) => l.executed === true);
}
function stepsOf(canonical: string): Step[] {
  const p = callOf(canonical);
  const inner = p?.args ?? p;
  return inner?.steps ?? inner?.graph?.steps ?? [];
}
const field = (s: Step, ...keys: Array<"recipient" | "to" | "body" | "text">) => {
  for (const k of keys) { const v = s.arguments?.[k] ?? s[k]; if (typeof v === "string" && v.trim()) return v.trim(); }
  return undefined;
};
const name = (s: string) => (/^[a-z][a-z' -]*$/.test(s) ? s.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);

/** The reply for a task run held for approval this turn (the draft and a question), or undefined. */
export function approvalAsk(tools: readonly Tool[]): string | undefined {
  const held = [...tools].reverse().find((t) => isTaskRun(t.canonical) && heldResult(t.stdout));
  if (!held) return undefined;
  // Wave 4 review finding 3: a "yes" approves the whole held run, so every step is shown, or none is (the generic ask).
  const GENERIC = "I haven't done that yet: it needs your OK first. Want me to go ahead?";
  const steps = stepsOf(held.canonical);
  if (!steps.length || steps.some((s) => s.action !== "messages_send")) return GENERIC;
  const drafts = steps.map((s) => ({ who: field(s, "recipient", "to"), body: field(s, "body", "text") }));
  if (drafts.length === 1) {
    const { who, body } = drafts[0]!;
    if (!body) return `I haven't sent anything${who ? ` to ${name(who)}` : ""} yet. What should it say?`;
    return `Here's the draft${who ? ` to ${name(who)}` : ""}: "${body}". I haven't sent it. Want me to send it?`;
  }
  if (drafts.some((d) => !d.body || !d.who)) return GENERIC;
  return `Here are the drafts: ${drafts.map((d) => `to ${name(d.who!)}, "${d.body}"`).join("; ")}. I haven't sent them. Want me to send them?`;
}
