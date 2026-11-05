// Live 2026-11-04 11:21: a failed open went out as "I couldn't run that lookup just now. I could not do that." Said twice, and "lookup" for an app.
import { describe, expect, it } from "vitest";
import { finalizeReply } from "./reply-sanitize.js";
import { acknowledgesFailure } from "./tool-failure.js";

const failedOpen = [{ canonical: "app_open", stdout: 'Application "amazon uk" was not found in /Applications.', exit: 1 }];

describe("a failed turn owns the failure once", () => {
  it.each(["I could not do that.", "Sorry, I couldn't do that.", "I can't do it."])("%s is not said after the acknowledgement", (worker) => {
    const out = finalizeReply(worker, failedOpen, { hostTools: 1 });
    expect(out).not.toMatch(/Sorry|I can't do it|could not do that/);
    expect(out.match(/couldn't run that/g)?.length).toBe(1);
    expect(acknowledgesFailure(out)).toBe(true);
  });
  it("a worker sentence with real content still follows the acknowledgement", () => {
    const out = finalizeReply("Try the Safari app instead.", failedOpen, { hostTools: 1 });
    expect(out).toMatch(/Try the Safari app instead\.$/);
  });
});

describe("failure wording fits the action (11-03 13:58, 11-04 09:33, 11:20, 11:32)", () => {
  const quit = [{ canonical: "app_quit", stdout: "Application not running", exit: 1 }];
  it("a failed open is not a lookup", () => {
    const out = finalizeReply("I could not do that.", failedOpen, { hostTools: 1 });
    expect(out).not.toMatch(/lookup/i);
    expect(out).toMatch(/nothing opened/i);
    expect(acknowledgesFailure(out)).toBe(true);
  });
  it("a failed quit is not a lookup either", () => {
    const out = finalizeReply("I could not do that.", quit, { hostTools: 1 });
    expect(out).not.toMatch(/lookup/i);
    expect(acknowledgesFailure(out)).toBe(true);
  });
  it("the app search path list is never shown to him (11-04 11:34, 'why')", () => {
    const leaked = 'I could not do that. Application "amazon ik" was not found in /Applications, /Applications/Utilities, /System/Applications, /System/Applications/Utilities, /System/Library/CoreServices, /System/Library/CoreServices/Applications, /Users/nickmadaio/Applications.';
    const out = finalizeReply(leaked, [], {});
    expect(out).not.toMatch(/\/Applications|\/System|\/Users/);
    expect(out).toMatch(/amazon ik/);
  });
});
