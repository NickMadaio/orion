// W10-A1 follow-up: "why" to something ORION sent is about THAT message, and a heads-up is a notice, never a check-in.
import { describe, expect, it } from "vitest";
import { asksWhy, outreachNote, parseOutreach, whyNote } from "./outreach-reply.js";
import { offerOf, readPendingTurn } from "./pending-reply.js";

const JACKET = "Heads up — take a jacket when you leave for the gym.";
const NOW = new Date("2026-11-02T15:00:00Z");
const push = (text: string) => ({ text, at: new Date(NOW.getTime() - 3 * 60_000).toISOString() });

describe("asksWhy", () => {
  for (const said of ["why", "why?", "huh", "wdym", "what for", "what do you mean", "why are you telling me to bring an umbrella", "whats that for", "how come", "why tho", "Why are you saying that?"]) {
    it(`reads "${said}" as a question about the message`, () => expect(asksWhy(said)).toBe(true));
  }
  for (const said of ["why is gym at 5 and not 6 on tuesdays when i said evenings", "yeah", "in 10", "move gym to 8", "what time is my class", ""]) {
    it(`does not read "${said}"`, () => expect(asksWhy(said)).toBe(false));
  }
});

describe("the worker is told what he is asking about", () => {
  const o = { text: JACKET, minutes: 3, kind: "info" as const };
  for (const said of ["why", "Why are you telling me to take a jacket?", "huh what for"]) {
    it(`"${said}"`, () => {
      const note = outreachNote(o, said);
      expect(note).toContain(JACKET);
      expect(note).toMatch(/asking WHY you sent that/);
      expect(note).toContain("weather_now for London");
      expect(note).toMatch(/not treat it as a check-in/);
    });
  }
  it("any other reply keeps the ordinary note", () => {
    expect(outreachNote(o, "ok")).not.toMatch(/asking WHY/);
    expect(outreachNote(o)).toMatch(/his reply/);
  });
  it("the label the Mac app adds is parsed, so the note has the text", () => {
    const parsed = parseOutreach(`[ORION context: you messaged him first, 2 min ago (info): "${JACKET}". His message below is most likely his reply to it.]\nwhy`);
    expect(parsed?.text).toBe(JACKET);
    expect(whyNote(parsed!.text, parsed!.minutes)).toContain("2 min ago");
  });
});

describe("a heads-up is a notice", () => {
  for (const text of [JACKET, "FYI the 5pm train is cancelled, leave earlier.", "Don't forget your charger when you head out.", "Take an umbrella, it is pouring by 4."]) {
    it(`"${text.slice(0, 30)}"`, () => expect(offerOf(text)?.kind).toBe("notice"));
  }
  it("a timed standing-check heads-up stays out of it", () => {
    expect(offerOf("Heads up 3:30 PM — MKTG2201 Introduction to Marketing")?.kind).not.toBe("notice");
  });
  it("'why' to it starts no check-in", () => {
    for (const said of ["why", "ok why", "huh"]) {
      expect(readPendingTurn({ message: said, now: NOW, lastPush: push(JACKET) })?.offer?.kind).not.toBe("start");
    }
  });
  it("'ok' to it is only acknowledged", () => {
    expect(readPendingTurn({ message: "ok", now: NOW, lastPush: push(JACKET) })?.offer?.kind).toBe("notice");
  });
});
