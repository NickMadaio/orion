/*
 The turn harness: one of Nick's messages through the REAL routing (registerLocalRouting, every hook in order) with every model
 and every script replaced by a recorder. What comes out is what he would have heard and which handler produced it. Nothing here
 reads or writes his real state: ORION_CONTROLLED_DIR points at a temp directory for the whole run, and the clock is pinned the
 same way the evaluation sandbox pins it (an eval-mode marker plus a fresh eval-calendar.json in that temp directory).
*/
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerLocalRouting } from "../local-routing.js";
import { resetClockCache } from "../plugin-clock.js";
import { runScheduleFlow, type Day } from "../schedule-flow.js";
import { runWakeFlow } from "../wake-flow.js";
import type { Decision } from "../front-desk.js";
import type { Outcome, PriorTurn, Recorded, RecordedScript, ReplayCase, ScriptCall } from "./types.js";

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
type RunResult = { stdout: string; code: number };

/** The Mac app's wrapper for a spoken turn, word for word (cslab-incident-2026-10-19.test.ts), then the phone's channel brief. */
const APP_CONTEXT = `[Orion app context — factual state supplied by the native app]
Focus session: inactive.
Firm enforcement: not active.
Temporary allowed work apps: none established.
Treat the session status and allowed apps as current operating context. Do not claim an app is blocked, hidden, or quit unless a tool confirms it.
Nick SAID this out loud and your answer will be SPOKEN: one to three short sentences, no lists, no markdown, times as "8:15 PM". Offer detail only if he asks.

User message:
`;
const PHONE_BRIEF = "You are answering over the phone. Reply in one to three short sentences.\n--- Nick's message follows ---\n";

const DEFAULT_NOW = "2026-11-04T19:44";
const ESCAPED_CALENDAR = "eval-calendar.json";

/** Builds the pinned sandbox clock files in `dir`. */
function pinClock(dir: string, nowIso: string): void {
  const at = new Date(nowIso);
  const marker = join(dir, "eval-mode");
  const calendar = join(dir, ESCAPED_CALENDAR);
  writeFileSync(marker, "replay\n");
  writeFileSync(calendar, JSON.stringify({ now: at.toISOString(), events: [], reminders: [] }));
  const fresh = new Date();
  for (const f of [marker, calendar]) utimesSync(f, fresh, fresh);
  resetClockCache();
}

const NOT_RECORDED = "NOTHING WAS CHANGED: nothing was recorded for this call.";
const clock = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const minutesOf = (t: string) => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };

/** What the scheduler prints for a change that fits, built from the arguments (a refusal is only ever RECORDED, never invented). */
export function planned(args: string[]): string | undefined {
  const [verb, title = "block", third] = args;
  const at = args.indexOf("--at") >= 0 ? args[args.indexOf("--at") + 1] : undefined;
  const header = "Changed Wednesday 2026-11-04:";
  switch (verb) {
    case "add": { const m = Number(third) || 30; const start = at ?? "20:00"; return `planned ${title}: ${start}–${clock(minutesOf(start) + m)} (${m} min)\n${header}\n  added ${title}`; }
    case "move": { const start = at ?? args[args.indexOf("--to") + 1] ?? "19:00"; return `${title} moved: 18:00 → ${start}–${clock(minutesOf(start) + 60)}\n${header}`; }
    case "late": return `Pushed everything not yet done back ${title} min\n${header}`;
    case "skip": return `skipped ${title} today\n${header}`;
    case "drop": case "clear": return `removed ${title}\n${header}`;
    case "log": return `Logged ${title}\n${header}`;
    default: return undefined;
  }
}

const matchScript = (scripts: readonly RecordedScript[] | undefined, args: string[], synth = false): RunResult => {
  const line = args.join(" ");
  const hit = scripts?.find((s) => line.includes(s.match));
  if (hit) return { stdout: hit.stdout, code: hit.code ?? 0 };
  const made = synth ? planned(args.filter((a) => a !== "--dry-run")) : undefined;
  return made ? { stdout: made, code: 0 } : { stdout: NOT_RECORDED, code: 1 };
};

