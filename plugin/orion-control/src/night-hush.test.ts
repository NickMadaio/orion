// Wave 8: sleep wins over gym nudges at night, and a person's note is spoken as one plain sentence. Fixtures only.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pastNudgeTime, stripLateInstruction } from "./night-hush.js";
import { planOutreachReply } from "./outreach-reply.js";
import { noteSentence, peopleReply } from "./code-answers.js";

const dir = (files: Record<string, unknown> = {}) => {
  const d = mkdtempSync(join(tmpdir(), "nh-"));
  for (const [n, v] of Object.entries(files)) writeFileSync(join(d, n), JSON.stringify(v));
  return d;
};
const at = (h: number, m = 0, day = 2) => new Date(2026, 10, day, h, m);

describe("pastNudgeTime", () => {
  it("falls back to life-config bedtime minus wind-down", () => {
    const d = dir({ "life-config.json": { bedtime: "23:30", windDownMinutes: 30 } });
    expect(pastNudgeTime(d, at(22, 59))).toBe(false);
    expect(pastNudgeTime(d, at(23, 0))).toBe(true);
    expect(pastNudgeTime(d, at(2, 0, 3))).toBe(true);
    expect(pastNudgeTime(d, at(9, 0, 3))).toBe(false);
  });
  it("uses Nick's own wake-plan nudge when source is nick", () => {
    const own = { source: "nick", bedtimes: [{ date: "2026-11-02", nudgeAtIso: at(21, 15).toISOString() }] };
    const d = dir({ "wake-plan.json": own, "life-config.json": { bedtime: "01:00" } });
    expect(pastNudgeTime(d, at(21, 20))).toBe(true);
    const other = dir({ "wake-plan.json": { ...own, source: "default" }, "life-config.json": { bedtime: "01:00" } });
    expect(pastNudgeTime(other, at(21, 20))).toBe(false);
  });
  it("is false with no state dir", () => expect(pastNudgeTime(undefined, at(23))).toBe(false));
});

describe("late replies carry no gym instruction", () => {
  it.each([
    ["No. Thirty minutes of gym, now.", "i cant sleep"],
    ["Rough one. Go hit the gym before you crash.", "ugh tired"],
    ["Okay, noted. Get that side project going tonight.", "kk"],
  ])("%s", (reply, said) => {
    const out = stripLateInstruction(reply, said);
    expect(out).not.toMatch(/gym|side project/i);
    expect(out.length).toBeGreaterThan(0);
  });
  it("keeps the rest of the reply", () => expect(stripLateInstruction("Got it. Thirty minutes of gym, now.", "hm")).toBe("Got it."));
  it("leaves a reply alone when he asked about gym himself", () => {
    const r = "You skipped gym today, so tomorrow morning is a good time.";
    expect(stripLateInstruction(r, "did i skip gym")).toBe(r);
  });
  it("a late 'give me 20 min' about a start line sets nothing and says sleep wins", () => {
    const o = { text: "Time to start: Gym.", minutes: 0, kind: "start" as const, title: "Gym" };
    const p = planOutreachReply(o, "in 20", true);
    expect(p?.act).toBeUndefined();
    expect(p?.text).toMatch(/sleep wins/i);
    expect(planOutreachReply(o, "in 20", false)?.act).toBeDefined();
  });
});

describe("a person's note is one clean sentence", () => {
  const cases: Array<[string, string, RegExp]> = [
    ["Marcus", "## 00 Inbox/marcus.md\n# Marcus Marcus is my lab partner for chem. Study sessions on Tuesdays.", /^Marcus is my lab partner for chem\. Study sessions on Tuesdays\.$/],
    ["Priya", "## notes/priya.md\n# Priya\n- Priya is a **classmate** from [[Econ 101|econ]].\n- Sits near the front.", /^Priya is a classmate from econ\. Sits near the front\.$/],
    ["Dev", "## x.md\n---\ntags: [people]\n---\n# Dev\nBrother of [[Nick]]. Lives in Leeds", /^Dev: Brother of Nick\. Lives in Leeds\.$/],
  ];
  it.each(cases)("%s", (name, notes, want) => {
    const out = peopleReply(name.toLowerCase(), notes);
    expect(out).toMatch(want);
    expect(out).not.toMatch(/[#\[\]*]|- /);
  });
  it("never repeats the title", () => expect(noteSentence("# Sam\nSam Sam is new", "Sam")).not.toMatch(/Sam Sam/));
});
