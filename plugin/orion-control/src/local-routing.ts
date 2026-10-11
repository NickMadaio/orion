/*
 Local routing (V3): front desk → worker → check → retry → honest stop.

 docs/planning/v3/ORION_V3_IMPLEMENTATION_PLAN.md; results in docs/evals/v3/REPORT.md §9.

 SHADOW (`localRouting: "shadow"`): on every real turn, ask the front desk what it would have done
 (fire and forget, so no added latency) and run the work check on the answer ORION actually gave;
 append both to a private log. Never overrides, replies or revises.

 ON (`localRouting: "on"`):
   1. before_model_resolve — the front desk (qwen3.5:4b) picks a move; every turn then runs on the
      worker (ollama/qwen3.5:9b) — never the cloud model. For answer/ask the worker is handed the
      front desk's draft to confirm (step 3), since the direct-reply hook does not fire on the
      agent-CLI/phone route (found live 2026-10-11). "ignore" is deliberately NOT silenced: a
      wrong "not for ORION" must never swallow a real request (6/138 critical misroutes held-out).
   2. before_agent_reply — the front desk's own answer/question is sent without a model call.
   3. before_prompt_build — the worker gets the V3-tuned instructions for the job: scheduling
      (coach guide + full reschedule usage), brain, or the general honesty block.
   4. before_agent_finalize — the work check. Findings → one revise with what to fix. Still
      flagged → one more revise: undo any change and tell Nick plainly what did not happen.
      Then finalize. The hand-off to gpt-oss (plan step 5) is logged as `escalationNeeded` until
      that model is registered in the gateway and the follow-up turn is proven.

 Phone, Mac chat and voice all reach the gateway as agent turns, so every channel is covered; the
 phone's channel brief is stripped so the front desk reads only Nick's words.
 (Written by Claude on 2026-10-10 for the V3 implementation.)
*/
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { decide, warmUp, type Decision } from "./front-desk.js";
import { BRAIN_INSTRUCTIONS, GENERAL_INSTRUCTIONS, SCHEDULING_INSTRUCTIONS, WORKER_MODEL } from "./job-instructions.js";
import { checkWork, retryInstruction, type ToolResult } from "./work-check.js";

export type LocalRoutingMode = "off" | "shadow" | "on";
type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
type HookApi = { on: (name: string, fn: Handler) => unknown; logger?: { warn?: (m: string) => void } };

export type LocalRoutingOptions = {
  mode: LocalRoutingMode;
  logPath: string;
  decideImpl?: (input: { message: string; clock: string }) => Promise<Decision>;
  clock?: () => string;
  finalizeWaitMs?: number;
  workerProvider?: string;
  workerModel?: string;
  /** Load the front desk at registration (off in tests). */
  warm?: boolean;
  /** Append one line per hook stage to <logPath>.trace (diagnostics). */
  trace?: boolean;
};

type Run = {
  message: string;
  decision: Promise<Decision | { error: string }>;
  settled?: Decision;
  tools: ToolResult[];
  started: number;
  passes: number;
  findings: string[][];
};

const INTERNAL = /\b(?:cron|heartbeat|doctor|test|subagent|eval)\b/i;
const MARKERS = ["--- Nick's message follows ---", "User message:\n"];
const SCHEDULING = /\b(schedul\w*|calendar|plan|replan|day|tonight|tomorrow|morning|afternoon|evening|block|move|push|pull|swap|resize|extend|shorten|clear|drop|free|fit|class|lab|lecture|study|gym|nap|dinner|lunch|breakfast|meeting|appointment|undo|reschedule|out from|leaving at)\b|\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i;
// "schedule me for…", "move X", "put X between…", "change of plans": work, never a drafted reply.
const CHANGE_REQUEST = /\b(schedul\w*|reschedul\w*|move|put|add|book|fit|clear|cancel|push|pull|swap|replace|rebuild|redo|plan (my|the)|change of plans|shorten|extend|resize|drop|skip)\b/i;
const BRAIN = /\b(remember|note|notes|brain|wrote|write down|repair (queue|list)|bug|save (that|this|it))\b/i;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const pick = (event: Record<string, unknown>, ctx: Record<string, unknown>, key: string) => str(event[key]) ?? str(ctx[key]);

/** Nick's own words: the part after a channel brief, if the message carries one. */
export function userText(prompt: string): string {
  for (const marker of MARKERS) if (prompt.includes(marker)) return prompt.split(marker).pop()!.trim();
  return prompt.trim();
}

