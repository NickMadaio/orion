import { strict as assert } from "node:assert";

/**
 * Determine whether a focus session is active, mirroring the automation host's legacy reading.
 *
 * @param {object|null|undefined} focusJson - Parsed contents of focus.json, or null if missing.
 * @param {number} now - Current time in ms.
 * @returns {true|false|null} true if focusing, false if not, null if unknown/malformed.
 */
export function focusActiveFrom(focusJson, now) {
	if (focusJson === null) {
		return false;
	}

	if (typeof focusJson !== "object" || focusJson === undefined) {
		return null;
	}

	const session = focusJson.session;

	if (session === null) {
		return false;
	}

	if (
		session != null &&
		typeof session.until === "number" &&
		Number.isSafeInteger(session.until) &&
		session.until > 0
	) {
		return now <= session.until;
	}

	return null;
}

/**
 * Produce attention items from focus-history rows.
 *
 * Files a low-priority "no_focus_today" item when today's served focus is zero
 * and the UTC hour is 15 or later.
 *
 * @param {unknown} rows - Parsed JSONL lines (should be an array of objects).
 * @param {{ now: number }} options - Fixed clock.
 * @returns {object[]} Array of attention items (0 or 1).
 */
export function fromFocusHistory(rows, { now }) {
	if (!Array.isArray(rows)) {
		return [];
	}

	const nowDate = new Date(now);
	const todayStr = nowDate.toISOString().slice(0, 10); // "YYYY-MM-DD"

	let totalServed = 0;

	for (const row of rows) {
		if (typeof row !== "object" || row === null) {
			continue;
		}

		const startedAtStr = row.startedAt;
		if (typeof startedAtStr !== "string") {
			continue;
		}

		const parsed = Date.parse(startedAtStr);
		if (Number.isNaN(parsed)) {
			continue;
		}

		const rowDate = new Date(parsed).toISOString().slice(0, 10);
		if (rowDate !== todayStr) {
			continue;
		}

		const served = row.servedFocusSeconds;
		if (typeof served !== "number" || !Number.isFinite(served)) {
			continue;
		}

		totalServed += served;
	}

	const utcHour = nowDate.getUTCHours();

	if (totalServed === 0 && utcHour >= 15) {
		const expiresAt = Date.parse(`${todayStr}T23:59:59Z`);
		return [
			{
				id: `focus:none:${todayStr}`,
				source: "focus",
				kind: "no_focus_today",
				title: "No focus session yet today",
				detail: "",
				observedAt: now,
				dueAt: null,
				expiresAt,
				dedupKey: `focus:none:${todayStr}`,
				signals: {
					urgency: 0.2,
					actionability: 0.5,
					confidence: 0.7,
					novelty: null,
					importance: null,
					interruptibility: null,
				},
			},
		];
	}

	return [];
}
