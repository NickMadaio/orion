// How he actually types a reminder: typos, repeats, a place, a part of the day, "important" (w19-reminders).
// Held-out phrasings in his style: lowercase, run-ons, no punctuation.
import { describe, expect, it } from "vitest";
import { fixTypos, isImportantAsk, periodTime, repeatOf, wantsHome } from "./reminder-phrases.js";

describe("fixTypos", () => {
  it.each([
    ["remnd me to call mom at 5", "remind me to call mom at 5"],
    ["rmind me tmrw at 9 to email prof hale", "remind me tomorrow at 9 to email prof hale"],
    ["remimd me in 20 mins to flip the laundry", "remind me in 20 mins to flip the laundry"],
    ["reimnd me tonite to text sam", "remind me tonight to text sam"],
    ["can u remid me 2moro at 8 to pay rent", "can u remind me tomorrow at 8 to pay rent"],
    ["remind mw at 5pm to eat", "remind me at 5pm to eat"],
    ["pls remmind me tomorow morning to ring the bank", "pls remind me tomorrow morning to ring the bank"],
    ["whats my remindrs for today", "whats my reminders for today"],
    ["set a remnder for 6pm", "set a reminder for 6pm"],
  ])("%s", (input, output) => { expect(fixTypos(input)).toBe(output); });

  it("leaves ordinary sentences alone", () => {
    for (const s of ["he reminded me yesterday that the bank closes at 5", "i remain confused about tomorrow", "the minder at the gym is nice", "i need to email prof hale tomorrow"]) expect(fixTypos(s)).toBe(s);
  });
});

describe("repeatOf", () => {
  it.each([
    ["every monday remind me to take the bins out", [1]],
    ["remind me every weekday at 8 to take my pills", [1, 2, 3, 4, 5]],
    ["remind me daily at 9pm to log my food", [0, 1, 2, 3, 4, 5, 6]],
    ["every mon and thurs remind me to water the plant", [1, 4]],
    ["remind me on mondays and wednesdays to submit hours", [1, 3]],
    ["every morning remind me to drink water", [0, 1, 2, 3, 4, 5, 6]],
    ["remind me every weekend to call gran", [0, 6]],
    ["remind me every day to stretch", [0, 1, 2, 3, 4, 5, 6]],
    ["remind me every friday at 4 to send the timesheet", [5]],
  ])("%s", (input, days) => { expect(repeatOf(input)).toMatchObject({ days }); });

  it("says plainly when it is a repeat he cannot do", () => {
    for (const s of ["remind me every other day to stretch", "remind me every 2 weeks to call dad", "remind me every hour to stand up", "remind me monthly to pay rent", "remind me every 30 mins to drink"]) expect(repeatOf(s)).toHaveProperty("unsupported");
  });

  it("is not a repeat when he names one day", () => {
    expect(repeatOf("remind me on friday at 6 to call mom")).toBeUndefined();
    expect(repeatOf("remind me tomorrow to email prof hale")).toBeUndefined();
  });
});

describe("a part of the day", () => {
  it.each([
    ["remind me tomorrow morning to call the bank", "09:00"],
    ["remind me this afternoon to send it", "14:00"],
    ["remind me tomorrow evening to text her", "18:00"],
    ["remind me tonight to take the bins out", "20:00"],
    ["remind me in the morning to bring my charger", "09:00"],
  ])("%s", (input, time) => { expect(periodTime(input)).toBe(time); });

  it("a clock time wins, and no period means no guess", () => {
    expect(periodTime("remind me tomorrow morning at 7 to call")).toBeUndefined();
    expect(periodTime("remind me tomorrow to call")).toBeUndefined();
  });
});

describe("when I get home", () => {
  it.each([
    "remind me to text mom when i get home",
    "when im home remind me to start the washing",
    "remind me to charge my watch once i'm back home",
    "remind me when i get back home to feed the cat",
    "remind me to call dad as soon as i get home",
    "remind me when i walk in the door to take the bins out",
  ])("%s", (s) => { expect(wantsHome(s)).toBe(true); });

  it("only home, and only as a place", () => {
    expect(wantsHome("remind me to call home at 5")).toBe(false);
    expect(wantsHome("remind me at 5 to get home early")).toBe(false);
    expect(wantsHome("remind me when i get to campus")).toBe(false);
  });
});

describe("important", () => {
  it("is only what he marks as such", () => {
    expect(isImportantAsk("remind me at 5 to call the landlord its important")).toBe(true);
    expect(isImportantAsk("dont miss this: remind me at 3 to send the form")).toBe(true);
    expect(isImportantAsk("remind me at 5 no matter what to submit it")).toBe(true);
    expect(isImportantAsk("remind me at 5 to call mom")).toBe(false);
    expect(isImportantAsk("remind me at 5 to buy a cheap printer")).toBe(false);
  });
});
