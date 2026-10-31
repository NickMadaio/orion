/**
 * Computer use from the local chat route (2026-10-30): observe -> act -> verify on the real screen.
 *
 * Before this, every computer-use turn on the local route got "I can't click buttons / can't see your screen":
 * the 9B's slim prompt never offered the tools, and the catalog's screen_click/type/key need a human-approved
 * exact-args hash per action. This is a code-built flow like the route's others. It claims a turn only when
 * computer-intent.ts reads a computer task in Nick's own words, runs the deterministic recipes in
 * computer-recipes.ts against OrionMacBridge (AX actions first), and replies with what really happened.
 *
 * Authorization: computer-auth.ts (his explicit request is the permission for its reversible steps; irreversible
 * and unnamed stops and asks; his "yes" to that question resumes from that step). Taint: screen text is matched
 * against his words and never adds a step.
 *
 * Wiring (orchestrator): call `maybeRunComputerTask({ message: run.message, sessionKey }, deps)` with
 * `enabled.control` = the `computer_control` tier being on (enableComputerControlActions + external_connected),
 * and use `reply` as the turn's reply when it returns non-null.
 */
import { BridgeFailure, type ComputerBridge } from "./computer-bridge.js";
import { isNo, isYes } from "./computer-auth.js";
import { detectComputerIntent, type ComputerIntent } from "./computer-intent.js";
import { failureReply, plainScreenReply, readScreen, screenPrompt } from "./computer-read.js";
import {
  StepCap, closeTabs, closeWindow, focusWindow, frontFor, menu, newDoc, openApp, press, readBack, scroll, typeText,
  type Ctx, type Outcome, type StepLog,
} from "./computer-recipes.js";

export type { StepLog } from "./computer-recipes.js";

export type ComputerTurn = { readonly message: string; readonly sessionKey?: string };

export type ComputerDeps = {
  readonly bridge: ComputerBridge;
  /** The computer_observe / computer_control tiers as configured. Off means an honest line and no bridge call. */
  readonly enabled: { readonly observe: boolean; readonly control: boolean };
  /** One short line per step for voice ("opening TextEdit"); wire to turn-progress. */
  readonly progress?: (line: string) => void;
  /** The worker picks among tied candidates BY NUMBER (1-based); anything else is ignored. */
  readonly pick?: (want: string, lines: string[]) => Promise<number | null>;
  /** The worker answers a screen question from screenPrompt(); no tools. */
  readonly summarize?: (prompt: string) => Promise<string>;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly maxSteps?: number;
  readonly pending?: Map<string, Pending>;
};

export type ComputerResult = { readonly handled: true; readonly reply: string; readonly steps: readonly StepLog[] };

type ActIntent = Extract<ComputerIntent, { kind: "act" }>;
export type Pending = { readonly intent: ActIntent; readonly clauseIndex: number; readonly confirmKey: string; readonly at: number };

export const MAX_STEPS = 12;
const PENDING_MS = 5 * 60_000;
const PENDING = new Map<string, Pending>();

export function resetComputerPending(): void { PENDING.clear(); }

const CONTROL_OFF = "I'm not allowed to control the screen yet: screen control is switched off in my settings.";
const OBSERVE_OFF = "I'm not allowed to read the screen yet: screen reading is switched off in my settings.";

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}


function compose(done: readonly string[], end: Outcome | { status: "stopped"; max: number } | null): string {
  if (!end || end.status === "ok") return `Done: ${list(done)}.`;
  if (end.status === "ask") return done.length ? `I ${list(done)}. ${end.ask}` : end.ask;
  if (end.status === "stopped") return `${done.length ? `I ${list(done)}, then ` : "I "}stopped after ${end.max} steps, which is my limit for one request. Tell me to carry on if you want the rest.`;
  return done.length ? `I ${list(done)}, but I ${end.why}.` : `I ${end.why}.`;
}

async function runClause(ctx: Ctx, intent: ActIntent, index: number): Promise<Outcome> {
  const clause = intent.clauses[index]!;
  if (clause.kind === "open") return openApp(ctx, clause.app);
  const front = await frontFor(ctx);
  if ("status" in front) return front;
  switch (clause.kind) {
    case "new_doc": return newDoc(ctx, clause, front);
    case "type": return typeText(ctx, clause, front);
    case "click": return press(ctx, clause, front, index);
    case "menu": return menu(ctx, clause, front, index);
    case "close_tabs": return closeTabs(ctx, clause, front, index);
    case "close_window": return closeWindow(ctx, clause, front, index);
    case "focus": return focusWindow(ctx, clause, front);
    case "scroll": return scroll(ctx, clause, front);
    case "read_back": return readBack(ctx, front);
  }
}

