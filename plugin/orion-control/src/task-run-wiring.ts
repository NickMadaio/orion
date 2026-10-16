/*
 How the local worker reaches orion_task_run (rerun of the live sweep, 2026-10-16).

 OpenClaw puts every plugin tool behind its compact tool-search surface ("tool-search: cataloged 33 tools
 behind compact prompt surface"). orion_task_run is NOT directly callable: the worker must call the
 `tool_call` wrapper with { id, args }. The code-built directives said "call orion_task_run", so the 9B
 called a tool that does not exist ("Tool orion_task_run not found", 20 items: q001 q007 q010 q032 q036
 q072 q074 r01 ...).

 Why the wrapper and not "keep orion_task_run visible": the host decides what stays direct (a fixed
 local-model-lean name list; shouldCatalogTool is unconditional) and a plugin has no flag for it
 (checked in openclaw dist tool-search-*.js, read only). The wrapper is also the form that already worked
 in the original sweep. The exact catalog id is used (a bare name also resolves, but an id cannot be
 ambiguous).

 Three jobs live here: the one sentence every directive uses; counting a call only when it really reached
 the tool (a "not found" or error result is NOT a call made); and, in before_tool_call, making the
 code-built arguments win when the worker's call for the same action drifted (r02: routing said 21:00,
 the worker's call said 09:00).
*/
export const TASK_RUN_ID = "openclaw:orion-control:orion_task_run";

/** The wrapper form the worker must use, with the exact arguments (a JSON object string). */
export const taskRunCall = (args: string): string =>
  `ONE call to the tool_call tool, with id "${TASK_RUN_ID}" and args set to exactly these arguments (orion_task_run itself is not directly callable, only through tool_call):\n${args}`;

/** The one-line instruction for the context and retry messages. */
export const taskRunNow = (args: string): string =>
  `call tool_call now with {"id":"${TASK_RUN_ID}","args":${args}} — do not reply before calling it.`;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const TASK_RUN_NAME = /(^|:)orion_task_run$/;

/** The orion_task_run arguments in a tool call: direct, or inside the tool_call wrapper. Otherwise null. */
export function taskRunArgs(toolName: string, params: unknown): { args: Rec; via: "direct" | "tool_call" } | null {
  if (!isRec(params)) return null;
  if (toolName === "orion_task_run") return { args: params, via: "direct" };
  if (toolName === "tool_call" && typeof params.id === "string" && TASK_RUN_NAME.test(params.id.trim())) {
    return { args: isRec(params.args) ? params.args : {}, via: "tool_call" };
  }
  return null;
}

/** Steps of a call, flat ({action, ...arguments}), however the worker wrote them (string, graph, nested arguments). */
export function stepsOf(args: Rec): Rec[] | null {
  let steps: unknown = args.steps ?? (isRec(args.graph) ? args.graph.steps : undefined);
  if (typeof steps === "string") { try { steps = JSON.parse(steps); } catch { return null; } }
  if (!Array.isArray(steps)) return null;
  return steps.filter(isRec).map((s) => {
    const { id: _id, arguments: nested, ...rest } = s;
    return { ...(isRec(nested) ? nested : {}), ...rest };
  });
}

const canon = (steps: Rec[]): string =>
  JSON.stringify(steps.map((s) => Object.keys(s).sort().map((k) => [k, String(typeof s[k] === "object" ? JSON.stringify(s[k]) : s[k])])));

export type Expected = { action: string; args: string };

/** A worker call to the directive's action whose arguments differ: the code-built ones win. */
export function guardTaskRun(toolName: string, params: unknown, expected: Expected): { params: Rec } | { block: true; blockReason: string } | undefined {
  const call = taskRunArgs(toolName, params);
  if (!call) return undefined;
  let want: Rec;
  try { want = JSON.parse(expected.args) as Rec; } catch { return undefined; }
  const wantSteps = stepsOf(want) ?? [];
  const actions = new Set(wantSteps.map((s) => String(s.action)));
  const got = stepsOf(call.args);
  if (!got || !got.some((s) => actions.has(String(s.action)))) return undefined;
  if (canon(got) === canon(wantSteps)) return undefined;
  if (call.via === "tool_call") return { params: { ...(params as Rec), args: want } };
  // A direct call may also carry a graph or other keys a merge would keep: refuse and restate instead.
  if (Object.keys(call.args).some((k) => k !== "steps")) {
    return { block: true, blockReason: `The arguments for this call are fixed. Call tool_call with {"id":"${TASK_RUN_ID}","args":${expected.args}} exactly.` };
  }
  return { params: { steps: want.steps } };
}

const NOT_REACHED = /\bnot found\b|unknown tool|unknown id|ambiguous tool|must be a non-empty|tool call blocked|blocked by plugin/i;

/** Whether a recorded call is a real orion_task_run call for this action: a "not found" or error result is not one. */
export function madeTaskRunCall(t: { canonical: string; stdout?: string }, action: string): boolean {
  if (!/^(orion_task_run|tool_call)\b/.test(t.canonical) || !t.canonical.includes(`"${action}"`)) return false;
  if (t.canonical.startsWith("tool_call") && !TASK_RUN_NAME.test(/"id":"([^"]*)"/.exec(t.canonical)?.[1] ?? "")) return false;
  const head = String(t.stdout ?? "").slice(0, 400);
  return !(NOT_REACHED.test(head) || /^\s*(error|tool error)\b/i.test(head));
}