/** A session of turns in one chat: per-chat memory (repeats, pending questions, undo) lives as long as the Session. */
export class Session {
  readonly dir = mkdtempSync(join(tmpdir(), "orion-replay-"));
  readonly scripts: ScriptCall[] = [];
  private readonly handlers = new Map<string, Handler[]>();
  private recorded: Recorded = {};
  private clock: number;
  private n = 0;
  private readonly previousDir = process.env.ORION_CONTROLLED_DIR;
  private closed = false;

  constructor(nowIso: string = DEFAULT_NOW, readonly surface: "mac" | "phone" = "mac", private readonly spoken = false, seed: Record<string, unknown> = {}) {
    this.clock = new Date(nowIso).getTime();
    mkdirSync(this.dir, { recursive: true });
    process.env.ORION_CONTROLLED_DIR = this.dir;
    writeFileSync(join(this.dir, "health-log.json"), JSON.stringify({ schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [] }));
    for (const [name, value] of Object.entries(seed)) writeFileSync(join(this.dir, name), JSON.stringify(value));
    pinClock(this.dir, nowIso);
    const api = { on: (name: string, fn: Handler) => this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]) };
    registerLocalRouting(api, this.options() as never);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.previousDir === undefined) delete process.env.ORION_CONTROLLED_DIR; else process.env.ORION_CONTROLLED_DIR = this.previousDir;
    resetClockCache();
    rmSync(this.dir, { recursive: true, force: true });
  }

  private fire = async (name: string, event: Record<string, unknown>, ctx: Record<string, unknown>): Promise<unknown[]> => {
    const out: unknown[] = [];
    for (const fn of this.handlers.get(name) ?? []) out.push(await fn(event, ctx));
    return out;
  };

  private recorder = (script: string) => async (args: string[]): Promise<RunResult> => {
    this.scripts.push({ script, args });
    const hit = matchScript(this.recorded.scripts, args);
    // A script nothing was recorded for answers as a tidy JSON refusal, so a route that parses JSON never throws.
    return hit.code !== 0 && hit.stdout === NOT_RECORDED ? { stdout: JSON.stringify({ ok: false, error: "not recorded" }), code: 1 } : hit;
  };

  private day = (): Day | undefined => this.recorded.day;

  private options() {
    const rec = this.recorder;
    const execReschedule = async (args: string[]): Promise<RunResult> => {
      this.scripts.push({ script: "orion-reschedule", args });
      if (args[0] === "show") return { stdout: JSON.stringify(this.day() ?? { date: "2026-11-04", now: null, blocks: [] }), code: 0 };
      return matchScript(this.recorded.scripts, args, true);
    };
    const formQueue = () => [...(this.recorded.form ?? [])];
    let queue: ReturnType<typeof formQueue> = [];
    const wakeExec = async (args: string[]): Promise<RunResult> => { this.scripts.push({ script: "orion-wake", args }); return matchScript(this.recorded.scripts, args); };
    return {
      warm: false, mode: "on", logPath: join(this.dir, "local-routing", "shadow.jsonl"), progressDir: join(this.dir, "turn-progress"), stateDir: this.dir,
      finalizeWaitMs: 50, now: () => new Date(this.clock), clock: () => "Wed 19:44",
      decideImpl: async (): Promise<Decision> => this.recorded.desk ?? { move: "escalate", tier: "standard", say: "One moment." },
      brainSearch: async () => "",
      scheduleFlow: (message: string, clock: string, opts: Record<string, unknown> = {}) => {
        if (!queue.length) queue = formQueue();
        return runScheduleFlow({
          message, clock, now: new Date(this.clock), exec: async (args: string[]) => execReschedule(args), undoTop: () => null,
          ask: async () => (queue.length ? queue.shift() ?? null : null),
          ...(opts.askContext ? { askContext: opts.askContext as never } : {}), ...(opts.pending ? { pending: opts.pending as never } : {}), ...(opts.undo ? { undo: opts.undo as string[] } : {}),
          ...(opts.replanContext ? { replanContext: opts.replanContext as never } : {}), ...(opts.lastTarget ? { lastTarget: opts.lastTarget as never } : {}), ...(opts.edit ? { edit: opts.edit as never } : {}),
          ...(opts.lengthDefaulted ? { lengthDefaulted: true } : {}),
        });
      },
      readDayJson: async () => this.day(), readDeadlines: async () => ({ events: [], tasks: [] }), listReminders: async () => [], readDay: async () => "",
      realityRun: async (script: string, args: string[]) => { this.scripts.push({ script, args }); return matchScript(this.recorded.scripts, args, script === "orion-reschedule"); },
      lateFlow: async (minutes: number) => { const r = await execReschedule(["late", String(minutes)]); return { outcome: "say" as const, kind: "plain" as const, text: r.stdout.trim().split("\n").at(-1) ?? "", calls: [`exec orion-reschedule late ${minutes}`], outputs: [r.stdout] }; },
      wakeFlow: (message: string, decision?: Decision) => runWakeFlow({ message, ...(decision ? { decision } : {}), now: new Date(this.clock), exec: wakeExec }),
      workoutRun: rec("orion-workout"), foodRun: rec("orion-food-estimate"), mouseRun: rec("orion-mouse"), appsRun: rec("orion-apps"), shutdownRun: rec("orion-bedtime-shutdown"),
      sessionExec: rec("orion-session"), phoneTimeRun: rec("orion-phone-time"), sleepPlanRun: rec("orion-sleepplan"), rememberRun: rec("orion-remember"),
      mailPrefsRun: rec("orion-mail-prefs"), questionsRun: rec("orion-questions"), checkinRun: rec("orion-checkin"), wakeExec,
      selffixRun: async (script: string, args: string[]) => { this.scripts.push({ script, args }); return matchScript(this.recorded.scripts, args); },
      knowledgeRun: async (script: string, args: string[]) => { this.scripts.push({ script, args }); return matchScript(this.recorded.scripts, args); },
    };
  }

  /** One message through every hook, then the worker's recorded reply through the finalize check (and its retries). */
  async turn(say: string, recorded: Recorded = {}, advanceMs = 45_000, outreach?: string): Promise<Outcome> {
    this.recorded = recorded;
    this.clock += advanceMs;
    pinClock(this.dir, new Date(this.clock).toISOString().slice(0, 19));
    const before = this.scripts.length;
    const started = Date.now();
    const ctx = { runId: `r${(this.n += 1)}`, sessionKey: this.surface === "phone" ? "agent:main:orion-chat-phone" : "agent:main:orion-app-v2" };
    const asked = outreach ? `[ORION context: 1 min ago you asked "${outreach}" (info)]\n\n` : "";
    const prompt = this.spoken ? `${asked}${APP_CONTEXT}${say}` : this.surface === "phone" ? `${asked}${PHONE_BRIEF}${say}` : `${asked}${say}`;
    await this.fire("before_model_resolve", { prompt }, ctx);
    const [direct] = (await this.fire("before_agent_reply", { cleanedBody: say }, ctx)) as Array<{ reply?: { text?: string } } | undefined>;
    const built = (await this.fire("before_prompt_build", { prompt, messages: [] }, ctx)) as Array<{ systemPrompt?: string } | undefined>;
    const workerPrompt = built.find((b) => b?.systemPrompt)?.systemPrompt;
    let reply = direct?.reply?.text ?? "";
    let revised = 0;
    if (!direct?.reply?.text) {
      const lines = Array.isArray(recorded.worker) ? recorded.worker : [recorded.worker ?? ""];
      const told = recorded.obey !== undefined ? /exactly these arguments[^\n]*:\n(\{[^\n]*\})/.exec(workerPrompt ?? "")?.[1] : undefined;
      const tools = [...(recorded.tools ?? []), ...(told ? [{ toolName: "tool_call", params: { id: "openclaw:orion-control:orion_task_run", args: JSON.parse(told) as Record<string, unknown> }, result: recorded.obey! }] : [])];
      for (const t of tools) {
        const gate = (await this.fire("before_tool_call", { toolName: t.toolName, params: t.params }, ctx)) as Array<{ block?: boolean } | undefined>;
        if (gate.some((g) => g?.block)) continue;
        this.scripts.push({ script: `tool:${t.toolName}`, args: [JSON.stringify(t.params)] });
        await this.fire("after_tool_call", { toolName: t.toolName, params: t.params, result: { content: [{ type: "text", text: t.result }] } }, ctx);
      }
      let text = lines[0] ?? "";
      for (let pass = 0; pass < 4; pass += 1) {
        const messages: Array<{ role: string; content: unknown }> = [{ role: "user", content: say }, { role: "assistant", content: [{ type: "text", text }] }];
        const [fin] = (await this.fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: text, messages, model: "qwen3.5:9b" }, ctx)) as Array<{ action?: string; retry?: { instruction?: string } } | undefined>;
        if (fin?.action === "revise") {
          revised += 1;
          // An obedient worker: it writes exactly the text it is told to, else the next recorded line, else repeats itself.
          const exact = /(?:exactly this text[^:]*|exactly)[^:]*:\s*([\s\S]+)$/i.exec(fin.retry?.instruction ?? "");
          text = exact?.[1]?.trim() ?? lines[revised] ?? text;
          continue;
        }
        const first = messages[1]!.content as Array<{ type?: string; text?: string }>;
        text = (Array.isArray(first) ? first.find((b) => b.type === "text")?.text : String(messages[1]!.content)) ?? text;
        break;
      }
      reply = text;
    }
    const rows = (() => { try { return readFileSync(join(this.dir, "local-routing", "shadow.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>); } catch { return []; } })();
    const row = rows.filter((r) => r.runId === ctx.runId).at(-1);
    const scripts = this.scripts.slice(before);
    const flow = row?.flow as Outcome["flow"] | undefined;
    const decision = row?.decision as Decision | undefined;
    const flowCalls = flow?.calls ?? [];
    return {
      route: routeOf(scripts, flow, decision, reply, Boolean(direct?.reply?.text)), reply, ...(decision ? { decision } : {}), ...(flow ? { flow } : {}), scripts, revised,
      calls: [...scripts.map((s) => `${s.script} ${s.args.join(" ")}`.trim()), ...flowCalls.filter((c) => !scripts.some((s) => c.includes(s.script) && c.includes(s.args.join(" ").slice(0, 20))))],
      ...(workerPrompt ? { workerPrompt: workerPrompt.slice(0, 4000) } : {}), ms: Date.now() - started,
    };
  }
}

/** The handler that took the turn, as one word: the first script that ran, else how the reply came about. */
function routeOf(scripts: ScriptCall[], flow: Outcome["flow"] | undefined, decision: Decision | undefined, reply: string, direct: boolean): string {
  const first = scripts[0]?.script;
  const named: Record<string, string> = { "orion-workout": "workout", "orion-food-estimate": "food", "orion-mouse": "mouse", "orion-apps": "apps", "orion-reschedule": "schedule", "orion-wake": "wake",
    "orion-bedtime-shutdown": "shutdown", "orion-session": "focus", "orion-phone-time": "phone-block", "orion-sleepplan": "sleep", "orion-remember": "remember", "orion-selfcheck": "selffix", "orion-selffix": "selffix",
    "orion-declare": "reality", "orion-checkin": "checkin", "orion-brain": "knowledge", "orion-trash": "knowledge", "orion-questions": "questions", "orion-mail-prefs": "mail" };
  if (/^\s*(?:…|\.{3})\s*$/.test(reply)) return "quiet";
  if (/^same problem as a moment ago/i.test(reply)) return "repeat-guard";
  if (first?.startsWith("tool:")) return `worker-tool:${first.slice(5)}`;
  if (first && named[first]) return named[first]!;
  if (flow && flow.outcome !== "fallback") return flow.calls?.some((c) => /orion-reschedule/.test(c)) ? "schedule" : "code-flow";
  if (direct) return "desk-answer";
  return decision?.move === "tool" ? `desk-tool:${decision.tool}` : "worker";
}

/** Runs one case's earlier turns, then the case itself, in one fresh session. */
export async function playCase(c: ReplayCase): Promise<Outcome> {
  const s = new Session(c.now ?? DEFAULT_NOW, c.surface ?? "mac", c.spoken ?? false, c.seed ?? {});
  try {
    for (const p of c.prior ?? ([] as PriorTurn[])) await s.turn(p.say, p.recorded ?? {}, 45_000, p.outreach);
    return await s.turn(c.say, c.recorded ?? {}, 45_000, c.outreach);
  } finally { s.close(); }
}
