// The port against the REAL Swift. Goldens come from native/Orion/Tests/run-gate-parity-test.sh, which
// compiles ThinkingPolicy, OutreachContext, SchedulingMemory and LocalRoutingMode from the app's sources
// and runs them over fixtures/parity-inputs.json. Regenerate them with that script after changing either side.
// Optional: GATE_PARITY_LIVE=1 also runs Nick's real SCHEDULING.md through both (needs swiftc).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentRequest, CONTINUATION_PREFIX, SPOKEN_SUFFIX, needsReasoning, thinkingLevel, schedulingContext, outreachPrefix,
  parseOutreach, initialTracker, struggled } from "../prefix.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../../../..");
const load = (f) => JSON.parse(readFileSync(join(HERE, "../fixtures", f), "utf8"));
const inputs = load("parity-inputs.json");
const goldens = load("parity-goldens.json");
const ms = (iso) => Date.parse(iso);
const byName = (list) => new Map(list.map((x) => [x.name, x]));

test("fixtures: at least 10 cases per area and every input has a golden", () => {
  for (const key of ["thinking", "scheduling", "outreach", "struggled"]) {
    assert.ok(inputs[key].length >= 6, key);
    assert.deepEqual(goldens[key].map((g) => g.name), inputs[key].map((i) => i.name), `${key} goldens out of date: rerun run-gate-parity-test.sh`);
  }
  assert.ok(inputs.thinking.length + inputs.scheduling.length + inputs.outreach.length + inputs.struggled.length >= 10);
});

test("ThinkingPolicy.level and needsReasoning match Swift", () => {
  const g = byName(goldens.thinking);
  for (const c of inputs.thinking) {
    const want = g.get(c.name);
    assert.equal(needsReasoning(c.text), want.needsReasoning, `${c.name}: needsReasoning`);
    const got = thinkingLevel({ text: c.text, model: c.model, boostedUntil: c.boostedUntil ? ms(c.boostedUntil) : null, now: ms(c.now) });
    assert.equal(got, want.level, `${c.name}: level`);
  }
});

test("SchedulingMemory.context matches Swift byte for byte", () => {
  const g = byName(goldens.scheduling);
  for (const c of inputs.scheduling) {
    const got = schedulingContext({ text: c.text, routing: { mode: c.mode, scheduleToCloud: c.scheduleToCloud }, rules: c.rules });
    assert.equal(got, g.get(c.name).context, c.name);
  }
});

test("OutreachTracker.prefix matches Swift across a sequence of turns", () => {
  const g = byName(goldens.outreach);
  for (const c of inputs.outreach) {
    const rows = parseOutreach(c.jsonl);
    let tracker = initialTracker();
    const got = c.steps.map((s) => {
      const r = outreachPrefix({ rows, now: ms(s.now), replyTo: s.replyTo, state: tracker });
      tracker = r.state;
      return r.prefix;
    });
    assert.deepEqual(got, g.get(c.name).prefixes, c.name);
  }
});

test("ThinkingPolicy.struggled matches Swift", () => {
  const g = byName(goldens.struggled);
  for (const c of inputs.struggled) assert.equal(struggled(c.transcript, ms(c.since)), g.get(c.name).struggled, c.name);
});

// agentRequest is private to AppState (a UI class), so it cannot be compiled into the Swift harness.
// Instead its template is read out of AppState.swift and compared line by line with the port.
function swiftTemplate() {
  const src = readFileSync(join(REPO, "native/Orion/Sources/Orion/AppState.swift"), "utf8");
  const at = src.indexOf("private func agentRequest(");
  assert.ok(at > 0, "agentRequest not found in AppState.swift");
  const body = src.slice(at);
  const open = body.indexOf('return """\n');
  const close = body.indexOf('"""', open + 11);
  const lines = body.slice(open + 11, close).split("\n");
  const indent = lines.at(-1);   // the closing delimiter's own indentation is what Swift strips
  assert.match(indent, /^\s*$/);
  return lines.slice(0, -1).map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l));
}

