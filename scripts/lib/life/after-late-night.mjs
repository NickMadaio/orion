// Reshape tomorrow after a short night (life-late-night): classes stay, a nap
// goes in after the first class past noon, early heavy work moves later.
import { freeGaps } from "./gaps.mjs";
import { minimumFor } from "./lengths.mjs";
import { clock12 } from "./morning-brief.mjs";
import { minutesPastBed } from "../reach/bedtime-guard.mjs";

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const byStart = (a, b) => a.start - b.start;

// heavyAfter: heavy study (and the side project) that starts before this minute moves to a later gap (the all-nighter plan).
// napAfterClass: the nap goes right after the first class of the day, not after the first class past noon.
export function adjustForShortSleep(blocks, { sleptMinutes, wake, window, minimums = {}, heavyAfter = 0, napAfterClass = false, placeFirst = false }) {
  if (sleptMinutes >= 420) return { blocks: blocks.map((b) => ({ ...b })), changes: [] };
  let working = blocks.map((b) => ({ ...b }));
  const changes = [];
  const date = blocks[0]?.date;
  // His own minimum wins ("naps at least an hour and 15, always").
  const laterThan = Math.max(wake + 120, heavyAfter);
  const napLength = Math.max(sleptMinutes < 300 ? 45 : 30, minimumFor("Nap", minimums));
  const afterNoonFixed = working.filter((b) => b.fixed && b.end > (napAfterClass ? Math.max(window.start, 0) : 720)).sort(byStart)[0];
  const from = afterNoonFixed ? afterNoonFixed.end : 720;  // Heavy blocks that are about to move later do not hold the nap's slot.
  const staysPut = (b) => b.fixed || !(b.kind === "study" || b.kind === "side_project") || b.start >= laterThan;
  const napGap = freeGaps(working.filter(staysPut), { start: Math.max(from, window.start), end: window.end }).find((g) => g.end - g.start >= napLength);
  if (napGap) {
    working = [...working, { id: `nap-${date}`, title: "Nap", kind: "rest", date, start: napGap.start, end: napGap.start + napLength, fixed: false, source: "orion" }];
    changes.push(`Added a ${napLength} min nap at ${hhmm(napGap.start)}`);
  }
  const early = working.filter((b) => !b.fixed && (b.kind === "study" || b.kind === "side_project") && b.start < laterThan).sort(byStart);
  for (const block of early) {
    const length = block.end - block.start;
    const others = working.filter((b) => b.id !== block.id);
    const gaps = freeGaps(others, { start: Math.max(laterThan, window.start), end: window.end }).filter((g) => g.end - g.start >= length);
    const target = placeFirst ? gaps[0] : gaps[gaps.length - 1];
    if (!target) { changes.push(`Could not move ${block.title}`); continue; }
    const start = placeFirst ? target.start : target.end - length;
    working = [...others, { ...block, start, end: start + length }];
    changes.push(`Moved ${block.title} to ${hhmm(start)}`);
  }
  return { blocks: working.sort(byStart), changes };
}

const STUDY_TRIM_MINUTES = 30;    // a tired day takes this much off each long study block...
const STUDY_FLOOR_MINUTES = 45;   // ...never below this

/**
 * Tomorrow after a night that is gone or going (an all-nighter, or awake past the sleep plan). A PROPOSAL, said plainly in
 * the morning brief: classes stay with their alarm and leave time, a nap goes in after class, heavy study moves later. When
 * he is tired the gym keeps its full length (his rule: 90 min every day) as an easier session, and study shrinks instead
 * (2026-10-31 policy). Nothing is written to the calendar; Nick says yes or "keep it".
 * @returns {{ blocks, changes: string[], protect: {title,start}[], text: string, sleptMinutes: number }}
 */
export function tomorrowProposal(blocks, { sleptMinutes, wake, window, recovery = null, minimums = {}, heavyAfter = 15 * 60 }) {
  const base = adjustForShortSleep(blocks.map((b) => ({ ...b })), { sleptMinutes: Math.min(sleptMinutes, 419), wake, window, minimums, heavyAfter, napAfterClass: true, placeFirst: true });
  const tired = recovery?.level === "low" || sleptMinutes < 300;
  const changes = [...base.changes];
  const out = base.blocks.map((b) => {
    if (!tired || b.fixed) return b;
    if (b.kind === "gym") { changes.push(`${b.title} stays full length as an easier session`); return b; }
    if (b.kind !== "study" || b.end - b.start <= STUDY_FLOOR_MINUTES) return b;
    const length = Math.max(STUDY_FLOOR_MINUTES, b.end - b.start - STUDY_TRIM_MINUTES);
    changes.push(`Shortened ${b.title} to ${length} min`);
    return { ...b, end: b.start + length };
  });
  const protect = out.filter((b) => b.fixed && b.kind === "class").sort(byStart).map((b) => ({ title: b.title, start: b.start }));
  const classLine = protect.length ? `${protect.map((c) => `${c.title} at ${clock12(c.start)}`).join(" and ")} stays, alarm and leave time too.` : "Nothing fixed is touched.";
  const text = `Proposal: ${classLine} ${changes.length ? `${changes.map((c) => c.replace(/\.$/, "").replace(/\b(\d{2}):(\d{2})\b/g, (_, h, m) => clock12(Number(h) * 60 + Number(m)))).join(". ")}.` : ""} Say "keep it" to leave the day as is.`.replace(/\s+/g, " ");
  return { blocks: out.sort(byStart), changes, protect, text, sleptMinutes };
}

/** Awake past the sleep plan: past bedtime by 15+ minutes (and not by more than 7 h: after that it is morning), with the Mac or the phone in use. */
export function awakeLateFlag({ minute, bedMinute, macActive = false, phoneInUse = false }) {
  const past = minutesPastBed(minute, bedMinute);
  const awake = past >= 15 && past <= 420 && (macActive || phoneInUse);
  return { awake, minutesPastBed: awake ? past : 0, evidence: [macActive && "mac active", phoneInUse && "phone unlocked"].filter(Boolean) };
}

/**
 * What the bedtime guard sends. The words only: the guard decides whether it may go (bedtime-guard.mjs).
 * `lightened`: tomorrow was really rewritten; `proposed`: a lighter plan waits for the morning brief. Neither: nothing is
 * claimed (2026-10-31 review: the default said "I've already lightened tomorrow" when nothing had been written).
 */
export function goToBedMessage({ minute, firstClass = null, wake = null, lightened = false, proposed = false }) {
  const hours = wake === null ? null : Math.round((((wake - minute) % 1440 + 1440) % 1440) / 6) / 10;
  const bits = [`It's ${clock12(minute)}${firstClass ? ` and ${firstClass.title} is at ${clock12(firstClass.start)}` : ""}.`];
  if (hours !== null && hours > 0 && hours < 9) bits.push(`Bed now still gets you about ${hours}h before the alarm.`);
  bits.push("Go to bed.");
  if (lightened) bits.push("I've already lightened tomorrow around it.");
  else if (proposed) bits.push("I'll have a lighter plan for tomorrow in the morning.");
  return bits.join(" ");
}
