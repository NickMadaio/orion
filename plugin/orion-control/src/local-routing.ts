/*
 Local routing (V3): front desk → worker → check → retry → escalate.

 This file wires the pieces into OpenClaw's hooks. Today it implements SHADOW mode only:
 on every real turn it asks the front desk what it would have done and runs the work check on the
 answer ORION actually gave, then appends both to a private log. It never overrides the model,
 never replies, never revises — the turn is exactly what it would have been without it. Shadow
 data is how the V3 results get confirmed on Nick's real traffic before anything is switched on
 (docs/planning/v3/ORION_V3_IMPLEMENTATION_PLAN.md, step 4).

 "on" mode (model override, front-desk replies, check-driven retry, escalation) is not built yet;
 asking for it logs a warning and runs shadow. (Written by Claude on 2026-10-10.)
*/
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { decide, type Decision } from "./front-desk.js";
import { checkWork, type ToolResult } from "./work-check.js";

export type LocalRoutingMode = "off" | "shadow" | "on";
type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
type HookApi = { on: (name: string, fn: Handler) => unknown; logger?: { warn?: (m: string) => void } };

export type LocalRoutingOptions = {
  mode: LocalRoutingMode;
  logPath: string;
  decideImpl?: (input: { message: string; clock: string }) => Promise<Decision>;
  clock?: () => string;
  finalizeWaitMs?: number;
};

const INTERNAL = /\b(?:cron|heartbeat|doctor|test|subagent|eval)\b/i;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const pick = (event: Record<string, unknown>, ctx: Record<string, unknown>, key: string) => str(event[key]) ?? str(ctx[key]);

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

export function registerLocalRouting(api: HookApi, options: LocalRoutingOptions): void {
  if (options.mode === "off") return;
  if (options.mode === "on") api.logger?.warn?.("[orion-control] localRouting 'on' is not built yet; running shadow");
  const { logPath, decideImpl = (input) => decide(input), clock = () => localClock(), finalizeWaitMs = 5000 } = options;
  const runs = new Map<string, { message: string; decision: Promise<Decision | { error: string }>; tools: ToolResult[]; started: number }>();
  const log = (entry: Record<string, unknown>) => {
    try {
      mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });
      appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), mode: "shadow", ...entry })}\n`, { mode: 0o600 });
    } catch (error) {
      api.logger?.warn?.(`[orion-control] local routing log failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  api.on("before_model_resolve", (event, ctx) => {
    const runId = pick(event, ctx, "runId");
    const sessionKey = pick(event, ctx, "sessionKey") ?? "";
    const message = str(event.prompt);
    if (!runId || !message || INTERNAL.test(sessionKey)) return undefined;
    // Fire and forget: shadow mode must not add the front desk's latency to the real turn.
    const decision = Promise.resolve()
      .then(() => decideImpl({ message, clock: clock() }))
      .catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
    runs.set(runId, { message, decision, tools: [], started: Date.now() });
    return undefined;
  });

  api.on("after_tool_call", (event, ctx) => {
    const run = runs.get(pick(event, ctx, "runId") ?? "");
    const toolName = pick(event, ctx, "toolName");
    if (!run || !toolName) return;
    run.tools.push({ canonical: canonicalCall(toolName, event.params), stdout: resultText(event.result ?? event.output), exit: null });
  });

  api.on("before_agent_finalize", async (event, ctx) => {
    const runId = pick(event, ctx, "runId") ?? "";
    const run = runs.get(runId);
    if (!run) return undefined;
    runs.delete(runId);
    try {
      const timeout = new Promise<{ error: string }>((resolve) => setTimeout(() => resolve({ error: "front desk still running" }), finalizeWaitMs));
      const decision = await Promise.race([run.decision, timeout]);
      const reply = str(event.lastAssistantMessage) ?? "";
      const findings = checkWork({ reply, turnResults: run.tools, finished: reply.trim().length > 0 });
      log({ runId, message: run.message, decision, model: str(event.model) ?? null, tools: run.tools.length, findings, turnMs: Date.now() - run.started });
    } catch (error) {
      api.logger?.warn?.(`[orion-control] local routing shadow failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return undefined;
  });
}
