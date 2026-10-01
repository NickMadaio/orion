import test from "node:test";
import assert from "node:assert/strict";
import {
  focusBlock,
  judgeActivity,
  nextStep,
  MAC_STEPS,
} from "../scripts/lib/focus/escalation.mjs";

test("no focus block means no action", () => {
  const blocks = [];
  const now = 600;
  const block = focusBlock(blocks, now);
  assert.equal(block, null);

  const state = { blockId: null, offSince: null, lastStep: "none", snoozeUntil: null, phoneWarnedAt: null };
  const result = nextStep(state, { now, block: null, activity: { app: "Safari", title: "", idleSeconds: 0 }, phone: { minutesInUse: 0 } });
  
  assert.equal(result.mac, "none");
  assert.equal(result.phone, "none");
});

test("a nap, a meal or a real class is not a focus block", () => {
  const blocks = [
    { id: "nap", title: "Nap time", kind: "rest", start: 600, end: 700, fixed: true, source: "orion" },
    { id: "lunch", title: "Lunch", kind: "meal", start: 700, end: 800, fixed: true, source: "orion" },
    { id: "real-class", title: "Math 101", kind: "class", start: 900, end: 1000, fixed: true, source: "google" },
    { id: "study", title: "Study Math", kind: "study", start: 1000, end: 1100, fixed: false, source: "orion" },
  ];

  assert.equal(focusBlock(blocks, 650), null); // nap
  assert.equal(focusBlock(blocks, 750), null); // lunch
  assert.equal(focusBlock(blocks, 950), null); // real class
  assert.ok(focusBlock(blocks, 1050)); // study is focus
});

test("instagram during study climbs one step at a time", () => {
  const block = { id: "study-1", title: "Study Math", kind: "study", start: 600, end: 900, fixed: false, source: "orion" };
  const activity = { app: "Instagram", title: "", idleSeconds: 0 };
  
  let state = { blockId: null, offSince: null, lastStep: "none", snoozeUntil: null, phoneWarnedAt: null };
  
  // T=600. New block. Off task. offSince=600. Time off=0. Step=none? 
  // Ladder: >=2 min nudge. So at 0 mins, it's none.
  let result = nextStep(state, { now: 600, block, activity, phone: { minutesInUse: 0 }, allow: [] });
  assert.equal(result.mac, "none");
  state = result.state;

  // T=601. Time off=1. Still none.
  result = nextStep(state, { now: 601, block, activity, phone: { minutesInUse: 0 }, allow: [] });
  assert.equal(result.mac, "none");
  state = result.state;

  // T=602. Time off=2. Nudge.
  result = nextStep(state, { now: 602, block, activity, phone: { minutesInUse: 0 }, allow: [] });
  assert.equal(result.mac, "nudge");
  state = result.state;

  // T=603. Time off=3. Target nudge (1). Last step nudge (1). Next min(1, 2) = 1 -> nudge.
  result = nextStep(state, { now: 603, block, activity, phone: { minutesInUse: 0 }, allow: [] });
  assert.equal(result.mac, "nudge");
  state = result.state;

  // T=605. Time off=5. Target say (2). Last step nudge (1). Next min(2, 2) = 2 -> say.
  result = nextStep(state, { now: 605, block, activity, phone: { minutesInUse: 0 }, allow: [] });
  assert.equal(result.mac, "say");
  state = result.state;

  // T=610. Time off=10. Target front (3). Last step say (2). Next min(3, 3) = 3 -> front.
  result = nextStep(state, { now: 610, block, activity, phone: { minutesInUse: 0 }, allow: [] });
  assert.equal(result.mac, "front");
  state = result.state;

  // T=620. Time off=20. Target lock (5). Last step front (3). Next min(5, 4) = 4 -> quit.
  result = nextStep(state, { now: 620, block, activity, phone: { minutesInUse: 0 }, allow: [] });
  assert.equal(result.mac, "quit");
  state = result.state;

  // T=630. Time off=30. Target lock (5). Last step quit (4). Next min(5, 5) = 5 -> lock.
  result = nextStep(state, { now: 630, block, activity, phone: { minutesInUse: 0 }, allow: [] });
  assert.equal(result.mac, "lock");
});

test("coming back on task resets the ladder", () => {
  const block = { id: "study-1", title: "Study Math", kind: "study", start: 600, end: 900, fixed: false, source: "orion" };
  
  let state = { blockId: null, offSince: null, lastStep: "none", snoozeUntil: null, phoneWarnedAt: null };
  
  // Go off task.
  let result = nextStep(state, { now: 600, block, activity: { app: "Instagram", title: "", idleSeconds: 0 }, phone: { minutesInUse: 0 } });
  state = result.state;
  
  result = nextStep(state, { now: 602, block, activity: { app: "Instagram", title: "", idleSeconds: 0 }, phone: { minutesInUse: 0 } });
  assert.equal(result.mac, "nudge");
  state = result.state;

  // Come back on task.
  result = nextStep(state, { now: 603, block, activity: { app: "VS Code", title: "math.js", idleSeconds: 0 }, phone: { minutesInUse: 0 } });
  assert.equal(result.mac, "none");
  assert.equal(result.state.offSince, null);
  assert.equal(result.state.lastStep, "none");
});

test("a youtube video about the block's topic is on task", () => {
  const block = { id: "study-1", title: "Study Advanced Calculus", kind: "study", start: 600, end: 900, fixed: false, source: "orion" };
  
  // Related video.
  let result = judgeActivity(block, { app: "YouTube", title: "Advanced Calculus Tutorial", idleSeconds: 0 });
  assert.equal(result.onTask, true);

  // Unrelated video.
  result = judgeActivity(block, { app: "YouTube", title: "Cat Videos", idleSeconds: 0 });
  assert.equal(result.onTask, false);
});

