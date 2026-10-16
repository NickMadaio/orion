// r8 review 6 (2026-10-16): offline Gmail is not a sign-in (H-A), the scheduler's honest NOT BOOKED lines are kept (H-B),
// praise is not a block title (H-C), device commands are not titles (M-A), a cut failure tail leaves no "Done." (M-B),
// raw error shapes are cut on every turn (M-D). Inputs are the reviewer's.
import { describe, expect, it } from "vitest";
import { sanitizeReply, REPLY_FAILED } from "./reply-sanitize.js";
import { failureLine } from "./messages-read.js";
import { titleAnswer } from "./schedule-pending.js";
const OFFLINE = `Get "https://gmail.googleapis.com/gmail/v1/users/me/threads?q=x": resettable oauth token source: oauth2: cannot fetch token: Post "https://oauth2.googleapis.com/token": dial tcp: lookup oauth2.googleapis.com: no such host`;
const GRANT = `Get "https://gmail.googleapis.com/gmail/v1/users/me/threads?q=x": read-only transport: oauth2: "invalid_grant" "Bad Request"`;
describe("H-A: offline is not 'sign in again'", () => {
    it("failureLine: network shapes win", () => {
        expect(failureLine({ kind: "gmail", query: "x" }, OFFLINE)).toBe("I couldn't reach Gmail just now.");
        expect(failureLine({ kind: "gmail", query: "x" }, GRANT)).toBe("I can't read your Gmail right now — it needs signing in again.");
    });
    it("sanitizer: offline dump → reach line; invalid_grant → sign-in; other Get error → generic", () => {
        expect(sanitizeReply(OFFLINE, { mailFailed: true })).toBe("I couldn't reach Gmail just now.");
        expect(sanitizeReply(GRANT, { mailFailed: true })).toBe("I can't read your Gmail right now — it needs signing in again.");
        expect(sanitizeReply(`Get "https://gmail.googleapis.com/x": 500 Internal Server Error`, { mailFailed: true })).toBe("I couldn't read your Gmail just now.");
    });
});
describe("H-B: NOT BOOKED / NOTHING WAS BOOKED lines are told, in plain words", () => {
    it("keeps the line, rewrites the label", () => {
        expect(sanitizeReply("I added Walk at 3:00 PM.\nNOT BOOKED: Laundry (no room before 9 PM).")).toBe("I added Walk at 3:00 PM.\nNot booked: Laundry (no room before 9 PM).");
        expect(sanitizeReply("NOTHING WAS BOOKED: Gym does not fit before 6 PM.\nWant me to try tomorrow?")).toBe("Nothing was booked: Gym does not fit before 6 PM.\nWant me to try tomorrow?");
    });
    it("other capitals pass", () => {
        expect(sanitizeReply("Next up:\nCHEM LAB: 1:30 PM")).toBe("Next up:\nCHEM LAB: 1:30 PM");
    });
});
describe("H-C / M-A: not titles", () => {
    for (const m of ["great idea", "nice one", "cool cool", "awesome sauce", "sounds great", "that's great", "good", "fine by me", "hm ok", "turn off the lights", "play some music", "open spotify", "set a timer", "pause music", "lights off", "unlock my phone", "log water"]) {
        it(`"${m}" is not booked`, () => expect(titleAnswer(m)).toBeNull());
    }
    for (const [m, t] of [["light jog", "Light jog"], ["open office hours", "Open office hours"], ["play rehearsal", "Play rehearsal"], ["pause and reflect journal", "Pause and reflect journal"], ["unlock bike", "Unlock bike"], ["great gatsby reading", "Great gatsby reading"], ["cool down stretch", "Cool down stretch"], ["call mom", "Call mom"], ["set up my desk", "Set up my desk"], ["log my expenses", "Log my expenses"], ["yes, laundry", "Laundry"]]) {
        it(`"${m}" is a title`, () => expect(titleAnswer(m)).toBe(t));
    }
});
describe("M-B / M-D / M-C", () => {
    it("a cut failure tail leaves no bare 'Done.'", () => {
        expect(sanitizeReply("Done. ⚠️ 🛠️ Exec failed: `~/Desktop/ORION/scripts/orion-reschedule move \"Gym\" --to 18:00`")).toBe(REPLY_FAILED);
    });
    it("an honest 'nothing changed' reply survives a cut tail (review 7 M2)", () => {
        expect(sanitizeReply("Nothing moved — Gym is not on Friday.\n⚠️ 🛠️ Exec failed: `~/Desktop/ORION/scripts/orion-reschedule move \"Gym\" --to 18:00`")).toBe("Nothing moved — Gym is not on Friday.");
    });
    it("a real answer before a cut tail stays", () => {
        expect(sanitizeReply("I checked your inbox.\n\n⚠️ 🛠️ Exec failed: `~/Desktop/ORION/scripts/orion-gmail-search \"from:northeastern is:unread\"`")).toBe("I checked your inbox.");
    });
    it("raw error shapes are cut even with no failed mail read this turn", () => {
        expect(sanitizeReply(`Earlier it said: ${GRANT}`)).toBe(REPLY_FAILED);
        expect(sanitizeReply(`Here's what happened.\n${GRANT}`)).toBe("Here's what happened.");
    });
    it("no garbled piece or URL before the failure line", () => {
        expect(sanitizeReply("The Gmail search failed with an invalid_grant error, so Gmail is not signed in.", { mailFailed: true })).toBe("I can't read your Gmail right now — it needs signing in again.");
        expect(sanitizeReply("The search failed: https://gmail.googleapis.com/x?q=x returned invalid_grant", { mailFailed: true })).toBe("I can't read your Gmail right now — it needs signing in again.");
    });
});
