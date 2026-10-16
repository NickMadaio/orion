/*
 Tool-call guards for the local worker (round 8b, "tools", 2026-10-16).

 45 of 76 real tool results in the sweep were errors, almost all of them one of a few shapes the code can
 fix before the host refuses them:
   - a bare `orion-agenda tomorrow` (allowlisted by absolute path only): rewritten to the absolute path;
   - an invented subcommand (`orion-agenda events`, `--date X`): mapped to `day <when>`;
   - an invented tool id through `tool_call` (`calendar_event_add`, `orion-agenda`): a catalog action is
     rewritten to an orion_task_run step, anything else is blocked with where to go;
   - args sent as a JSON string ("args: must be object");
   - runs that varied their calls until the ~300 s model timeout, never answering: a per-run budget.

 Results follow the before_tool_call contract: `{block, blockReason}` wins, `{params}` is shallow-merged
 over the call by the runner, and later hooks (guardTaskRun, the undo guard) see the merged params.
 Exec handling stays argv-safe: a command is only ever rewritten in its first word, and never when the rest
 holds a live shell operator.
*/
import { readdirSync } from "node:fs";
import { ACTION_CATALOG } from "./catalog.js";
import { OPERATOR_REASON, TYPED_ACTIONS, TOOL_IDS } from "./exec-routing.js";
import { hasShellOperator } from "./shell-operators.js";
import { TASK_RUN_ID } from "./task-run-wiring.js";

export { hasShellOperator };

export const SCRIPTS_DIR = "/Users/nickmadaio/Desktop/ORION/scripts";

export interface GuardDeps {
  /** Names of the files in scripts/ (injected in tests). */
  scriptNames: () => readonly string[];
}

const liveDeps: GuardDeps = {
  scriptNames: () => {
    try { return readdirSync(SCRIPTS_DIR); } catch { return []; }
  },
};

export type GuardResult = { block: true; blockReason: string } | { params: Record<string, unknown> } | undefined;
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const block = (blockReason: string): GuardResult => ({ block: true, blockReason });

const BARE_ORION = /^orion-[a-z0-9-]+$/;
const AGENDA_USAGE =
  "orion-agenda reads only: `today`, `upcoming`, `tasks`, or `day <when>` (<when> is a date like 2026-10-17, a weekday, `today` or `tomorrow`). There is no --help, `events` or --date.";
const WHEN = /^(today|tomorrow|mon(day)?|tue(sday)?|wed(nesday)?|thu(rsday)?|fri(day)?|sat(urday)?|sun(day)?|\d{4}-\d{2}-\d{2})$/i;
const PLAIN_TOKEN = /^[\w.:=-]+$/; // "=" allowed so `--date=friday` is read (review 5 LOW, 2026-10-16)

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j] as number;
      row[j] = Math.min(tmp + 1, (row[j - 1] as number) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length] as number;
}

function closeNames(name: string, all: readonly string[]): string[] {
  return all
    .filter((n) => BARE_ORION.test(n))
    .map((n) => ({ n, d: n.includes(name) || name.includes(n) ? 0 : distance(name, n) }))
    .filter((x) => x.d <= 3)
    .sort((x, y) => x.d - y.d || x.n.localeCompare(y.n))
    .slice(0, 4)
    .map((x) => x.n);
}

/** `orion-agenda` misuse seen live (324425f4): events, --date X, day --date X, --help. */
function fixAgendaArgs(rest: string): { rest: string } | { blockReason: string } | undefined {
  const tokens = rest.trim() === "" ? [] : rest.trim().split(/\s+/);
  if (!tokens.every((t) => PLAIN_TOKEN.test(t))) return undefined;
  const first = tokens[0];
  if (first === undefined) return undefined;
  if (/^(--help|-h|help)$/i.test(first)) return { blockReason: AGENDA_USAGE };
  const dateOf = (list: string[]): string | undefined => {
    if (list[0]?.startsWith("--date=")) return list[0].slice(7);
    return list[0] === "--date" ? list[1] : undefined;
  };
  let when: string | undefined;
  if (first === "events") when = tokens[1] ?? "today";
  else if (first === "day") when = dateOf(tokens.slice(1));
  else when = dateOf(tokens);
  if (when === undefined || !WHEN.test(when)) return undefined;
  const next = `day ${when}`;
  return next === rest.trim() ? undefined : { rest: next };
}

