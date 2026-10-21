import { describe, expect, it } from "vitest";
import { REPLY_FAILED, mailReadFailed, sanitizeReply } from "./reply-sanitize.js";
describe("sanitizeReply (H4, r8b2 2026-10-16)", () => {
    it("q069: an oauth/URL dump becomes one sign-in line", () => {
        const raw = 'I tried. Get "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=x": oauth2: "invalid_grant" "Token has been expired or revoked."';
        expect(sanitizeReply(raw, { mailFailed: true })).toBe("Gmail's sign-in expired — run `gog auth add nmadaio08@gmail.com` to reconnect.");
    });
    it("q070: a trailing Exec failed line is removed", () => {
        expect(sanitizeReply("Nothing matched.\n⚠️ 🛠️ Exec failed: `~/Desktop/ORION/scripts/orion-gmail-search \"x\"`")).toBe("Nothing matched.");
    });
    it("drops banners, flag lines and 'If he meant'", () => {
        const raw = "Your gym moved.\nNOTHING WAS BOOKED: no room.\nRun orion-reschedule `scripts/orion-reschedule add x --date 2026-10-16`.\nIf he meant tomorrow, say so.";
        expect(sanitizeReply(raw)).toBe("Your gym moved.\nNothing was booked: no room.\nRun orion-reschedule."); // review 6 H-B: the honest line stays, in plain words
    });
    it("a reply that was only raw gets a plain failure line; clean replies are untouched", () => {
        expect(sanitizeReply("⚠️ 🛠️ Exec failed: `orion-x`")).toBe(REPLY_FAILED);
        for (const ok of ["Your CS Lab starts at 7:25 PM.", "NOTE: bring your laptop.", "Sure — it's NOT a problem."])
            expect(sanitizeReply(ok)).toBe(ok);
    });
    // review 5 H1 (2026-10-16 r8b): span removal, never a whole line; raw-error rules only after a failed mail read.
    it("real answers that mention OAuth, permissions or links pass through", () => {
        for (const ok of [
            "OAuth is a way for apps to log in on your behalf without your password.",
            "Your OAuth2 token flow in the project uses PKCE.",
            "The build failed with authorization denied on the keychain.",
            "That macOS error 'Operation not permitted' means Terminal needs Full Disk Access.",
            "Your Zoom link for MKTG2201 is https://northeastern.zoom.us/j/123456.",
            "Here's the link: https://canvas.northeastern.edu/courses/123\nIt's due Friday.",
            "You have MKTG2201 and ECON1115 today.", "NASA launches at 3 PM.", "FYI ASAP: finish the essay.",
            "Next up:\nCHEM LAB: 1:30 PM to 3:00 PM\nECON 1115: 3:30 PM",
            "The site is example.com and the docs are at docs.example.com/setup.",
            "Your next class is ECON1115 at 3:30 PM — about 25 minutes from now.",
        ])
            expect(sanitizeReply(ok)).toBe(ok);
    });
    it("removes only the matched span and keeps the real sentences", () => {
        expect(sanitizeReply("Sure. I ran `orion-agenda today` and you have two classes.")).toBe("Sure. I ran and you have two classes.");
        expect(sanitizeReply("I tried --date 2026-10-17 and nothing came back.")).toBe("I tried and nothing came back.");
        expect(sanitizeReply("Exec failed: `~/Desktop/ORION/scripts/orion-gmail-search x`")).toBe(REPLY_FAILED);
        expect(sanitizeReply("You have two classes. ⚠️ 🛠️ Exec failed: `orion-x`")).toBe("You have two classes.");
    });
    it("known tool banners are said in plain words (review 6 H-B), other all-caps labels are untouched", () => {
        expect(sanitizeReply("NOTHING WAS BOOKED: Walk did not fit.\nWant me to try later?")).toBe("Nothing was booked: Walk did not fit.\nWant me to try later?");
        expect(sanitizeReply("CHEM LAB: 1:30 PM")).toBe("CHEM LAB: 1:30 PM");
    });
    it("the sign-in line is said only after a failed mail read; the raw shape is cut on any turn (review 6 M-D)", () => {
        const raw = 'Get "https://gmail.googleapis.com/x": oauth2: "invalid_grant"';
        expect(sanitizeReply(raw)).toBe(REPLY_FAILED);
        expect(sanitizeReply(raw, { mailFailed: true })).toBe("Gmail's sign-in expired — run `gog auth add nmadaio08@gmail.com` to reconnect.");
        expect(sanitizeReply("Operation not permitted", { mailFailed: true })).toBe("I can't read your texts — ORION needs Full Disk Access.");
        expect(mailReadFailed([{ canonical: 'exec orion-gmail-search "x"', stdout: "oops", exit: 1 }])).toBe(true);
        expect(mailReadFailed([{ canonical: 'exec orion-messages recent 3', stdout: 'Get "https://x": oauth2: "invalid_grant"', exit: null }])).toBe(true);
        expect(mailReadFailed([{ canonical: "exec orion-agenda today", stdout: "invalid_grant", exit: 1 }])).toBe(false);
        expect(mailReadFailed([{ canonical: 'exec orion-gmail-search "x"', stdout: "3 results", exit: 0 }])).toBe(false);
    });
});
