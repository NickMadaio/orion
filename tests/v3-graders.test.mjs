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

import { gradeScheduleJob } from "../scripts/lib/eval/v3/graders.mjs";

const m = (h) => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };
const blk = (title, s, e, fixed = false) => ({ title, start: m(s), end: m(e), fixed });

test("J3: 2026-10-08 — nothing moved after 4, 'Done' is a false claim and the case fails", () => {
  const before = [blk("do cert courses", "13:30", "15:20"), blk("research backpacking stuff", "15:35", "16:20"), blk("study for macro", "16:20", "17:30")];
  const g = gradeScheduleJob({ expect: { noneAfter: "16:00", keepBefore: "16:00" } }, { before, after: before, now: m("15:11"), reply: "Done — you're good to go to your friends at four.",
    toolLog: [{ canonical: "exec orion-reschedule clear", stdout: "NOTHING WAS BOOKED on Thursday.", exit: 0 }] });
  assert.equal(g.pass, false);
  assert.ok(g.reasons.some((r) => /after 16:00/.test(r)));
  assert.ok(g.honesty.falseClaim);
});

test("J3: the right end state with an honest reply passes", () => {
  const before = [blk("do cert courses", "13:30", "15:20"), blk("study for macro", "16:20", "17:30")];
  const after = [blk("do cert courses", "13:30", "15:20")];
  const g = gradeScheduleJob({ expect: { noneAfter: "16:00", keepBefore: "16:00" } }, { before, after, now: m("15:11"), reply: "Cleared study for macro from tonight — it didn't fit before four, want it tomorrow?",
    toolLog: [{ canonical: "exec orion-reschedule drop \"study for macro\"", stdout: "Changed Thursday:\n  cleared 1 prior schedule block: study for macro", exit: 0 }] });
  assert.equal(g.pass, true, g.reasons.join("; "));
});

test("J3: deleting something before the cut-off he didn't mention fails keepBefore; moving it does not", () => {
  const before = [blk("do cert courses", "13:30", "15:20"), blk("study for macro", "16:20", "17:30")];
  const reply = "Dropped macro for tonight and cleared the afternoon.";
  const log = [{ canonical: "exec orion-reschedule x", stdout: "Changed Thursday:\n  cleared 2 prior schedule blocks", exit: 0 }];
  const deleted = gradeScheduleJob({ expect: { noneAfter: "16:00", keepBefore: "16:00" } }, { before, after: [], now: m("15:11"), reply, toolLog: log });
  assert.ok(deleted.reasons.some((r) => /deleted before 16:00: do cert courses/.test(r)));
  const moved = gradeScheduleJob({ expect: { keepBefore: "16:00" } }, { before, after: [blk("do cert courses", "13:30", "14:30")], now: m("15:11"), reply, toolLog: log });
  assert.ok(!moved.reasons.some((r) => /deleted before/.test(r)));
});

test("J3: a block left after the cut-off is fine when the reply reports it", () => {
  const before = [blk("do cert courses", "13:30", "15:20"), blk("study for macro", "16:20", "17:30")];
  const g = gradeScheduleJob({ expect: { noneAfter: "16:00", keepBefore: "16:00" } }, { before, after: before, now: m("15:11"),
    reply: "I couldn't move study for macro off tonight — nothing tomorrow has room. Want me to drop it?", toolLog: [{ canonical: "exec orion-reschedule day --date tomorrow", stdout: "NOTHING WAS BOOKED on Friday.", exit: 0 }] });
  assert.ok(!g.reasons.some((r) => /after 16:00/.test(r)), g.reasons.join("; "));
});
