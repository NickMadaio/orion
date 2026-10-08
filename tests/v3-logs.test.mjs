// The V3 log extractor: real turns come out flat, evaluation runs stay out, and
// the 2026-10-08 shape ("NOTHING WAS BOOKED" then "Done") is flagged.
// Synthetic fixtures only — no real transcript belongs in Git.
import { test } from "node:test";
import assert from "node:assert/strict";
import { userTextOf, channelOf, flattenSession, flagTurns, flattenChat } from "../scripts/lib/eval/v3/logs.mjs";
import { isProbe } from "../scripts/lib/eval/v3/exclude.mjs";

const wrap = (said, extra = "") => `[Orion app context — factual state supplied by the native app]\nFocus session: inactive.\n${said ? "Nick SAID this out loud and your answer will be SPOKEN." : ""}${extra}\n\nUser message:\n`;
const user = (text, at, prefix = wrap(true)) => ({ type: "message", timestamp: at, message: { role: "user", content: prefix + text } });
const call = (command, at, model = "claude-haiku-4-5-20251001", provider = "anthropic") => ({
  type: "message", timestamp: at,
  message: { role: "assistant", model, provider, stopReason: "toolUse", content: [{ type: "thinking", thinking: "x" }, { type: "toolCall", id: "t1", name: "exec", arguments: { command } }] },
});
const result = (text, at, exitCode = 0, isError = false) => ({
  type: "message", timestamp: at,
  message: { role: "toolResult", toolName: "exec", content: [{ type: "text", text }], details: { exitCode }, isError },
});
const reply = (text, at, model = "claude-haiku-4-5-20251001", provider = "anthropic") => ({
  type: "message", timestamp: at, message: { role: "assistant", model, provider, stopReason: "stop", content: [{ type: "text", text }] },
});

test("userTextOf keeps only what Nick said after the context block", () => {
  assert.equal(userTextOf(wrap(true) + "move gym to 6"), "move gym to 6");
  assert.equal(userTextOf([{ type: "text", text: wrap(false) + "hi" }]), "hi");
  assert.equal(userTextOf("plain text with no wrapper"), "plain text with no wrapper");
});

test("userTextOf also unwraps the phone route's brief", () => {
  const phone = "[orion-remote] Live facts for this message (read just now, not from Nick):\n- Apps open: x\n--- Nick's message follows ---\ndo I need an umbrella tomorrow";
  assert.equal(userTextOf(phone), "do I need an umbrella tomorrow");
  assert.equal(channelOf(phone), "phone");
});

test("channelOf tells voice, phone and Mac apart", () => {
  assert.equal(channelOf(wrap(true) + "x"), "voice");
  assert.equal(channelOf("[orion-remote] Live facts for this message\n\nUser message:\nx"), "phone");
  assert.equal(channelOf(wrap(false) + "x"), "mac");
  assert.equal(channelOf("Talk Mode active. Reply in a concise, spoken tone.\nx"), "voice");
});

test("coding-session probes are recognised; Nick's ordinary requests are not", () => {
  for (const probe of ["Reply with exactly: ok", "Quick thing before I forget — the benchmark fixture codename is Kestrelabc.",
    "STANDING GUIDANCE (from AGENTS.md): be brief", "You are ORION running an autonomous mission.", "Say only: ok",
    "Read-only probe. Search the web for the headline", "Diagnostic, no delivery. Call messages_recent",
    "Security diagnostic, no writes. Use exec exactly once", "Run this exact shell command with exec and paste the raw output",
    "Use your orion_task_run tool with action messages_whoami", "Call orion_permission_status. Reply with only",
    "Change your own setting messages.tts.providers.x to 9000"]) assert.equal(isProbe(probe), true, probe);
  for (const real of ["can you run the dishwasher reminder", "move study to 6", "what's the diagnosis on my sleep"]) assert.equal(isProbe(real), false, real);
});

test("each turn records whether its wrapper carried the eval clock", () => {
  const [t] = flattenSession([user("move gym", "2026-10-07T10:00:00.000Z", wrap(false, "\nTEST CLOCK: it is 14:00"))], { file: "e", sessionKey: null });
  assert.equal(t.evalClock, true);
});

