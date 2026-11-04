// A fix project for something ORION got wrong, written the way docs/agentic/PLAN_STANDARD.md says a plan must be: an orion-plan block, one
// orion-task block (objective as an end state, one verifiable criterion each, scope as the grant, checks that exist) and the briefs the
// worker will actually read (common.md and <task-id>.md). The project runs through the normal pipeline, with its reviews; nothing here edits
// live code. Pure: returns text, writes nothing.
import { redact } from "./turns.mjs";

export const slugOf = (diagnosis) => `selffix-${String(diagnosis.signature).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`;

const fence = (lang, body) => "```" + lang + "\n" + body + "\n```";

/** Plan markdown and briefs for one diagnosis. `id` makes the task id unique per fix (a short suffix). */
export function buildFixPlan(diagnosis, { id } = {}) {
  const taskId = id ? `${slugOf(diagnosis)}-${id}`.slice(0, 64).replace(/-$/, "") : slugOf(diagnosis);
  const files = diagnosis.files.filter((f) => !f.endsWith(".test.ts"));
  const testFile = diagnosis.files.find((f) => f.endsWith(".test.ts")) ?? `plugin/orion-control/src/${taskId}.test.ts`;
  const scope = [...new Set([...files, testFile])];
  const ex = diagnosis.failingExample;
  const example = `He said ${JSON.stringify(redact(ex.message, 120))}. ${ex.tool ? `I ran ${ex.tool}${ex.args ? ` with ${redact(ex.args, 120)}` : ""}${ex.error ? ` and it failed: ${redact(ex.error, 140)}` : ""}.` : "No tool ran."} I replied ${JSON.stringify(redact(ex.reply || "(nothing)", 140))}.`;
  const title = diagnosis.title.replace(/"/g, "'");
  const task = {
    id: taskId,
    title: title.slice(0, 120),
    objective: diagnosis.kind === "requested"
      ? `After this task, the problem Nick reported in the brief's example is fixed: find the cause in the code that handled it, then change it. A test using the exact phrase passes, and the same kind of request is handled correctly.`
      : `After this task, the failing example in the brief no longer fails: ${diagnosis.cause}. A test using the exact failing phrase passes, and the same kind of request is handled by the right route.`,
    context: `READ ${files.slice(0, 3).join(", ")} first (where this kind of request is routed). The failing example and decisions are in the brief ${taskId}.md.`,
    scope,
    nonScope: ["Do not widen permissions, the exec allowlist or any authority table.", "Do not edit files outside scope, and never touch ~/.openclaw in tests."],
    constraints: ["Write the failing test first, then the smallest change that passes it.", "Never mutate arguments; return new values."],
    preconditions: files.slice(0, 1).map((f) => `exists: ${f}`),
    acceptance: [
      `A test reproduces the failing example from the brief and fails before the change.`,
      `After the change that test passes and the reply states only what a tool result shows.`,
      `Existing tests in the touched test files still pass.`,
    ],
    checks: ["plugin-typecheck", "plugin-tests"],
    dependencies: [],
    weight: 2,
    risk: "medium",
    reviewDepth: "standard",
    escalateWhen: ["The cause turns out to be a permission, an authority table or a config value rather than code."],
  };
  const plan = [
    `# ${title} — agent work backlog`,
    "",
    "**Owner:** ORION (opened by self-assessment, confirmed by Nick) · **Purpose:** fix one thing ORION got wrong.",
    "",
    "## Goal",
    `Fix: ${diagnosis.says}`,
    "",
    "## How this becomes work",
    fence("orion-plan", JSON.stringify({ project: title.slice(0, 120), options: { maxAttempts: 3, maxCorrectionDepth: 2 } })),
    "",
    "## Tasks",
    "",
    fence("orion-task", JSON.stringify(task, null, 2)),
    "",
  ].join("\n");
  const common = [
    "# Common brief",
    "## Goal",
    "ORION diagnosed one of his own mistakes from the record of a real turn. This project fixes it through the normal project pipeline, with its reviews.",
    `Diagnosis, in his words: ${diagnosis.says}`,
    "## Files",
    ...scope.map((f) => `- \`${f}\``),
    "## Tests",
    "Tests are vitest files beside the source (`*.test.ts`). Use held-out casual phrasings in Nick's style: lowercase, typos, run-ons. No /Users paths, no real secrets.",
    "## Working in this loop",
    "- `### EDIT` for existing files, `### FILE` only for new ones.",
    "- Checks run after every write. Keep code and tests compact.",
  ].join("\n");
  const brief = [
    `# Task ${taskId}`,
    "## Where you start",
    "The code at HEAD routes this request the way the failing example shows.",
    "## Failing example",
    example,
    `Route recorded: ${JSON.stringify(ex.route ?? {})}`,
    "## Decisions",
    `- Kind: ${diagnosis.kind}. Likely cause: ${diagnosis.cause}.`,
    "- The fix belongs in routing or wording code, not in permissions or config.",
    "- Add the test first and watch it fail for the reason above.",
    "## Tests",
    `- One test named after the failing phrase (${JSON.stringify(redact(ex.message, 60))}), plus one near phrasing with a typo.`,
    "## Exchange plan",
    "READ the files, EDIT the test, EDIT the source, DONE.",
    "## Traps",
    "- Do not special-case the exact string; fix the class of request.",
    "## For the reviewer",
    "Judge the diff against the failing example. Do not flag unrelated style.",
  ].join("\n");
  return { taskId, title, plan, briefs: { common, task: brief } };
}
