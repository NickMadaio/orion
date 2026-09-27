import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { focusActiveFrom, fromFocusHistory } from "../scripts/lib/attention/sources/focus.mjs";

const NOW = Date.parse("2026-08-15T16:00:00Z"); // 16:00 UTC

describe("focus state follows the host's reading", () => {
	it("null (file missing) -> false", () => {
		assert.strictEqual(focusActiveFrom(null, NOW), false);
	});

	it("session === null -> false", () => {
		assert.strictEqual(focusActiveFrom({ session: null }, NOW), false);
	});

	it("session.until > now -> true", () => {
		const until = Date.parse("2026-08-15T17:00:00Z");
		assert.strictEqual(focusActiveFrom({ session: { until } }, NOW), true);
	});

	it("session.until === now -> true (now <= until)", () => {
		assert.strictEqual(focusActiveFrom({ session: { until: NOW } }, NOW), true);
	});

	it("session.until < now -> false", () => {
		const until = Date.parse("2026-08-15T14:00:00Z");
		assert.strictEqual(focusActiveFrom({ session: { until } }, NOW), false);
	});

	it("undefined input -> null", () => {
		assert.strictEqual(focusActiveFrom(undefined, NOW), null);
	});

	it("string input -> null", () => {
		assert.strictEqual(focusActiveFrom("garbage", NOW), null);
	});

	it("session without until -> null", () => {
		assert.strictEqual(focusActiveFrom({ session: {} }, NOW), null);
	});

	it("session.until not a safe integer (float) -> null", () => {
		assert.strictEqual(focusActiveFrom({ session: { until: 1.5 } }, NOW), null);
	});

	it("session.until zero -> null", () => {
		assert.strictEqual(focusActiveFrom({ session: { until: 0 } }, NOW), null);
	});

	it("session.until negative -> null", () => {
		assert.strictEqual(focusActiveFrom({ session: { until: -100 } }, NOW), null);
	});
});

describe("no focus by mid-afternoon files a gentle item", () => {
	it("now 16:00Z, rows only from yesterday -> one item", () => {
		const rows = [
			{ startedAt: "2026-08-14T10:00:00Z", servedFocusSeconds: 3600 },
		];
		const items = fromFocusHistory(rows, { now: NOW });
		assert.strictEqual(items.length, 1);
		const item = items[0];
		assert.strictEqual(item.id, "focus:none:2026-08-15");
		assert.strictEqual(item.source, "focus");
		assert.strictEqual(item.kind, "no_focus_today");
		assert.strictEqual(item.title, "No focus session yet today");
		assert.strictEqual(item.detail, "");
		assert.strictEqual(item.observedAt, NOW);
		assert.strictEqual(item.dueAt, null);
		assert.strictEqual(
			item.expiresAt,
			Date.parse("2026-08-15T23:59:59Z"),
		);
		assert.strictEqual(item.dedupKey, "focus:none:2026-08-15");
		assert.deepStrictEqual(item.signals, {
			urgency: 0.2,
			actionability: 0.5,
			confidence: 0.7,
			novelty: null,
			importance: null,
			interruptibility: null,
		});
	});
});

describe("some focus today, or too early, files nothing", () => {
	it("a today row with 600 s -> []", () => {
		const rows = [
			{ startedAt: "2026-08-15T09:00:00Z", servedFocusSeconds: 600 },
		];
		assert.deepStrictEqual(fromFocusHistory(rows, { now: NOW }), []);
	});

	it("now 10:00Z with no rows -> []", () => {
		const earlyNow = Date.parse("2026-08-15T10:00:00Z");
		assert.deepStrictEqual(fromFocusHistory([], { now: earlyNow }), []);
	});
});

describe("malformed rows are skipped", () => {
	it("[null, {startedAt: 'x'}] at 16:00Z -> one item", () => {
		const rows = [null, { startedAt: "x" }];
		const items = fromFocusHistory(rows, { now: NOW });
		assert.strictEqual(items.length, 1);
		assert.strictEqual(items[0].kind, "no_focus_today");
	});

	it("non-array input -> []", () => {
		assert.deepStrictEqual(fromFocusHistory(null, { now: NOW }), []);
		assert.deepStrictEqual(fromFocusHistory("bad", { now: NOW }), []);
	});

	it("row with non-finite servedFocusSeconds is skipped", () => {
		const rows = [
			{ startedAt: "2026-08-15T10:00:00Z", servedFocusSeconds: Infinity },
		];
		const items = fromFocusHistory(rows, { now: NOW });
		assert.strictEqual(items.length, 1); // treated as zero focus -> item at 16:00Z
	});

	it("row with missing startedAt is skipped", () => {
		const rows = [
			{ servedFocusSeconds: 300 },
		];
		const items = fromFocusHistory(rows, { now: NOW });
		assert.strictEqual(items.length, 1); // no valid today rows -> item
	});
});