const outFrom4 = [
  { type: "session", id: "s1" },
  user("redo my day, I'm out by four", "2026-10-08T14:11:05.000Z"),
  call("/x/scripts/orion-reschedule day --todos", "2026-10-08T14:11:10.000Z"),
  result("NOTHING WAS BOOKED — the day is already clear", "2026-10-08T14:11:11.000Z"),
  reply("Done — you're good to go.", "2026-10-08T14:11:20.000Z"),
  user("Why isn't my schedule changed?", "2026-10-08T14:12:00.000Z"),
  reply("Your evening's open.", "2026-10-08T14:12:05.000Z"),
];

test("flattenSession makes one turn per user message with its calls, results and reply", () => {
  const turns = flattenSession(outFrom4, { file: "s1.jsonl", sessionKey: "agent:main:orion-app-v2" });
  assert.equal(turns.length, 2);
  const [t] = turns;
  assert.equal(t.userText, "redo my day, I'm out by four");
  assert.equal(t.channel, "voice");
  assert.equal(t.line, 2);
  assert.deepEqual(t.models, ["anthropic/claude-haiku-4-5-20251001"]);
  assert.equal(t.toolCalls[0].command, "/x/scripts/orion-reschedule day --todos");
  assert.match(t.toolResults[0].text, /NOTHING WAS BOOKED/);
  assert.equal(t.reply, "Done — you're good to go.");
  assert.equal(t.latencyMs, 15000);
});

test("the 2026-10-08 shape is flagged: success words after NOTHING WAS, and a correction next", () => {
  const flagged = flagTurns(flattenSession(outFrom4, { file: "s1.jsonl", sessionKey: "agent:main:orion-app-v2" }));
  assert.ok(flagged[0].flags.includes("claims-after-nothing"));
  assert.ok(flagged[0].flags.includes("corrected-next"));
  assert.ok(!flagged[1].flags.includes("claims-after-nothing"));
});

test("tool errors, NO_REPLY, local-model answers and repeats are flagged", () => {
  const lines = [
    user("start a focus session", "2026-10-07T10:00:00.000Z"),
    call("/x/scripts/orion-session end", "2026-10-07T10:00:02.000Z"),
    result("unknown command: end", "2026-10-07T10:00:03.000Z", 2, true),
    reply("NO_REPLY", "2026-10-07T10:00:04.000Z"),
    user("start a focus session please", "2026-10-07T10:03:00.000Z"),
    reply("Started.", "2026-10-07T10:03:04.000Z", "llama3.2:3b", "ollama"),
  ];
  const [a, b] = flagTurns(flattenSession(lines, { file: "s2.jsonl", sessionKey: "agent:main:orion-app-v2" }));
  assert.ok(a.flags.includes("tool-error"));
  assert.ok(a.flags.includes("no-reply"));
  assert.ok(b.flags.includes("repeated"));
  assert.ok(b.flags.includes("local-model"));
});

test("a clean turn carries no flags", () => {
  const lines = [user("what time is it", "2026-10-07T10:00:00.000Z"), reply("It's 10 AM.", "2026-10-07T10:00:01.000Z")];
  assert.deepEqual(flagTurns(flattenSession(lines, { file: "s3.jsonl", sessionKey: "agent:main:orion-app-v2" }))[0].flags, []);
});

test("flattenChat pairs each user message with ORION's next reply and keeps the device", () => {
  const chat = { id: "c1", messages: [
    { role: "user", text: "lights off", device: "phone", at: "2026-10-08T21:00:00Z" },
    { role: "orion", text: "Lights off.", device: "phone", at: "2026-10-08T21:00:03Z" },
    { role: "user", text: "thanks", device: "mac", at: "2026-10-08T21:01:00Z" },
  ] };
  const turns = flattenChat(chat, { file: "c1.json" });
  assert.equal(turns.length, 2);
  assert.equal(turns[0].channel, "phone");
  assert.equal(turns[0].reply, "Lights off.");
  assert.equal(turns[0].latencyMs, 3000);
  assert.equal(turns[1].reply, null);
});

const taskRun = (details) => JSON.stringify({
  tool: { id: "openclaw:orion-control:orion_task_run", description: "returns executed:false when nothing happened; NOT SENT means…" },
  result: { content: [{ type: "text", text: JSON.stringify(details) }], details },
});

