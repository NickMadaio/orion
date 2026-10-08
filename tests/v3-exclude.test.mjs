// Keeping evaluation traffic out of Nick's real history without dropping his
// real sessions: a known real session only loses its probe turns; whole-session
// rules apply to reset sessions whose key is gone. (Review findings 2026-10-08.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { evalAuditIndex, matchesEvalAudit, scriptedFiles, judgeSessions, dropEvalChatTurns } from "../scripts/lib/eval/v3/exclude.mjs";

const audit = [
  { at: "2026-09-29T13:32:47.865Z", from: "phone", text: "class just ran 30 min late", session: "orion-eval-life-b10" },
  { at: "2026-10-06T16:35:54.000Z", from: "phone", text: "start a focus session", session: "orion-app-v2" },
  { at: "2026-09-20T10:00:00.000Z", from: "fabrication-probe-9001", text: "did you send it" },
];
const index = evalAuditIndex(audit);
const turn = (line, userText, at = "2026-10-01T10:00:00.000Z", evalClock = false) => ({ line, userText, at, evalClock });

test("a turn matching an eval session's audit entry within a minute is evaluation traffic", () => {
  assert.equal(matchesEvalAudit(index, "class just ran 30 min late", "2026-09-29T13:33:20.000Z"), true);
  assert.equal(matchesEvalAudit(index, "class just ran 30 min late", "2026-09-30T13:33:20.000Z"), false);
  assert.equal(matchesEvalAudit(index, "start a focus session", "2026-10-06T16:35:55.000Z"), false);
  assert.equal(matchesEvalAudit(index, "did you send it", "2026-09-20T10:00:10.000Z"), true);
});

test("scripted: most of a session's long sentences recur verbatim in ≥3 sessions; a routine phrase alone does not", () => {
  const codename = "What's the fixture codename for the benchmark work?";
  const routine = "start a focus session until 8";
  const files = new Map([
    ["a", [codename, "hey"]], ["b", [codename, "hey"]], ["c", [codename]],
    ["d", [routine, "move gym to six tonight please", "what is on my plan today"]],
    ["e", [routine, "turn the lights down to twenty percent", "remind me to call mom at six"]],
    ["f", [routine, "how much water did I drink today", "push dinner back thirty minutes"]],
  ]);
  assert.deepEqual([...scriptedFiles(files)].sort(), ["a", "b", "c"]);
});

test("a real keyed session with one probe turn keeps its other turns", () => {
  const sessions = [{ file: "real", key: "agent:main:orion-app-v2", turns: [
    turn(1, "Read-only probe. Search the web for the headline"), turn(2, "move gym to 6"), turn(3, "thanks"),
  ] }];
  const [s] = judgeSessions(sessions, { says: new Set(), audit: index });
  assert.equal(s.excluded, null);
  assert.deepEqual(s.turns.map((t) => t.line), [2, 3]);
});

test("Nick's real one-turn session survives its sentence being reused as a hard scenario", () => {
  const says = new Set(["redo my entire schedule"]);
  const [keyed] = judgeSessions([{ file: "k", key: "agent:main:orion-chat-1", turns: [turn(1, "redo my entire schedule")] }], { says, audit: index });
  assert.equal(keyed.excluded, null);
  assert.equal(keyed.turns.length, 1);
});

test("keyless reset sessions: eval clock, a probe opener, scenario replays and audit matches exclude them; ordinary talk does not", () => {
  const says = new Set(["move study to 6"]);
  const judge = (turns) => judgeSessions([{ file: "x", key: null, turns }], { says, audit: index })[0].excluded;
  assert.equal(judge([turn(1, "what's next", undefined, true)]), "eval-clock");
  assert.equal(judge([turn(1, "Diagnostic, no delivery. Call messages_recent"), turn(2, "ok")]), "probe");
  assert.equal(judge([turn(1, "move study to 6")]), "replay");
  assert.equal(judge([turn(1, "class just ran 30 min late", "2026-09-29T13:33:00.000Z")]), "replay");
  assert.equal(judge([turn(1, "move study to 6"), turn(2, "and push dinner"), turn(3, "thanks")]), null);
});

test("eval-keyed sessions are excluded whole", () => {
  const [s] = judgeSessions([{ file: "e", key: "agent:main:orion-eval-sched-1", turns: [turn(1, "move gym")] }], { says: new Set(), audit: index });
  assert.equal(s.excluded, "eval-key");
});

test("chat copies of excluded or probe turns are dropped too", () => {
  const excluded = [turn(1, "class just ran 30 min late", "2026-09-29T13:33:00.000Z")];
  const chats = [
    { userText: "class just ran 30 min late", at: "2026-09-29T13:33:30Z" },
    { userText: "Read-only probe. x", at: "2026-09-29T14:00:00Z" },
    { userText: "lights off", at: "2026-09-29T21:00:00Z" },
  ];
  assert.deepEqual(dropEvalChatTurns(chats, excluded, index).map((c) => c.userText), ["lights off"]);
});
