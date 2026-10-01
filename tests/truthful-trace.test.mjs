import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTrace, expectTools } from "../scripts/lib/eval/trace.mjs";

const line = (o) => JSON.stringify(o);
const user = (text) => line({ type: "message", message: { role: "user", content: [{ type: "text", text }] } });
const call = (id, command, text = "") => line({ type: "message", message: { role: "assistant", content: [
  ...(text ? [{ type: "text", text }] : []), { type: "toolCall", id, name: "exec", arguments: { command } }] } });
const result = (id, text, isError = false) => line({ type: "message", message: { role: "toolResult", toolCallId: id, toolName: "exec", isError, content: [{ type: "text", text }] } });
const say = (text) => line({ type: "message", message: { role: "assistant", content: [{ type: "text", text }] } });
const S = "/Users/nickmadaio/Desktop/ORION/scripts/";
const todoTurn = [
  line({ type: "session" }),
  user("add fix Orion stuff, finish my resume, send internship applications and maybe study"),
  call("t1", `${S}orion-agenda today`), result("t1", "today 9:00 AM — CS1802"),
  call("t2", `${S}orion-reschedule day --plan "fix Orion stuff, 60, 12:30, fixed" --plan "finish resume, 90, 14:30, fixed"`),
  result("t2", "Changed Wednesday"),
  say("Resume at 4:00 PM."),
].join("\n");

test("parses the real todo turn", () => {
  const { turns } = parseTrace(todoTurn);
  assert.equal(turns.length, 1);
  assert.deepEqual(turns[0].calls.map((c) => c.script), ["orion-agenda", "orion-reschedule"]);
  assert.ok(turns[0].calls[1].args.includes("fix Orion stuff, 60, 12:30, fixed"));
  assert.equal(turns[0].reply, "Resume at 4:00 PM.");
});

test("live facts wrapper is stripped", () => {
  const wrapped = "[orion-remote] Live facts for this message (read just now, not from Nick):\n- Apps open: x\n--- Nick's message follows --- unblock my apps";
  assert.equal(parseTrace(user(wrapped)).turns[0].say, "unblock my apps");
  assert.equal(parseTrace(user("[orion-remote] Live facts\n- x\nNick: hello there")).turns[0].say, "hello there");
});

test("missing result gives ok null", () => {
  const { turns } = parseTrace([user("hi"), call("a", `${S}orion-agenda today`)].join("\n"));
  assert.equal(turns[0].calls[0].ok, null);
});

test("malformed lines are skipped and counted", () => {
  const { turns, skipped } = parseTrace([user("hi"), "{not json", "also not"].join("\n"));
  assert.equal(turns.length, 1);
  assert.equal(skipped, 2);
});

test("mustRun and mustNotInclude catch the 30 September failure", () => {
  const { turns } = parseTrace(todoTurn);
  const r = expectTools(turns[0], { mustRun: ["orion-remind"], mustNotInclude: [", fixed"] });
  assert.equal(r.pass, false);
  assert.deepEqual(r.failures, ["did not run orion-remind", 'a call included ", fixed"']);
});

test("tool_call script name", () => {
  const text = [user("weather?"), line({ type: "message", message: { role: "assistant", content: [
    { type: "toolCall", id: "w", name: "tool_call", arguments: { tool: "web_search", query: "london weather" } }] } })].join("\n");
  assert.equal(parseTrace(text).turns[0].calls[0].script, "web_search");
});

test("two turns", () => {
  const { turns } = parseTrace([user("one"), call("a", `${S}orion-agenda today`), user("two"), call("b", `${S}orion-wake 07:15`)].join("\n"));
  assert.deepEqual(turns.map((t) => t.calls.map((c) => c.script)), [["orion-agenda"], ["orion-wake"]]);
});

test("invalid input throws", () => {
  assert.throws(() => parseTrace(42), TypeError);
  assert.throws(() => expectTools(null, {}), TypeError);
});
