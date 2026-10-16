import { describe, expect, it } from "vitest";
import { REPLY_FAILED, sanitizeReply } from "./reply-sanitize.js";

describe("sanitizeReply (H4, r8b2 2026-10-16)", () => {
  it("q069: an oauth/URL dump becomes one sign-in line", () => {
    const raw = 'I tried. Get "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=x": oauth2: "invalid_grant" "Token has been expired or revoked."';
    expect(sanitizeReply(raw)).toBe("I can't read your Gmail right now — it needs signing in again.");
  });
  it("q070: a trailing Exec failed line is removed", () => {
    expect(sanitizeReply("Nothing matched.\n⚠️ 🛠️ Exec failed: `~/Desktop/ORION/scripts/orion-gmail-search \"x\"`")).toBe("Nothing matched.");
  });
  it("drops banners, flag lines and 'If he meant'", () => {
    const raw = "Your gym moved.\nNOTHING WAS BOOKED: no room.\nRun orion-reschedule `scripts/orion-reschedule add x --date 2026-10-16`.\nIf he meant tomorrow, say so.";
    expect(sanitizeReply(raw)).toBe("Your gym moved.");
  });
  it("a reply that was only raw gets a plain failure line; clean replies are untouched", () => {
    expect(sanitizeReply("⚠️ 🛠️ Exec failed: `orion-x`")).toBe(REPLY_FAILED);
    for (const ok of ["Your CS Lab starts at 7:25 PM.", "NOTE: bring your laptop.", "Sure — it's NOT a problem."]) expect(sanitizeReply(ok)).toBe(ok);
  });
});
