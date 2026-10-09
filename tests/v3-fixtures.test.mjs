// V3 tool fixtures: both tool interfaces reduce to one canonical call string,
// scripted results answer them, and expected calls match either interface.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalCall, fixtureExecutor, callsMatch, toolsFor } from "../scripts/lib/eval/v3/fixtures.mjs";

test("T1 (exec / orion_task_run) and T2 (one function per tool) canonicalise comparably", () => {
  assert.equal(canonicalCall({ name: "exec", args: { command: "/Users/x/Desktop/ORION/scripts/orion-lights off" } }), "exec orion-lights off");
  assert.match(canonicalCall({ name: "orion_task_run", args: { steps: [{ action: "alarm_set", at: "18:55", label: "call mom" }] } }), /alarm_set.*call mom/);
  assert.equal(canonicalCall({ name: "lights", args: { do: "off" } }), 'lights {"do":"off"}');
});

test("an expected call is a set of patterns that must all match one call", () => {
  const calls = ["exec orion-lights on --brightness 20", 'alarm {"at":"18:55","label":"call mom"}'];
  assert.equal(callsMatch([["lights", "20"]], calls).ok, true);
  assert.equal(callsMatch([["alarm", "call mom"]], calls).ok, true);
  assert.equal(callsMatch([["lights", "off"]], calls).ok, false);
  assert.deepEqual(callsMatch([["lights", "off"]], calls).missing, [["lights", "off"]]);
  assert.equal(callsMatch([], calls, [["weather"]]).ok, true);
  assert.equal(callsMatch([], calls, [["alarm"]]).ok, false);
});

test("the executor answers from the case's fixtures first, then realistic read-only defaults", async () => {
  const exec = fixtureExecutor([{ match: ["lights", "off"], stdout: "Lights not changed: the strip did not answer", exit: 1 }]);
  const a = await exec({ name: "exec", args: { command: "orion-lights off" } });
  assert.equal(a.exit, 1);
  assert.match(a.stdout, /not changed/);
  const s = await exec({ name: "exec", args: { command: "orion-session status" } });
  assert.equal(s.exit, 0);
  const u = await exec({ name: "exec", args: { command: "orion-teleport now" } });
  assert.notEqual(u.exit, 0);
});

test("toolsFor builds Ollama tool schemas for each interface", () => {
  const menu = { tools: [{ name: "lights", does: "LED strip", args: { do: "on|off" } }] };
  const t1 = toolsFor("T1", menu).map((t) => t.function.name);
  assert.deepEqual(t1, ["exec", "orion_task_run"]);
  const t2 = toolsFor("T2", menu);
  assert.equal(t2[0].function.name, "lights");
  assert.ok(t2[0].function.parameters.properties.do);
});

test("orion_task_run steps as one object or a JSON string are canonicalised, never a crash", () => {
  assert.match(canonicalCall({ name: "orion_task_run", args: { steps: { action: "alarm_set", at: "18:55" } } }), /alarm_set/);
  assert.match(canonicalCall({ name: "orion_task_run", args: { steps: '[{"action":"weather_now"}]' } }), /weather_now/);
  assert.match(canonicalCall({ name: "orion_task_run", args: { steps: "nonsense" } }), /orion_task_run/);
});
