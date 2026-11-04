// Recurring-reminder maths on the plugin side. Mirrors scripts/lib/reminders/schedule.mjs (same vectors, same answers).
process.env.TZ = "Europe/London";
import { describe, expect, it } from "vitest";
import { daysOf, describeRepeat, nextOccurrence } from "./reminder-schedule.js";

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);

describe("nextOccurrence", () => {
  it("daily at 9: today if it has not passed, else tomorrow", () => {
    const r = { days: daysOf("daily"), time: "09:00" };
    expect(new Date(nextOccurrence(r, at(2026, 11, 4, 8))!)).toEqual(at(2026, 11, 4, 9));
    expect(new Date(nextOccurrence(r, at(2026, 11, 4, 9))!)).toEqual(at(2026, 11, 5, 9));
  });
  it("weekdays skip the weekend; every monday lands on monday; two days a week", () => {
    expect(new Date(nextOccurrence({ days: daysOf("weekdays"), time: "08:30" }, at(2026, 11, 6, 9))!)).toEqual(at(2026, 11, 9, 8, 30));
    expect(new Date(nextOccurrence({ days: [1], time: "17:00" }, at(2026, 11, 4, 12))!)).toEqual(at(2026, 11, 9, 17));
    expect(new Date(nextOccurrence({ days: [1, 3], time: "07:15" }, at(2026, 11, 9, 8))!)).toEqual(at(2026, 11, 11, 7, 15));
  });
  it("DST: the wall clock holds across the spring and autumn changes", () => {
    const r = { days: daysOf("daily"), time: "09:00" };
    const spring = nextOccurrence(r, at(2026, 3, 28, 9))!;
    expect(new Date(spring)).toEqual(at(2026, 3, 29, 9));
    expect((spring - at(2026, 3, 28, 9).getTime()) / 3600000).toBe(23);
    const autumn = nextOccurrence(r, at(2026, 10, 24, 9))!;
    expect(new Date(autumn)).toEqual(at(2026, 10, 25, 9));
    expect((autumn - at(2026, 10, 24, 9).getTime()) / 3600000).toBe(25);
  });
  it("a 01:30 reminder fires once on the day the clocks go back, and still fires on the day they go forward", () => {
    const r = { days: daysOf("daily"), time: "01:30" };
    const first = nextOccurrence(r, at(2026, 10, 24, 12))!;
    expect(nextOccurrence(r, first)! - first).toBeGreaterThanOrEqual(23 * 3600000);
    expect(new Date(nextOccurrence(r, at(2026, 3, 28, 12))!).getDate()).toBe(29);
  });
  it("refuses a repeat it cannot read", () => {
    expect(nextOccurrence({ days: [], time: "09:00" }, new Date())).toBeNull();
    expect(nextOccurrence({ days: [1], time: "25:00" }, new Date())).toBeNull();
  });
});

describe("describeRepeat", () => {
  it("says it the way he would", () => {
    expect(describeRepeat({ days: [1], time: "09:00" })).toBe("every Monday at 9:00 AM");
    expect(describeRepeat({ days: daysOf("daily"), time: "21:30" })).toBe("every day at 9:30 PM");
    expect(describeRepeat({ days: daysOf("weekdays"), time: "08:00" })).toBe("every weekday at 8:00 AM");
    expect(describeRepeat({ days: [1, 3], time: "07:15" })).toBe("every Monday and Wednesday at 7:15 AM");
    expect(describeRepeat({ days: daysOf("weekends"), time: "10:00" })).toBe("every weekend at 10:00 AM");
  });
});
