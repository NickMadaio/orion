// W10-A1: a short reply to a notification ORION sent that asked nothing (weather, a mission event, a screen lock), a check-in line, a
// focus nudge or a wind-down line is read against that message. Held-out phrasings: none of these appear in the gate scenarios.
import { describe, expect, it } from "vitest";
import { offerOf, readPendingTurn, runPendingTurn } from "./pending-reply.js";

const NOW = new Date("2026-11-02T15:00:00Z");
const MIN = 60_000;
const push = (text: string, minutesAgo: number) => ({ text, at: new Date(NOW.getTime() - minutesAgo * MIN).toISOString() });

const WEATHER = "Weather update for Boston, Massachusetts: light rain, 48°F (feels 44°F), wind 12 km/h. 2026-11-02: 41–50°F, light rain, 70% precip.";
const MISSION_DONE = "Orion | MISSION COMPLETE | m-77\nReport is ready\nNo action needed.";
const MISSION_BLOCKED = "Orion | BLOCKED | m-91\nNeeds your word to send the file.\nWaiting on: send the file\nReply \"approve ap-4421\" or \"deny ap-4421\".";
const LOCK = "I locked your screen: you were off task for a while. Back to Study for CS Midterm when you're ready.";
const CHECKIN = "Checking in on the lab write-up. How is it going?";
const FOCUS = "You planned Study for CS Midterm at 2:00 PM. Want to start it now, or push it back 20 minutes?";
const WIND = "Time to wind down. Bedtime is 11:30 PM and the alarm is at 7.";

const read = (message: string, text: string, minutesAgo = 4) => readPendingTurn({ message, now: NOW, lastPush: push(text, minutesAgo) });
const run = async (message: string, text: string, minutesAgo = 4) => {
  const turn = read(message, text, minutesAgo);
  return turn ? runPendingTurn(turn, { now: NOW }) : undefined;
};

describe("offers read from the messages ORION sends without asking", () => {
  it("names the kind of notice", () => {
    expect(offerOf(WEATHER)).toEqual({ kind: "notice", topic: "weather" });
    expect(offerOf(MISSION_DONE)).toEqual({ kind: "notice", topic: "mission" });
    expect(offerOf(MISSION_BLOCKED)).toEqual({ kind: "notice", topic: "mission", approvalId: "ap-4421" });
    expect(offerOf(LOCK)).toEqual({ kind: "notice", topic: "lock" });
  });
  it("reads a check-in and a focus nudge as the block's start, and a wind-down as bedtime", () => {
    expect(offerOf(CHECKIN)).toEqual({ kind: "start", title: "the lab write-up" });
    expect(offerOf(FOCUS)).toEqual({ kind: "start", title: "Study for CS Midterm" });
    expect(offerOf(WIND)?.kind).toBe("bedtime");
  });
});

describe("a short reply to a notice is taken as heard", () => {
  for (const said of ["ok thanks", "cool", "yep saw it", "got it"]) {
    it(`weather: "${said}"`, async () => {
      const out = await run(said, WEATHER);
      expect(out?.flow).toBeTruthy();
      expect(JSON.stringify(out)).toContain("Got it.");
      expect(out?.tools).toEqual([]);
    });
  }
  it("a mission finishing is acknowledged, nothing is run", async () => {
    const out = await run("thx", MISSION_DONE);
    expect(out?.tools).toEqual([]);
    expect(out?.marks.length ?? 0).toBeLessThan(2);
  });
  it("after a screen lock, 'no' and 'ok' are taken without any action", async () => {
    expect(await run("nah", LOCK)).toBeTruthy();
    expect(await run("ok fine", LOCK)).toBeTruthy();
  });
});

describe("a plain yes never approves a blocked mission", () => {
  for (const said of ["yeah", "ok do it", "sure go ahead"]) {
    it(`"${said}"`, async () => {
      const out = await run(said, MISSION_BLOCKED);
      const text = JSON.stringify(out);
      expect(text).toContain("approve ap-4421");
      expect(text).toMatch(/explicit|isn't enough/);
      expect(out?.tools).toEqual([]);
    });
  }
  it("a no leaves it waiting", async () => {
    expect(JSON.stringify(await run("nope", MISSION_BLOCKED))).toContain("deny ap-4421");
  });
});

describe("the reply is bound for two hours, not only thirty minutes, and not after he already answered", () => {
  it("a weather push 90 minutes old still binds", () => {
    expect(read("ok", WEATHER, 90)?.offer?.kind).toBe("notice");
  });
  it("a push 3 hours old does not", () => {
    expect(read("ok", WEATHER, 180)).toBeUndefined();
  });
  it("ORION replied in this chat after the push: the reply answers that turn", () => {
    const turn = readPendingTurn({ message: "ok", now: NOW, lastPush: push(WEATHER, 60), lastReplyAt: NOW.getTime() - 10 * MIN });
    expect(turn).toBeUndefined();
  });
});

describe("what is not a reply to a notice goes on to the normal turn, with its context", () => {
  for (const said of ["why?", "what does that mean for my run tomorrow", "move gym to 8 since its raining"]) {
    it(`"${said}"`, () => {
      expect(read(said, WEATHER)).toBeUndefined();
    });
  }
});

describe("check-ins and focus nudges answer through the check-in paths", () => {
  it("a delay to a check-in line is a deferral of that block", () => {
    const turn = read("give me 15", CHECKIN);
    expect(turn?.offer?.kind).toBe("start");
    expect(turn?.reply.kind).toBe("defer");
  });
  it("'in 10' to the focus nudge is a deferral", () => {
    const turn = read("ya starting in 10", FOCUS);
    expect(turn?.offer?.kind).toBe("start");
    expect(turn?.reply.kind).toBe("defer");
  });
});
