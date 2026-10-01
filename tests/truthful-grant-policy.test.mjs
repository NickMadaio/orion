import { test } from "node:test";
import { strict as assert } from "node:assert";
import { decideGrant } from "../scripts/lib/life/grant-policy.mjs";

const nightLock = { why: "night", untilMinute: 420 }; // until 7:00 AM
const workLock = { why: "work", untilMinute: 1080 }; // until 6:00 PM

test("no reason past bedtime is a no with an offer", () => {
	const result = decideGrant({
		now: { date: "2026-10-01", minute: 1350 }, // 22:30
		asked: 20,
		reason: null,
		lock: nightLock,
		firstCommitment: null,
		grantsTonight: 0,
	});
	assert.equal(result.grant, 0);
	assert.equal(result.say, "No reason, no time — it's past bedtime. Tell me what it's for and I can give you 10.");
});

test("a reason past bedtime gets up to 20", () => {
	const result = decideGrant({
		now: { date: "2026-10-01", minute: 1350 }, // 22:30
		asked: 20,
		reason: "text my mom",
		lock: nightLock,
		firstCommitment: null,
		grantsTonight: 0,
	});
	assert.equal(result.grant, 20);
	assert.ok(result.say.includes("Unlocked for 20 min"));
});

test("an early class shrinks it to 10", () => {
	// now 01:30 (minute 90), asked 20, reason "text my mom", firstCommitment 480 (8:00)
	// sleep left = 480 - 90 - 20 = 370 < 420 → grant 10
	const result = decideGrant({
		now: { date: "2026-10-01", minute: 90 },
		asked: 20,
		reason: "text my mom",
		lock: nightLock,
		firstCommitment: 480,
		grantsTonight: 0,
	});
	assert.equal(result.grant, 10);
	assert.ok(result.say.includes("Unlocked for 10 min"));
});

test("never past the lock or 60 minutes", () => {
	// asked 120 at 23:30 with night lock until 7:00 (420)
	// max from lock = 420 - 1350 → negative, so grant capped by lock boundary
	// Actually 23:30 is minute 1410. untilMinute 420 means next day 7:00.
	// For night locks past midnight, the lock.untilMinute is on the same day scale?
	// Let's use a simpler case: asked 100 at minute 1380 (23:00), lock until 1440 (midnight)
	const result = decideGrant({
		now: { date: "2026-10-01", minute: 1380 },
		asked: 100,
		reason: "need to check something",
		lock: { why: "night", untilMinute: 1440 },
		firstCommitment: null,
		grantsTonight: 0,
	});
	assert.ok(result.grant <= 60);
	assert.ok(result.grant <= 1440 - 1380); // never past lock
});

test("twice tonight is the limit", () => {
	const result = decideGrant({
		now: { date: "2026-10-01", minute: 1350 },
		asked: 10,
		reason: "important",
		lock: nightLock,
		firstCommitment: null,
		grantsTonight: 2,
	});
	assert.equal(result.grant, 0);
	assert.equal(result.say, "That's twice already tonight. Phone down — bed.");

	const resultWork = decideGrant({
		now: { date: "2026-10-01", minute: 720 },
		asked: 10,
		reason: "important",
		lock: workLock,
		firstCommitment: null,
		grantsTonight: 2,
	});
	assert.equal(resultWork.grant, 0);
	assert.equal(resultWork.say, "That's twice already — back to it.");
});

test("work blocks give 15 with a reason", () => {
	const result = decideGrant({
		now: { date: "2026-10-01", minute: 720 }, // 12:00
		asked: 30,
		reason: "quick call",
		lock: workLock,
		firstCommitment: null,
		grantsTonight: 0,
	});
	assert.equal(result.grant, 15);

	const noReason = decideGrant({
		now: { date: "2026-10-01", minute: 720 },
		asked: 30,
		reason: null,
		lock: workLock,
		firstCommitment: null,
		grantsTonight: 0,
	});
	assert.equal(noReason.grant, 0);
	assert.equal(noReason.say, "You planned this block. Finish it or tell me why you need the phone.");
});

test("asking for more says what you get", () => {
	// asked 120 with reason at 23:30 → 20 and the suffix
	const result = decideGrant({
		now: { date: "2026-10-01", minute: 1410 }, // 23:30
		asked: 120,
		reason: "need to check something",
		lock: { why: "night", untilMinute: 420 },
		firstCommitment: null,
		grantsTonight: 0,
	});
	assert.equal(result.grant, 20);
	assert.ok(result.say.includes("(asked for 120; 20 is what I'll do.)"));
});

test("invalid input throws", () => {
	assert.throws(
		() => decideGrant({ now: { date: "2026-10-01", minute: 1350 }, asked: 0, reason: null, lock: nightLock, firstCommitment: null, grantsTonight: 0 }),
		TypeError
	);
	assert.throws(
		() => decideGrant({ now: { date: "2026-10-01", minute: 1350 }, asked: 601, reason: null, lock: nightLock, firstCommitment: null, grantsTonight: 0 }),
		TypeError
	);
	assert.throws(
		() => decideGrant({ now: { date: "2026-10-01", minute: -1 }, asked: 10, reason: null, lock: nightLock, firstCommitment: null, grantsTonight: 0 }),
		TypeError
	);
	assert.throws(
		() => decideGrant({ now: { date: "2026-10-01", minute: 1440 }, asked: 10, reason: null, lock: nightLock, firstCommitment: null, grantsTonight: 0 }),
		TypeError
	);
});