function guardExec(toolName: string, params: Rec, deps: GuardDeps): GuardResult {
  const key = (["command", "cmd", "script"] as const).find((k) => typeof params[k] === "string");
  if (!key) return undefined;
  const trimmed = (params[key] as string).trim();
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!m) return undefined;
  // review 5 LOW (2026-10-16): `~/Desktop/ORION/scripts/orion-agenda` is the same file as the absolute path.
  const head = (m[1] as string).replace(/^~\/Desktop\/ORION\/scripts\//, `${SCRIPTS_DIR}/`);
  let rest = m[2] ?? "";
  let abs = head;
  let name = head.startsWith(`${SCRIPTS_DIR}/`) ? head.slice(SCRIPTS_DIR.length + 1) : undefined;

  if (BARE_ORION.test(head)) {
    const all = deps.scriptNames();
    if (!all.includes(head)) {
      const close = closeNames(head, all);
      return block(
        `\`${head}\` is not a program in ORION's scripts folder.` +
          (close.length ? ` Close real names: ${close.join(", ")}.` : "") +
          ` Real ones run by absolute path, e.g. ${SCRIPTS_DIR}/orion-agenda today.`,
      );
    }
    if (hasShellOperator(rest)) return block(OPERATOR_REASON);
    // The scheduler's writes belong to the schedule flow and its guards, so the bare name is only a read.
    if (head === "orion-reschedule" && !/^show(\s|$)/.test(rest)) {
      return block(
        "Do not run orion-reschedule yourself to change the calendar. Describe the change in words to Nick " +
          "(for example: say what you would move and ask him to confirm), and ORION's scheduler makes it.",
      );
    }
    abs = `${SCRIPTS_DIR}/${head}`;
    name = head;
  }
  if (name === "orion-agenda" && !hasShellOperator(rest)) {
    const fix = fixAgendaArgs(rest);
    if (fix && "blockReason" in fix) return block(fix.blockReason);
    if (fix) rest = fix.rest;
  }
  const next = rest === "" ? abs : `${abs} ${rest}`;
  if (next === trimmed) return undefined;
  void toolName;
  return { params: { ...params, [key]: next } };
}

const parseArgs = (raw: unknown): Rec | undefined | "bad" => {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (isRec(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const v: unknown = JSON.parse(raw);
      return isRec(v) ? v : "bad";
    } catch { return "bad"; }
  }
  return "bad";
};

function guardToolCallWrapper(params: Rec, deps: GuardDeps): GuardResult {
  const id = typeof params.id === "string" ? params.id.trim() : "";
  if (id === "") return undefined;
  const args = parseArgs(params.args);
  const catalog = Object.prototype.hasOwnProperty.call(ACTION_CATALOG, id) || TYPED_ACTIONS.test(id);
  if (catalog) {
    if (args === "bad") return block(`args for ${id} must be a JSON object, for example {"title":"…"}.`);
    return { params: { ...params, id: TASK_RUN_ID, args: { steps: [{ action: id, ...(args ?? {}) }] } } };
  }
  if (BARE_ORION.test(id)) {
    const real = deps.scriptNames().includes(id);
    return block(
      real
        ? `\`${id}\` is a program, not a tool id. Run it with exec: ${SCRIPTS_DIR}/${id} <arguments> (by absolute path).`
        : `\`${id}\` is not a tool id or a known program. Programs run with exec by absolute path under ${SCRIPTS_DIR}/ (for example orion-agenda today).`,
    );
  }
  // review 5 M2 (2026-10-16): everything else is the host's to resolve (brain__*, code_execution, x_search, heartbeat_respond,
  // music_generate, … are real, and its own "Unknown tool id" handles the rest). Only repair args that arrived as a JSON string.
  if (typeof params.args === "string" && args !== "bad" && args !== undefined) return { params: { ...params, args } };
  return undefined;
}

/** The before_tool_call guards for exec and the tool_call wrapper. Undefined means "no opinion". */
export function guardToolCall(toolName: string, params: unknown, deps: GuardDeps = liveDeps): GuardResult {
  if (!isRec(params)) return undefined;
  if (toolName === "exec" || toolName === "shell" || toolName === "bash") return guardExec(toolName, params, deps);
  if (toolName === "tool_call") return guardToolCallWrapper(params, deps);
  return undefined;
}

/**
 * Tool calls one run may make before it must answer. Runs that kept varying their calls (the repeat guard
 * only catches identical ones) hit the ~300 s ollama timeout with no reply at all (324425f4, a4488a26,
 * 50d66cdf, 2026-10-16). Eight is more than any real turn in the sweep needed.
 */
export const TOOL_BUDGET = 8;
const MAX_RUNS = 64;

export class ToolBudget {
  private readonly runs = new Map<string, Set<string>>();
  private anon = 0;

  /** Counts one call (once per toolCallId) and returns a block when the run is over budget. */
  take(runKey: string, toolCallId?: string): { block: true; blockReason: string } | undefined {
    // review 5 M3 (2026-10-16): a tool_call wrapper fires before_tool_call twice (the wrapper, then the inner call under its
    // own `tool_search_code:…` id); only the wrapper is charged, so one call counts once.
    if (toolCallId?.startsWith("tool_search_code:")) return undefined;
    const seen = this.runs.get(runKey) ?? new Set<string>();
    const idKey = toolCallId ?? `anon:${this.anon++}`;
    if (!seen.has(idKey)) {
      if (seen.size >= TOOL_BUDGET) {
        return {
          block: true,
          blockReason:
            "Tool budget reached: stop calling tools and reply to Nick now in one or two sentences with what you found and what you could not finish.",
        };
      }
      seen.add(idKey);
    }
    this.runs.set(runKey, seen);
    if (this.runs.size > MAX_RUNS) {
      const oldest = this.runs.keys().next().value;
      if (typeof oldest === "string" && oldest !== runKey) this.runs.delete(oldest);
    }
    return undefined;
  }

  end(runKey: string): void { this.runs.delete(runKey); }
  size(): number { return this.runs.size; }
}