/** "Sat 18:05" in local time, the clock format the front desk was evaluated with. */
export function localClock(now = new Date()): string {
  const day = now.toLocaleDateString("en-GB", { weekday: "short" });
  return `${day} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/** A tool result's text, whatever shape the host hands back. */
export function resultText(result: unknown): string {
  if (typeof result === "string") return result;
  const content = (result as { content?: Array<{ text?: string }> } | undefined)?.content;
  if (Array.isArray(content)) return content.map((c) => c?.text ?? "").join("\n");
  try { return JSON.stringify(result) ?? ""; } catch { return String(result); }
}

/** The canonical call string the work check reads ("exec orion-reschedule move …"). */
export function canonicalCall(toolName: string, params: unknown): string {
  const p = (params ?? {}) as Record<string, unknown>;
  if (toolName === "exec") return `exec ${String(p.command ?? "").trim().replace(/^\S*\//, "")}`;
  return `${toolName} ${JSON.stringify(p)}`;
}

/** The worker's instructions for this job. */
export function instructionsFor(decision: Decision | undefined, message: string): string {
  if (decision?.tool === "brain" || decision?.tool === "repair_note" || (!decision?.tool && BRAIN.test(message))) return BRAIN_INSTRUCTIONS;
  if (["agenda", "reschedule", "tasks"].includes(decision?.tool ?? "") || SCHEDULING.test(message)) return SCHEDULING_INSTRUCTIONS;
  return GENERAL_INSTRUCTIONS;
}

const LOCAL_IDENTITY = "You are ORION, Nick's personal assistant on his Mac and iPhone. Reply in one to three short sentences, the way you would say it out loud: no lists, no markdown, times like 8:15 PM. Never say something happened unless a tool result shows it did.";

/** "Today is Sunday 2026-10-11; tomorrow is Monday 2026-10-12." — so --date never needs arithmetic. */
export function dateLine(now = new Date()): string {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const name = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "long" });
  const tomorrow = new Date(now.getTime() + 86400000);
  return `Today is ${name(now)} ${iso(now)}; tomorrow is ${name(tomorrow)} ${iso(tomorrow)}.`;
}

// What the live system needs that the evaluation sandbox did not (2026-10-11, "fix my schedule"
// failed on all four: bare script names refused, "&" in a title refused, a guessed date, asking
// for times it could read).
export const PRODUCTION_NOTES = [
  "On this Mac, exec needs the full path of a script: /Users/nickmadaio/Desktop/ORION/scripts/orion-agenda, /Users/nickmadaio/Desktop/ORION/scripts/orion-reschedule, /Users/nickmadaio/Desktop/ORION/scripts/orion-tasks, /Users/nickmadaio/Desktop/ORION/scripts/orion-brain (same for every orion- script).",
  "Read a day with: orion-agenda day <today|tomorrow|weekday|YYYY-MM-DD>. For another day's change add --date <tomorrow|weekday|YYYY-MM-DD>.",
  "Never put & ; | or > inside an argument, even in quotes: name a class by its code or a distinctive word (\"CS2101\", \"Discrete\").",
  "\"Fill the time between two classes with X\" is one call: orion-reschedule move \"X\" --after \"<first class>\" --before \"<second class>\" (add --date for another day). If X is not on that day yet, use add \"X\" <minutes> --after … --before ….",
  "Do the job: read his calendar instead of asking him for times you can look up. Ask only for what no tool can tell you.",
].join("\n");

const HONEST_STOP = "The check still finds a problem. Undo any change you made in this turn (orion-reschedule undo, or the matching undo), then tell Nick in one or two plain sentences what you could not do and why. Do not say it is done.";