test("an allowed app is on task", () => {
  const block = { id: "study-1", title: "Study Math", kind: "study", start: 600, end: 900, fixed: false, source: "orion" };
  
  // Allowed.
  let result = judgeActivity(block, { app: "Spotify", title: "", idleSeconds: 0 }, { allow: ["spotify"] });
  assert.equal(result.onTask, true);

  // Not allowed.
  result = judgeActivity(block, { app: "Spotify", title: "", idleSeconds: 0 }, { allow: [] });
  // Spotify is not in the bad list, so it's on task by default? 
  // Brief: "otherwise on task". Yes.
  assert.equal(result.onTask, true);
});

test("a snooze silences everything until it ends", () => {
  const block = { id: "study-1", title: "Study Math", kind: "study", start: 600, end: 900, fixed: false, source: "orion" };
  
  let state = { blockId: null, offSince: null, lastStep: "none", snoozeUntil: 700, phoneWarnedAt: null };
  
  // Before snooze ends.
  let result = nextStep(state, { now: 650, block, activity: { app: "Instagram", title: "", idleSeconds: 0 }, phone: { minutesInUse: 20 } });
  assert.equal(result.mac, "none");
  assert.equal(result.phone, "none"); // Phone rules also silenced? Brief says "no focus block or snooze -> none". Yes.
  
  // After snooze ends.
  result = nextStep(state, { now: 701, block, activity: { app: "Instagram", title: "", idleSeconds: 0 }, phone: { minutesInUse: 20 } });
  assert.equal(result.mac, "none"); // offSince reset? No, new block logic applies if blockId changed. Here blockId is null in state, so it's a new block start.
  // Wait, state.blockId is null. Block.id is "study-1". So isNewBlock is true.
  // Resets offSince, lastStep, phoneWarnedAt.
  // Then judge activity: off task. offSince=701. Time off=0. Mac none.
  // Phone: minutesInUse=20 >= 15 -> block.
  assert.equal(result.phone, "block");
});

test("phone use warns at 10 minutes once and blocks at 15", () => {
  const block = { id: "study-1", title: "Study Math", kind: "study", start: 600, end: 900, fixed: false, source: "orion" };
  
  let state = { blockId: null, offSince: null, lastStep: "none", snoozeUntil: null, phoneWarnedAt: null };
  
  // 10 mins.
  let result = nextStep(state, { now: 600, block, activity: { app: "VS Code", title: "", idleSeconds: 0 }, phone: { minutesInUse: 10 } });
  assert.equal(result.phone, "warn");
  state = result.state;

  // 12 mins. Still warned.
  result = nextStep(state, { now: 602, block, activity: { app: "VS Code", title: "", idleSeconds: 0 }, phone: { minutesInUse: 12 } });
  assert.equal(result.phone, "none");
  state = result.state;

  // 15 mins. Block.
  result = nextStep(state, { now: 605, block, activity: { app: "VS Code", title: "", idleSeconds: 0 }, phone: { minutesInUse: 15 } });
  assert.equal(result.phone, "block");
});

test("a new block starts the ladder over", () => {
  const block1 = { id: "study-1", title: "Study Math", kind: "study", start: 600, end: 700, fixed: false, source: "orion" };
  const block2 = { id: "study-2", title: "Study Physics", kind: "study", start: 700, end: 800, fixed: false, source: "orion" };
  
  let state = { blockId: null, offSince: null, lastStep: "none", snoozeUntil: null, phoneWarnedAt: null };
  
  // Off task on block1.
  let result = nextStep(state, { now: 600, block: block1, activity: { app: "Instagram", title: "", idleSeconds: 0 }, phone: { minutesInUse: 0 } });
  state = result.state;
  
  result = nextStep(state, { now: 602, block: block1, activity: { app: "Instagram", title: "", idleSeconds: 0 }, phone: { minutesInUse: 0 } });
  assert.equal(result.mac, "nudge");
  state = result.state;

  // Switch to block2.
  result = nextStep(state, { now: 700, block: block2, activity: { app: "Instagram", title: "", idleSeconds: 0 }, phone: { minutesInUse: 0 } });
  assert.equal(result.mac, "none"); // offSince reset to 700. Time off=0.
  assert.equal(result.state.offSince, 700);
  assert.equal(result.state.lastStep, "none");
});

test("inputs are not mutated", () => {
  const block = { id: "study-1", title: "Study Math", kind: "study", start: 600, end: 900, fixed: false, source: "orion" };
  const activity = { app: "Instagram", title: "", idleSeconds: 0 };
  const phone = { minutesInUse: 10 };
  const state = { blockId: null, offSince: null, lastStep: "none", snoozeUntil: null, phoneWarnedAt: null };
  
  // Deep copy for comparison.
  const stateCopy = JSON.parse(JSON.stringify(state));
  const activityCopy = JSON.parse(JSON.stringify(activity));
  const phoneCopy = JSON.parse(JSON.stringify(phone));
  const blockCopy = JSON.parse(JSON.stringify(block));

  nextStep(state, { now: 600, block, activity, phone });

  assert.deepEqual(state, stateCopy);
  assert.deepEqual(activity, activityCopy);
  assert.deepEqual(phone, phoneCopy);
  assert.deepEqual(block, blockCopy);
});
