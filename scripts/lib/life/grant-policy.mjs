/**
 * Convert minutes after midnight to a 12-hour clock string like "8:15 PM".
 */
function minuteToClock(m) {
	const h = Math.floor(m / 60) % 24;
	const mm = m % 60;
	const period = h < 12 ? "AM" : "PM";
	const h12 = h === 0 ? 12 : (h > 12 ? h - 12 : h);
	return `${h12}:${String(mm).padStart(2, "0")} ${period}`;
}

/**
 * Check if a reason is empty or just polite filler.
 */
function isEmptyReason(reason) {
	if (reason == null || reason.trim() === "") return true;
	const lower = reason.trim().toLowerCase();
	return ["please", "pretty please", "pls"].includes(lower);
}

/**
 * Decide how many minutes of extra phone time to grant.
 *
 * @param {{ now: { date: string, minute: number }, asked: number, reason: string|null, lock: { why: string, untilMinute: number }, firstCommitment: number|null, grantsTonight: number, sleepHours?: number }} opts
 * @returns {{ grant: number, say: string }}
 */
export function decideGrant({ now, asked, reason, lock, firstCommitment, grantsTonight, sleepHours = 8 }) {
	// --- validation (Decision 1) ---
	if (!Number.isInteger(asked) || asked < 1 || asked > 600) {
		throw new TypeError(`asked must be an integer 1..600, got ${asked}`);
	}
	if (!Number.isInteger(now.minute) || now.minute < 0 || now.minute > 1439) {
		throw new TypeError(`now.minute must be an integer 0..1439, got ${now.minute}`);
	}

	const isNight = lock.why === "night" || now.minute < 360;
	const isWork = lock.why === "work" || lock.why === "checkin";

	let grant = 0;
	let say = "";

	// --- Decision 3: twice tonight limit (checked before type-specific logic) ---
	if (grantsTonight >= 2) {
		grant = 0;
		say = isNight
			? "That's twice already tonight. Phone down — bed."
			: "That's twice already — back to it.";
		return { grant, say };
	}

	// --- Decision 4: Night lock ---
	if (isNight) {
		if (isEmptyReason(reason)) {
			grant = 0;
			say = "No reason, no time — it's past bedtime. Tell me what it's for and I can give you 10.";
		} else {
			// with a reason: grant = min(asked, 20)
			grant = Math.min(asked, 20);

			// sleep check: if firstCommitment is set, compute remaining sleep
			if (firstCommitment != null) {
				let sleepLeft;
				// "when now is before midnight" -> interpreted as now.minute > firstCommitment
				// (i.e., late evening/night, commitment is next morning)
				if (now.minute > firstCommitment) {
					sleepLeft = firstCommitment + 1440 - now.minute - grant;
				} else {
					// early morning, commitment is later today
					sleepLeft = firstCommitment - now.minute - grant;
				}
				const threshold = sleepHours * 60 - 60;
				if (sleepLeft < threshold) {
					grant = Math.min(grant, 10);
				}
			}

			// Decision 2: hard cap — never past lock.untilMinute
			// Handle wrap-around midnight for night locks
			let remainingUntilLock;
			if (lock.untilMinute < now.minute) {
				remainingUntilLock = (1440 - now.minute) + lock.untilMinute;
			} else {
				remainingUntilLock = lock.untilMinute - now.minute;
			}
			grant = Math.min(grant, remainingUntilLock);
			grant = Math.min(grant, 60);
			grant = Math.max(grant, 0);

			const endMinute = (now.minute + grant) % 1440;
			say = `Unlocked for ${grant} min — ${minuteToClock(endMinute)}. Then it locks again.`;
		}
	}
	// --- Decision 5: Work lock ---
	else if (isWork) {
		if (!isEmptyReason(reason)) {
			grant = Math.min(asked, 15);
		} else {
			grant = 0;
			say = "You planned this block. Finish it or tell me why you need the phone.";
		}

		// Decision 2: hard cap — never past lock.untilMinute, never more than 60
		let remainingUntilLock;
		if (lock.untilMinute < now.minute) {
			remainingUntilLock = (1440 - now.minute) + lock.untilMinute;
		} else {
			remainingUntilLock = lock.untilMinute - now.minute;
		}
		grant = Math.min(grant, remainingUntilLock);
		grant = Math.min(grant, 60);
		grant = Math.max(grant, 0);

		if (grant > 0 && say === "") {
			const endMinute = (now.minute + grant) % 1440;
			say = `Unlocked for ${grant} min — ${minuteToClock(endMinute)}. Then it locks again.`;
		}
	}

	// --- Decision 6: suffix when asked > grant and grant > 0 ---
	if (asked > grant && grant > 0) {
		say += ` (asked for ${asked}; ${grant} is what I'll do.)`;
	}

	return { grant, say };
}
