/*
 Tool failures in Nick's words (gate run-1031202318, cluster 4: hea-log-meal-c, kno-forget-c, saf-delete-folder-c).
 The host appends a raw "Exec failed: `cmd`" payload after the plugin's last hook, unless the final reply acknowledges the failed
 command (OpenClaw MUTATING_FAILURE_INABILITY_PATTERN, copied below and pinned by a test). The plugin cannot strip that payload, so the
 reply has to own the failure in words the host recognises, and say in plain language what did not happen.
*/
import { outcomeOf, type ToolResult } from "./work-check.js";
import { spokenFailure } from "./schedule-reply.js";

const ACTION = "(?:write|edit|update|save|create|delete|remove|modify|change|apply|patch|move|rename|send|reply|message|run|execute|execution|command|script|shell|bash|exec|tool|action|operation)";
const HOST_ACK = new RegExp(`\\b(?:couldn't|could not|can't|cannot|unable to|am unable to|wasn't able to|was not able to|were unable to)\\b.{0,100}\\b${ACTION}\\b`, "u");

/** True when the host would count this reply as owning a failed command (so it appends no raw line). */
export const acknowledgesFailure = (text: string): boolean => HOST_ACK.test(text.toLowerCase());

const WRITE_CANONICAL = /\b(?:add|move|drop|late|early|extend|resize|swap|day|clear|undo|learn|forget|remove|delete|rm|mv|write|send|start|end|pause|set|log|done)\b/i;

/** Tool results this turn that failed or wrote nothing (a flow's own outputs are code-authored and filtered by the caller). */
export function failedTools(tools: ReadonlyArray<ToolResult>): ToolResult[] {
  return tools.filter((t) => { const o = outcomeOf(t); return o === "failed" || o === "nothing"; });
}

/** True when any tool this turn really changed something. */
export const wroteSomething = (tools: ReadonlyArray<ToolResult>): boolean => tools.some((t) => { const o = outcomeOf(t); return o === "success" || o === "partial"; });

/** One short human clause for why a tool failed ("" when the output says nothing a person could use). Never raw text. */
export function failureReason(stdout: string): string {
  const text = String(stdout);
  const line = text.split("\n").map((l) => l.trim()).find((l) => /NOTHING WAS|NOT BOOKED/i.test(l));
  if (line) {
    const said = spokenFailure(line);
    if (said && !/orion-|--[a-z]|^i couldn't make that change/i.test(said)) return said;
  }
  if (/allowlist miss|exec denied|is not allowlisted|permission denied|operation not permitted/i.test(text)) return "I'm not allowed to do that from chat";
  if (/NOT_FOUND|no note matches|not found/i.test(text)) return "I couldn't find it";
  if (/timed? ?out|no such host|dial tcp|ENOTFOUND|connection refused/i.test(text)) return "I couldn't reach it just now";
  return "";
}

/** The sentence that owns the failure. Always satisfies acknowledgesFailure. */
export function acknowledgement(failed: ReadonlyArray<ToolResult>, changeRequest: boolean, withReason = true): string {
  const wrote = changeRequest || failed.some((t) => WRITE_CANONICAL.test(t.canonical.replace(/^exec\s+(?:\S*\/)?orion-[a-z-]+/i, "")));
  const reason = withReason ? failed.map((t) => failureReason(t.stdout)).find(Boolean) ?? "" : "";
  if (!wrote) return "I couldn't run that lookup just now.";
  return reason ? `I couldn't make that change — ${/^I\b/.test(reason) ? reason : reason.charAt(0).toLowerCase() + reason.slice(1)}.` : "I couldn't make that change, so nothing was changed.";
}