test("orion_task_run results are reduced to their outcome, so the tool's own description can't trip a flag", () => {
  const ok = { type: "message", timestamp: "2026-09-28T11:26:19.000Z", message: { role: "toolResult", toolName: "tool_call", content: [{ type: "text", text: taskRun({ executed: true, status: "succeeded", outcome: "DONE — this really happened", reportToUser: "Done." }) }] } };
  const no = { ...ok, message: { ...ok.message, content: [{ type: "text", text: taskRun({ executed: false, status: "blocked", outcome: "NOT DONE", reportToUser: "Needs approval A-1" }) }] } };
  const lines = (r) => [user("open orion", "2026-09-28T11:26:15.000Z"), call("x", "2026-09-28T11:26:16.000Z"), r, reply("Done.", "2026-09-28T11:26:20.000Z")];
  const [good] = flagTurns(flattenSession(lines(ok), { file: "a", sessionKey: "agent:main:orion-app-v2" }));
  const [bad] = flagTurns(flattenSession(lines(no), { file: "b", sessionKey: "agent:main:orion-app-v2" }));
  assert.match(good.toolResults[0].text, /executed=true status=succeeded/);
  assert.doesNotMatch(good.toolResults[0].text, /description/);
  assert.ok(!good.flags.includes("claims-after-nothing"));
  assert.ok(bad.flags.includes("claims-after-nothing"));
});

test("success words after every tool call failed are flagged (2026-10-06: 'Saved' after two usage errors)", () => {
  const lines = [
    user("make a note for the future", "2026-10-06T17:48:00.000Z"),
    call("/x/scripts/orion-project add x", "2026-10-06T17:48:01.000Z"), result("usage: orion-project add <id>", "2026-10-06T17:48:02.000Z", 2, true),
    call("/x/scripts/orion-note add x", "2026-10-06T17:48:03.000Z"), result("orion-note: usage: …", "2026-10-06T17:48:04.000Z", 2, true),
    reply("Saved—focus on your courses now.", "2026-10-06T17:48:05.000Z"),
  ];
  const [t] = flagTurns(flattenSession(lines, { file: "s", sessionKey: "agent:main:orion-app-v2" }));
  assert.ok(t.flags.includes("claims-after-error"));
});

test("recording or doing something with no tool call at all is flagged (2026-10-06: 'Adding that to the list')", () => {
  const said = (text) => flagTurns(flattenSession([user("the mic never stops", "2026-10-06T19:12:00.000Z"), reply(text, "2026-10-06T19:12:02.000Z")], { file: "s", sessionKey: "agent:main:orion-app-v2" }))[0].flags;
  assert.ok(said("Got it—I'll add that to your list.").includes("claims-without-tool"));
  assert.ok(said("Noted—continuous mic bug is critical.").includes("claims-without-tool"));
  assert.ok(said("I'll get that reported to the dev team.").includes("claims-without-tool"));
  assert.ok(!said("It's 3:53 PM.").includes("claims-without-tool"));
  assert.ok(!said("Want me to add that to your list?").includes("claims-without-tool"));
});

test("other tools' JSON output is kept whole, so a NOTHING message inside it still counts", () => {
  const json = JSON.stringify({ status: "ok", message: "NOTHING WAS BOOKED today" });
  const lines = [user("book gym", "2026-10-07T10:00:00.000Z"), call("/x/scripts/orion-x", "2026-10-07T10:00:01.000Z"),
    { ...result(json, "2026-10-07T10:00:02.000Z"), message: { role: "toolResult", toolName: "exec", content: [{ type: "text", text: json }], details: { exitCode: 0 } } },
    reply("Done, gym is booked.", "2026-10-07T10:00:03.000Z")];
  const [t] = flagTurns(flattenSession(lines, { file: "j", sessionKey: "agent:main:orion-app-v2" }));
  assert.match(t.toolResults[0].text, /NOTHING WAS BOOKED/);
  assert.ok(t.flags.includes("claims-after-nothing"));
});

test("tool timeouts and a fallback model are flagged", () => {
  const lines = [user("start focus", "2026-10-06T16:46:00.000Z"), call("/x/scripts/orion-focus start x 134", "2026-10-06T16:46:01.000Z"),
    result("Command still running (session gentle-prairie, pid 50293).", "2026-10-06T16:46:02.000Z", null),
    reply("{\"name\": \"orion-focus\"}", "2026-10-06T16:46:30.000Z", "llama3.2:3b", "ollama")];
  const [t] = flagTurns(flattenSession(lines, { file: "f", sessionKey: "agent:main:orion-app-v2" }));
  assert.ok(t.flags.includes("tool-timeout"));
  assert.ok(t.flags.includes("fallback"));
});