export function registerLocalRouting(api: HookApi, options: LocalRoutingOptions): void {
  if (options.mode === "off") return;
  const on = options.mode === "on";
  const { logPath, decideImpl = (input) => decide(input), clock = () => localClock(), finalizeWaitMs = 5000, workerProvider = "ollama", workerModel = WORKER_MODEL } = options;
  if (options.warm !== false) void warmUp();
  const traceLine = (stage: string, event: Record<string, unknown>, ctx: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    if (!options.trace) return;
    try { appendFileSync(`${logPath}.trace`, `${JSON.stringify({ at: new Date().toISOString(), stage, runId: pick(event, ctx, "runId") ?? null, sessionKey: pick(event, ctx, "sessionKey") ?? null, ...extra })}\n`, { mode: 0o600 }); } catch { /* diagnostics only */ }
  };
  const runs = new Map<string, Run>();
  const runFor = (event: Record<string, unknown>, ctx: Record<string, unknown>) => runs.get(pick(event, ctx, "runId") ?? "") ?? runs.get(`session:${pick(event, ctx, "sessionKey") ?? ""}`);
  const log = (entry: Record<string, unknown>) => {
    try {
      mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });
      appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), mode: options.mode, ...entry })}\n`, { mode: 0o600 });
    } catch (error) {
      api.logger?.warn?.(`[orion-control] local routing log failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const settle = async (run: Run): Promise<Decision | { error: string }> => {
    const timeout = new Promise<{ error: string }>((resolve) => setTimeout(() => resolve({ error: "front desk still running" }), finalizeWaitMs));
    return Promise.race([run.decision, timeout]);
  };

  api.on("before_model_resolve", async (event, ctx) => {
    const runId = pick(event, ctx, "runId");
    const sessionKey = pick(event, ctx, "sessionKey") ?? "";
    const raw = str(event.prompt);
    traceLine("before_model_resolve", event, ctx, { hasPrompt: !!raw });
    if (!raw || INTERNAL.test(sessionKey)) return undefined;
    const message = userText(raw);
    const decision = Promise.resolve()
      .then(() => decideImpl({ message, clock: clock() }))
      .catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
    const run: Run = { message, decision, tools: [], started: Date.now(), passes: 0, findings: [] };
    if (runId) runs.set(runId, run);
    if (sessionKey) runs.set(`session:${sessionKey}`, run);
    if (!on) return undefined; // shadow: fire and forget
    const d = await decision;
    if ("error" in d) return { providerOverride: workerProvider, modelOverride: workerModel };
    run.settled = d;
    // Every move goes to the local worker: the direct-reply hook does not fire on every route
    // (agent CLI / phone), and falling through to the configured cloud model costs money.
    return { providerOverride: workerProvider, modelOverride: workerModel };
  });

  if (on) {
    api.on("before_agent_reply", (event, ctx) => {
      const d = runFor(event, ctx)?.settled;
      traceLine("before_agent_reply", event, ctx, { move: d?.move ?? null });
      const run = runFor(event, ctx);
      if (d?.move === "answer" && d.answer && !CHANGE_REQUEST.test(run?.message ?? "")) return { handled: true, reply: { text: d.answer }, reason: "front desk answered" };
      return undefined;
    });

    api.on("before_prompt_build", (event, ctx) => {
      const run = runFor(event, ctx);
      if (!run?.settled) return undefined;
      // The workspace prompt written for Claude is ~17k tokens; on the 9B that cost 60-100 s a turn
      // (live, 2026-10-11). The worker gets what it was evaluated with instead: the tuned
      // instructions for this job, plus the time.
      const now = `Now: ${clock()} (Europe/London). ${dateLine()}`;
      // Only a plain answer is handed over as a draft. "ask" goes to the worker with the job's
      // instructions (the 4B asked for times it could have read, 2026-10-12), and a request to change
      // his day is always work, whatever the front desk thought.
      if (run.settled.move === "answer" && run.settled.answer && !CHANGE_REQUEST.test(run.message)) {
        return { systemPrompt: `${LOCAL_IDENTITY}\n\n${now}\n\nThe front desk drafted this reply: "${run.settled.answer}". If it is right for Nick's message, send exactly that (no tools); otherwise answer him briefly yourself.` };
      }
      const askNote = run.settled.move === "ask" && run.settled.answer
        ? `\n\nThe front desk thought you might need to ask: "${run.settled.answer}". Ask only if no tool can tell you; otherwise do the job.` : "";
      return { systemPrompt: `${instructionsFor(run.settled, run.message)}\n\n${PRODUCTION_NOTES}\n\n${now}${askNote}` };
    });
  }

  api.on("after_tool_call", (event, ctx) => {
    const run = runFor(event, ctx);
    const toolName = pick(event, ctx, "toolName");
    if (!run || !toolName) return;
    run.tools.push({ canonical: canonicalCall(toolName, event.params), stdout: resultText(event.result ?? event.output), exit: null });
  });

  api.on("before_agent_finalize", async (event, ctx) => {
    const runId = pick(event, ctx, "runId") ?? "";
    const run = runFor(event, ctx);
    traceLine("before_agent_finalize", event, ctx, { found: !!run });
    if (!run) return undefined;
    const done = () => { runs.delete(runId); runs.delete(`session:${pick(event, ctx, "sessionKey") ?? ""}`); };
    try {
      const reply = str(event.lastAssistantMessage) ?? "";
      const findings = checkWork({ reply, turnResults: run.tools, finished: reply.trim().length > 0 });
      run.findings.push(findings);
      if (on && findings.length > 0 && run.passes < 2) {
        run.passes += 1;
        const instruction = run.passes === 1 ? retryInstruction(findings) : HONEST_STOP;
        return { action: "revise", reason: `work check: ${findings.join(", ")}`, retry: { instruction, idempotencyKey: `${runId}:work-check:${run.passes}`, maxAttempts: 1 } };
      }
      const decision = run.settled ?? (await settle(run));
      log({ runId, message: run.message, decision, model: str(event.model) ?? null, tools: run.tools.length, findings: run.findings, passes: run.passes,
        ...(on ? { escalationNeeded: findings.length > 0 } : {}), turnMs: Date.now() - run.started });
      done();
    } catch (error) {
      api.logger?.warn?.(`[orion-control] local routing finalize failed: ${error instanceof Error ? error.message : String(error)}`);
      done();
    }
    return undefined;
  });
}
