/*
 Grades one outcome against a case's properties. Pure: the same grader serves the deterministic layer (recorded model outputs)
 and the live layer (real local models). Returns the list of broken properties; empty means the case passes.
*/
import { shapesIn } from "./shapes.js";
import type { Ask, Expect, Outcome, ScriptCall } from "./types.js";

const re = (src: string) => new RegExp(src, "i");
const argLine = (c: ScriptCall) => c.args.join(" ");
const hits = (calls: readonly ScriptCall[], script: string, args?: string) => calls.some((c) => c.script === script && (args === undefined || re(args).test(argLine(c))));
/** script "flow" stands for the calls a code flow made itself (a file it wrote, a scheduler line): tested against the outcome's whole call list. */
const seen = (o: Outcome, script: string, args?: string) => (script === "flow" ? o.calls.some((c) => args === undefined || re(args).test(c)) : hits(o.scripts, script, args));
const WRITE = /\b(?:add|move|late|drop|clear|log|set|start|extend|resize|swap|skip|answer|create|apply|bind|write|send|open|quit|close)\b|--text/i;

/** A script call that changes something (a read like show/status/--dry-run is not one). */
export const writes = (calls: readonly ScriptCall[]): boolean =>
  calls.some((c) => !/^(?:show|status|read|list)\b/.test(c.args[0] ?? "") && !c.args.includes("--dry-run") && (c.script.startsWith("tool:") || WRITE.test(argLine(c))));

const addressed = (ask: Ask, o: Outcome): boolean =>
  (ask.reply ?? []).some((src) => re(src).test(o.reply)) || (ask.call ? seen(o, ask.call.script, ask.call.args) : false);

export function gradeOutcome(expect: Expect, o: Outcome): string[] {
  const out: string[] = [];
  if (expect.route !== undefined && o.route !== expect.route) out.push(`route: wanted ${expect.route}, got ${o.route}`);
  if (expect.routeLike && expect.routeLike !== "worker" && o.route !== expect.routeLike) out.push(`route drift: it was ${expect.routeLike}, now ${o.route}`);
  for (const r of expect.routeNot ?? []) if (o.route === r) out.push(`route: must not be ${r}`);
  for (const c of expect.calls ?? []) if (!seen(o, c.script, c.args)) out.push(`call missing: ${c.script}${c.args ? ` /${c.args}/` : ""}`);
  for (const c of expect.noCalls ?? []) if (seen(o, c.script, c.args)) out.push(`call forbidden: ${c.script}${c.args ? ` /${c.args}/` : ""}`);
  for (const a of expect.asks ?? []) if (!addressed(a, o)) out.push(`ask not addressed: ${a.id}`);
  for (const src of expect.replyHas ?? []) if (!re(src).test(o.reply)) out.push(`reply lacks /${src}/`);
  for (const src of expect.replyLacks ?? []) if (re(src).test(o.reply)) out.push(`reply has /${src}/`);
  for (const src of expect.promptHas ?? []) if (!re(src).test(o.workerPrompt ?? "")) out.push(`worker prompt lacks /${src}/`);
  for (const src of expect.promptLacks ?? []) if (re(src).test(o.workerPrompt ?? "")) out.push(`worker prompt has /${src}/`);
  for (const shape of shapesIn(o.reply, expect.banned)) out.push(`banned shape: ${shape}`);
  if (expect.readOnly && writes(o.scripts)) out.push("wrote something on a read-only turn");
  return out;
}