test("agentRequest: the port's template is the one in AppState.swift", () => {
  const swift = swiftTemplate();
  const status = { status: "running", phase: "focus", task: "Lab\nreport", blockNumber: 1, totalBlocks: 3, enforcement: "firm" };
  const typed = agentRequest({ userText: "USERTEXT", spoken: false, sessionStatus: status, allowedApps: ["Safari", "Notes"] }).split("\n");
  const spoken = agentRequest({ userText: "USERTEXT", spoken: true, sessionStatus: status, allowedApps: ["Safari", "Notes"] }).split("\n");
  assert.equal(typed.length, swift.length, "line count");
  assert.equal(spoken.length, swift.length);
  swift.forEach((line, i) => {
    if (!line.includes("\\(")) assert.equal(typed[i], line, `static line ${i}`);
  });
  // The three interpolated lines and the user text sit where Swift puts them.
  assert.ok(swift[1].startsWith("Focus session: \\(") && typed[1] === "Focus session: active; focus, block 1 of 3, user-set task: Lab report.");
  assert.ok(swift[2].startsWith("Firm enforcement: \\(") && typed[2] === "Firm enforcement: active.");
  assert.ok(swift[3].startsWith("Temporary allowed work apps: \\(") && typed[3] === "Temporary allowed work apps: Notes, Safari.");
  assert.equal(swift.at(-1), "\\(userText)");
  assert.equal(typed.at(-1), "USERTEXT");
  // The spoken line: typed leaves it empty, spoken fills it with exactly the Swift literal.
  const spokenLine = swift.findIndex((l) => l.includes("Nick SAID this out loud"));
  assert.ok(spokenLine > 0);
  assert.equal(typed[spokenLine], "");
  assert.equal(spoken[spokenLine], SPOKEN_SUFFIX);
  assert.ok(swift[spokenLine].includes(SPOKEN_SUFFIX.replaceAll('"', '\\"')), "spoken suffix differs from AppState.swift");
});

test("agentRequest: inactive session, unnamed task, current block, enforcement words", () => {
  const base = { userText: "x" };
  assert.match(agentRequest({ ...base, sessionStatus: { status: "finished", enforcement: "off" } }), /Focus session: inactive\.\nFirm enforcement: not active\./);
  assert.match(agentRequest({ ...base, sessionStatus: { status: "paused" } }), /active; focus, current block, user-set task: unnamed task\./);
  assert.match(agentRequest({ ...base, sessionStatus: { status: "waiting-for-return", enforcement: "disengaged" } }), /Firm enforcement: active\./);
  assert.match(agentRequest({ ...base, sessionStatus: { status: "running", enforcement: "released" } }), /Firm enforcement: not active\./);
});

test("continuation prefix is the one in AppState.swift", () => {
  const src = readFileSync(join(REPO, "native/Orion/Sources/Orion/AppState.swift"), "utf8");
  assert.ok(src.includes(`userText = "${CONTINUATION_PREFIX}" + text`));
});

test("GatewayClient.ask builds recentOutreach + SchedulingMemory.context + request, in that order", () => {
  const src = readFileSync(join(REPO, "native/Orion/Sources/Orion/GatewayClient.swift"), "utf8");
  assert.ok(src.includes('"--message", recentOutreach(replyTo: replyTo) + SchedulingMemory.context(for: text) + text,'));
  assert.ok(src.includes('ThinkingPolicy.level(for: text, model: model, boostedUntil: boostedUntil(session))'));
  assert.ok(src.includes('"--session-key", session,') && src.includes('"--json",') && src.includes('String(Int(RunTimeouts.agentTimeout))'));
});

test("live SCHEDULING.md digest matches Swift (GATE_PARITY_LIVE=1)", { skip: process.env.GATE_PARITY_LIVE !== "1" }, () => {
  const sh = join(REPO, "native/Orion/Tests/run-gate-parity-test.sh");
  execFileSync(sh, ["--live"], { stdio: "pipe" });
  const live = JSON.parse(readFileSync(join(REPO, "native/Orion/Tests/.build/live-goldens.json"), "utf8")).live;
  const rules = readFileSync(join(process.env.HOME, ".openclaw/workspace/SCHEDULING.md"), "utf8");
  const config = JSON.parse(readFileSync(join(process.env.HOME, ".openclaw/openclaw.json"), "utf8"));
  const c = config.plugins.entries["orion-control"].config;
  for (const l of live) {
    const got = schedulingContext({ text: l.text, routing: { mode: c.localRouting ?? "off", scheduleToCloud: c.localRoutingScheduleToCloud === true }, rules });
    assert.equal(got, l.context, l.text);
  }
  assert.ok(existsSync(join(REPO, "native/Orion/Tests/.build/live-goldens.json")));
});
