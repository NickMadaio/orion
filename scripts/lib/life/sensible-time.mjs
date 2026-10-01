// When an untimed plan should start (2026-09-30). Nick, looking at a test day:
// "why am i reading at 8 am, why am i doing my yt side project right after class
// with no getting back home buffer … the timing of things are terrible."
// The planner used to drop anything untimed into the earliest free gap. Now:
//   - nothing untimed goes before he is home: after his last class plus the
//     trip back, or after he is up on a day without classes (hard floor);
//   - each kind has a natural time of day it prefers (soft; used when free).
// A time he states himself never goes through here.

const EVENING = /\b(read(ing)?|book|relax|chill|tv|netflix|film|movie|gam(e|es|ing)|play|wind down|journal)\b/i;

/** Earliest minute untimed work may start: he is home, or up. */
export function homeFrom(blocks, { commuteMinutes = 30, wake = 540 } = {}) {
  const classes = blocks.filter((b) => b.kind === "class" && b.fixed !== false && b.source !== "orion");
  return classes.length ? Math.max(...classes.map((b) => b.end)) + commuteMinutes : wake;
}

/** The minute this kind of plan would naturally start, never before `home`. */
export function preferredStart({ title = "", kind = "other" }, home) {
  const t = String(title);
  if (/\bnap\b/i.test(t)) return home;
  if (/\bbreakfast\b/i.test(t)) return 0;
  if (/\blunch\b/i.test(t)) return Math.max(home, 12 * 60);
  if (kind === "meal" || /\bdinner\b/i.test(t)) return Math.max(home, 18 * 60 + 30);
  if (kind === "gym") return Math.max(home, 17 * 60);
  if (EVENING.test(t) || (kind === "rest" && !/\bbreak\b/i.test(t))) return Math.max(home, 20 * 60);
  return home;
}
