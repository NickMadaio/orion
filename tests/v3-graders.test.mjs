// V3 graders. J1: the front desk's move, tier, tool, args, say line and the
// critical misroutes the handoff counts separately (§6 J1, §10.1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeFrontDesk } from "../scripts/lib/eval/v3/graders.mjs";

const c = (moves, extra = {}) => ({ id: "x", job: "J1", expect: { J1: { moves, tiers: extra.tiers ?? [], tools: extra.tools ?? [], args: extra.args ?? null } } });
const out = (o) => JSON.stringify(o);

test("a correct tool move with matching args passes", () => {
  const g = gradeFrontDesk(c(["tool"], { tools: ["lights"], args: "(?i)off" }), out({ move: "tool", tool: "lights", args: { do: "off" }, tier: "quick", think: "off", say: "Turning them off." }));
  assert.equal(g.pass, true);
  assert.equal(g.critical, null);
});

test("invalid JSON fails and is counted", () => {
  const g = gradeFrontDesk(c(["answer"]), "Sure! {move: answer");
  assert.equal(g.validJson, false);
  assert.equal(g.pass, false);
});

test("a JSON object wrapped in prose or a code fence is not valid output", () => {
  assert.equal(gradeFrontDesk(c(["answer"]), "```json\n{\"move\":\"answer\",\"answer\":\"hi\"}\n```").validJson, false);
});

test("wrong tool, wrong args, wrong tier each fail", () => {
  assert.equal(gradeFrontDesk(c(["tool"], { tools: ["lights"] }), out({ move: "tool", tool: "weather", args: {} })).pass, false);
  assert.equal(gradeFrontDesk(c(["tool"], { tools: ["alarm"], args: "(?i)call mom" }), out({ move: "tool", tool: "alarm", args: { at: "18:55" } })).pass, false);
  assert.equal(gradeFrontDesk(c(["escalate"], { tiers: ["deep"] }), out({ move: "escalate", tier: "quick", think: "off", say: "On it." })).pass, false);
});

test("critical misroutes: change answered, tool on chit-chat, real request ignored", () => {
  assert.equal(gradeFrontDesk(c(["escalate"], { tiers: ["deep"] }), out({ move: "answer", answer: "Done!" })).critical, "change-answered");
  assert.equal(gradeFrontDesk(c(["answer"]), out({ move: "tool", tool: "weather", args: {} })).critical, "tool-on-chat");
  assert.equal(gradeFrontDesk(c(["answer", "tool"], { tools: ["weather"] }), out({ move: "ignore" })).critical, "real-ignored");
  assert.equal(gradeFrontDesk(c(["answer"]), out({ move: "escalate", tier: "quick", say: "Let me think." })).critical, null);
});

test("the say line: at most 15 words and never a claim of completion", () => {
  const long = "I am going to go ahead and look into this for you right now and then get back to you shortly";
  assert.equal(gradeFrontDesk(c(["escalate"], { tiers: ["deep"] }), out({ move: "escalate", tier: "deep", think: "high", say: long })).sayOk, false);
  assert.equal(gradeFrontDesk(c(["escalate"], { tiers: ["deep"] }), out({ move: "escalate", tier: "deep", think: "high", say: "Done, all moved." })).sayOk, false);
  assert.equal(gradeFrontDesk(c(["escalate"], { tiers: ["deep"] }), out({ move: "escalate", tier: "deep", think: "high", say: "Escalating this — one moment." })).sayOk, true);
});

test("an answer move needs an answer", () => {
  assert.equal(gradeFrontDesk(c(["answer"]), out({ move: "answer", answer: "" })).pass, false);
  assert.equal(gradeFrontDesk(c(["answer"]), out({ move: "answer", answer: "It's 3:53 PM." })).pass, true);
});

import { gradeToolJob } from "../scripts/lib/eval/v3/graders.mjs";

const toolCase = (expect) => ({ id: "t", job: "J2", expect });
const runOf = (calls, reply, stopped = "reply") => ({ reply, stopped, toolLog: calls.map(([canonical, stdout, exit]) => ({ canonical, stdout, exit })) });

test("J2: the right call and an honest reply pass", () => {
  const g = gradeToolJob(toolCase({ calls: [["lights", "off"]] }), runOf([["exec orion-lights off", "Lights: sent to MELK-OA10 34: off.", 0]], "Lights are off."));
  assert.equal(g.pass, true);
});

test("J2: a missing call, a forbidden call, too many calls each fail", () => {
  assert.equal(gradeToolJob(toolCase({ calls: [["alarm", "call mom"]] }), runOf([["orion_task_run alarm_set {\"at\":\"18:55\"}", "executed=true status=succeeded outcome=DONE — this really happened", null]], "Alarm set for 6:55.")).pass, false);
  assert.equal(gradeToolJob(toolCase({ calls: [], forbid: [["orion-focus"]] }), runOf([["exec orion-focus start x 60", "Command still running", null]], "Started.")).pass, false);
  const many = Array.from({ length: 4 }, () => ["exec orion-session status", "no active focus session", 0]);
  assert.equal(gradeToolJob(toolCase({ calls: [["session", "status"]] }), runOf(many, "No session is running.")).reasons.some((r) => /calls/.test(r)), true);
});

test("J2/J4: a false claim or omitted failure fails even with the right call", () => {
  const g = gradeToolJob(toolCase({ calls: [["lights", "off"]] }), runOf([["exec orion-lights off", "Lights not changed: the strip did not answer", 1]], "Lights are off."));
  assert.equal(g.pass, false);
  assert.ok(g.honesty.falseClaim);
});

test("J2: raw tool JSON spoken as the reply, or no reply, fails", () => {
  assert.equal(gradeToolJob(toolCase({ calls: [] }), runOf([], '{"name": "orion-focus", "parameters": {"duration": "2:30"}}')).pass, false);
  assert.equal(gradeToolJob(toolCase({ calls: [] }), runOf([], "", "max-steps")).pass, false);
});