async function runAct(intent: ActIntent, deps: ComputerDeps, from: number, confirmed: ReadonlySet<string>, sessionKey?: string): Promise<ComputerResult> {
  const maxSteps = deps.maxSteps ?? MAX_STEPS;
  const ctx: Ctx = {
    bridge: deps.bridge, words: intent.text, ...(intent.app ? { app: intent.app } : {}), maxSteps,
    sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    progress: (line) => { try { deps.progress?.(line); } catch { /* progress is a courtesy */ } },
    ...(deps.pick ? { pick: deps.pick } : {}),
    confirmed, state: { used: 0, log: [] },
  };
  const done: string[] = [];
  const finish = (end: Parameters<typeof compose>[1]): ComputerResult => ({ handled: true, reply: compose(done, end), steps: ctx.state.log });
  for (let i = from; i < intent.clauses.length; i += 1) {
    let outcome: Outcome;
    try {
      outcome = await runClause(ctx, intent, i);
    } catch (error) {
      if (error instanceof StepCap) { if (error.partial) done.push(error.partial); return finish({ status: "stopped", max: maxSteps }); }
      if (error instanceof BridgeFailure) return { handled: true, reply: (done.length ? `I ${list(done)}, then stopped. ` : "") + failureReply(error, "control"), steps: ctx.state.log };
      throw error;
    }
    if (outcome.status === "ok") { done.push(outcome.said); continue; }
    if (outcome.status === "ask" && outcome.confirmKey && sessionKey) {
      (deps.pending ?? PENDING).set(sessionKey, { intent, clauseIndex: i, confirmKey: outcome.confirmKey, at: deps.now?.() ?? Date.now() });
    }
    return finish(outcome);
  }
  return finish(null);
}

async function runRead(intent: Extract<ComputerIntent, { kind: "read" }>, deps: ComputerDeps): Promise<ComputerResult> {
  if (!deps.enabled.observe) return { handled: true, reply: OBSERVE_OFF, steps: [] };
  try {
    deps.progress?.("looking at your screen");
    const observation = await deps.bridge.observe();
    const data = await readScreen(deps.bridge, observation);
    const steps: StepLog[] = [{ n: 1, action: "observe", target: observation.appName, via: "observe", ok: true, verified: true, note: `${data.lines.length} lines via ${data.source}` }];
    if (deps.summarize && data.lines.length > 0) {
      const answer = (await deps.summarize(screenPrompt(intent.question, data)).catch(() => "")).trim();
      if (answer) return { handled: true, reply: answer, steps };
    }
    return { handled: true, reply: plainScreenReply(data), steps };
  } catch (error) {
    return { handled: true, reply: failureReply(error, "see"), steps: [] };
  }
}

/**
 * The one entry point. Null means "not a computer task": the route carries on as before. `turn.message` must be
 * Nick's own live turn; it is the only text that can authorise anything.
 */
export async function maybeRunComputerTask(turn: ComputerTurn, deps: ComputerDeps): Promise<ComputerResult | null> {
  const store = deps.pending ?? PENDING;
  const key = turn.sessionKey;
  const pending = key ? store.get(key) : undefined;
  if (key && pending) {
    store.delete(key);
    const fresh = (deps.now?.() ?? Date.now()) - pending.at < PENDING_MS;
    if (fresh && isYes(turn.message)) {
      if (!deps.enabled.control) return { handled: true, reply: CONTROL_OFF, steps: [] };
      return runAct(pending.intent, deps, pending.clauseIndex, new Set([pending.confirmKey]), key);
    }
    if (fresh && isNo(turn.message)) return { handled: true, reply: "Okay, I left it as it is.", steps: [] };
  }
  const intent = detectComputerIntent(turn.message);
  if (!intent) return null;
  if (intent.kind === "read") return runRead(intent, deps);
  if (!deps.enabled.control) return { handled: true, reply: CONTROL_OFF, steps: [] };
  return runAct(intent, deps, 0, new Set(), key);
}

