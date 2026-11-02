/**
 * What the computer loop did, as tool results (2026-11-02).
 *
 * The loop runs by code and its reply is fixed, so its steps never reached `run.tools`. The turn then looked like
 * "Done: opened Notes" with zero tool calls (gate com-open-app-v/-c): the work check flagged a claim it could not
 * see evidence for, and the gate saw no tool at all. Each step becomes one result the work check already reads:
 * a verified step is a success line, a step the screen did not confirm is an error line.
 */
import type { StepLog } from "./computer-recipes.js";
import type { ToolResult } from "./work-check.js";

export function stepsAsToolResults(steps: readonly StepLog[]): ToolResult[] {
  return steps.map((s) => {
    const what = `${s.action}${s.target ? ` ${s.target}` : ""}`.trim();
    const canonical = `computer ${what}`;
    if (s.action === "observe") return { canonical, stdout: `Screen read${s.note ? `: ${s.note}` : ""}`, exit: 0 };
    if (s.ok && s.verified) return { canonical, stdout: `Changed ${what} (confirmed on screen)`, exit: 0 };
    return { canonical, stdout: `Error: ${what} did not take effect${s.note ? ` (${s.note})` : ""}`, exit: 1 };
  });
}
