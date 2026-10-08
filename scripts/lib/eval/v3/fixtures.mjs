// Scripted tool results for V3 tool jobs (handoff §6 J2/J4, §7.1 T1/T2).
// T1 is ORION's production interface (exec of an allowlisted script, and
// orion_task_run typed actions); T2 is one function per menu tool, cleaner for
// small models (if it wins, production needs an adapter). Both reduce to one
// canonical call string so a case's expected calls — sets of patterns that must
// all match one call (BFCL-style subset matching) — grade either interface.
// Output strings copy the real scripts' (taken from Nick's logs, 2026-10-08).
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)
import { basename } from "node:path";

const asArgs = (a) => (typeof a === "string" ? (() => { try { return JSON.parse(a); } catch { return { _raw: a }; } })() : a ?? {});

/** One comparable string per call: "exec orion-lights off", "orion_task_run alarm_set {…}", 'lights {"do":"off"}'. */
export function canonicalCall({ name, args }) {
  const a = asArgs(args);
  if (name === "exec") {
    const cmd = String(a.command ?? "").trim();
    const [first, ...rest] = cmd.split(/\s+/);
    return `exec ${[basename(first ?? ""), ...rest].join(" ")}`.trim();
  }
  if (name === "orion_task_run") {
    const steps = a.steps ?? a.actions ?? (a.action ? [a] : []);
    return `orion_task_run ${steps.map((s) => `${s.action ?? s.name ?? "?"} ${JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k]) => k !== "action")))}`).join(" ; ")}`;
  }
  return `${name} ${JSON.stringify(a)}`;
}

const allMatch = (patterns, call) => patterns.every((p) => new RegExp(p, "i").test(call));

/** expected: [[pattern…]…] each must match some call; forbidden: none may match any call. */
export function callsMatch(expected, calls, forbidden = []) {
  const missing = expected.filter((patterns) => !calls.some((c) => allMatch(patterns, c)));
  const forbiddenHit = forbidden.filter((patterns) => calls.some((c) => allMatch(patterns, c)));
  return { ok: missing.length === 0 && forbiddenHit.length === 0, missing, forbiddenHit };
}

// Realistic answers for read-only calls a careful model may make first.
const DEFAULTS = [
  { match: ["orion-session", "status"], stdout: "no active focus session", exit: 0 },
  { match: ["orion-phone-time", "status"], stdout: "Locked — until 9:00 PM (bedtime).", exit: 0 },
  { match: ["orion-agenda"], stdout: "today is Friday, October 9, 2026\n  2:00 PM — CS lab\n  6:00 PM — Gym", exit: 0 },
  { match: ["agenda"], stdout: "today is Friday, October 9, 2026\n  2:00 PM — CS lab\n  6:00 PM — Gym", exit: 0 },
  { match: ["orion-help"], stdout: "Usage shown above in your instructions.", exit: 0 },
  { match: ["orion-lights", "status"], stdout: "Lights: on, 60%, warm", exit: 0 },
  { match: ["weather"], stdout: "executed=true status=succeeded outcome=DONE — this really happened reportToUser=London: 14°C now, high 16°C / low 9°C. Rain 3–5 PM (60%).", exit: null },
];

/** Executor for runAgent: the case's fixtures, then defaults, then "unknown command". */
export function fixtureExecutor(fixtures = []) {
  return async (call) => {
    const canonical = canonicalCall(call);
    const hit = [...fixtures, ...DEFAULTS].find((f) => allMatch(f.match, canonical));
    if (hit) return { canonical, stdout: hit.stdout, exit: hit.exit ?? 0 };
    return { canonical, stdout: `usage: that command or action is not available (${canonical.slice(0, 80)})`, exit: 2 };
  };
}

const T1 = [
  { type: "function", function: { name: "exec", description: "Run one of ORION's allowlisted scripts with plain arguments (no pipes, no &&). Example: orion-lights off",
    parameters: { type: "object", properties: { command: { type: "string", description: "the script and its arguments" } }, required: ["command"] } } },
  { type: "function", function: { name: "orion_task_run", description: "Run ORION catalog actions. steps: [{ action, ...arguments }]. Example: { steps: [{ action: \"alarm_set\", at: \"18:55\", label: \"call mom\" }] }",
    parameters: { type: "object", properties: { steps: { type: "array", items: { type: "object" } } }, required: ["steps"] } } },
];

/** Ollama tool schemas for interface T1 or T2 (T2 is built from the front-desk menu). */
export function toolsFor(iface, menu) {
  if (iface === "T1") return T1;
  return menu.tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.does, parameters: { type: "object", properties: Object.fromEntries(Object.entries(t.args).map(([k, v]) => [k, { type: "string", description: String(v) }])) } },
  }));
}
