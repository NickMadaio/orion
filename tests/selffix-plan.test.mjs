import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFixPlan, slugOf } from "../scripts/lib/selfcheck/fixplan.mjs";
import { loadAgentPlan } from "../scripts/lib/agentic/plan.mjs";
import { lintPlan } from "../scripts/lib/agentic/plan-lint.mjs";

const diagnosis = {
  kind: "wrong-tool", signature: "wrong-tool:app_open", cause: "a site or phrase was routed as an application name", title: "Fix: wrong tool on \"open amazon uk\"",
  says: "I treated \"amazon uk\" as an app name, so I tried to open an app that doesn't exist. That's a routing mistake on my side.",
  failingExample: { message: "open amazon uk", reply: "I couldn't run that lookup just now.", tool: "app_open", args: "{\"application\":\"amazon uk\"}", error: "Application \"amazon uk\" was not found", route: { move: "tool" } },
  files: ["plugin/orion-control/src/open-request.ts", "plugin/orion-control/src/tool-moves.ts", "plugin/orion-control/src/open-request.test.ts"],
};

test("the plan loads through the real loader with its briefs, and names the failing example", async () => {
  const built = buildFixPlan(diagnosis, { id: "ab12" });
  const dir = mkdtempSync(join(tmpdir(), "fixplan-"));
  writeFileSync(join(dir, "plan.md"), built.plan);
  mkdirSync(join(dir, "plan.briefs"));
  writeFileSync(join(dir, "plan.briefs", "common.md"), built.briefs.common);
  writeFileSync(join(dir, "plan.briefs", `${built.taskId}.md`), built.briefs.task);
  const loaded = await loadAgentPlan(join(dir, "plan.md"));
  assert.equal(loaded.tasks.length, 1);
  assert.equal(loaded.tasks[0].id, "selffix-wrong-tool-app-open-ab12");
  assert.match(loaded.briefs.byTask[built.taskId], /open amazon uk/);
  const errors = lintPlan(loaded, { briefs: loaded.briefs }).filter((f) => f.level === "error");
  assert.deepEqual(errors, []);
});

test("the task states title, goal, failing example, acceptance and files", () => {
  const built = buildFixPlan(diagnosis);
  assert.match(built.plan, /orion-plan/);
  assert.match(built.plan, /"scope"/);
  assert.match(built.plan, /open-request\.ts/);
  assert.match(built.briefs.task, /Failing example/);
  assert.match(built.briefs.task, /was not found/);
  assert.equal(slugOf(diagnosis), "selffix-wrong-tool-app-open");
  assert.ok(JSON.parse(built.plan.split("```orion-task\n")[1].split("\n```")[0]).acceptance.length >= 3);
});
