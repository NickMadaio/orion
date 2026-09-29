import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyDeferral } from "../scripts/lib/life/deferral.mjs";

test("starving is a 25 minute pause", () => assert.deepEqual(classifyDeferral("I'm starving, eating first"), { kind: "pause", minutes: 25, confidence: 0.8 }));
test("a friend inviting me is a change", () => assert.equal(classifyDeferral("my friend invited me out").kind, "change"));
test("one more video is avoidance", () => assert.equal(classifyDeferral("one more video then I'll start").kind, "avoidance"));
test("repeated pauses lose confidence", () => assert.equal(classifyDeferral("need a shower", { deferralsToday: 2 }).confidence, 0.6));
test("an hour of dodging turns pauses into avoidance", () => assert.equal(classifyDeferral("gonna eat", { deferralsToday: 2, minutesAvoided: 70 }).kind, "avoidance"));
test("unknown reasons are unclear", () => assert.deepEqual(classifyDeferral("hmm"), { kind: "unclear", minutes: 10, confidence: 0.3 }));
