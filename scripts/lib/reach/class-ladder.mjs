// Defending priority 1 (classes) before, at and after the start (2026-10-16 audit, finding 1).
// 2026-10-15: CS1800 at 9:00, WHOOP says he woke at 9:29. ORION sent one "Leave in 12 min"
// banner and then nothing for 2.5 h, and the afterClass line called the class "done".
//
// The ladder, per fixed class, each rung once (its `sent` key):
//   leave-<start>        5-15 min before leave time: a plain nudge
//   leave-late-<start>   leave time to +10 min, he has not moved: urgent (time-sensitive), calm
//   wake-<start>         until 10 min after the start, still no sign of him: the wake-up call (urgent, aloud if the Mac is up)
//   class-missed-<start> 15+ min after the start, with EVIDENCE he missed it: one kind replan, never a scolding
// "Moved" is evidence (the phone off its charger and moving, lib/life/attendance.mjs). No evidence of a miss, no replan.
import { classAttendance } from "../life/attendance.mjs";

const strip = (t) => String(t).replace(/ — .*$/, "");
const hm = (m) => { const h = Math.floor(((m % 1440) + 1440) % 1440 / 60), mm = ((m % 60) + 60) % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };

/** A real class: fixed, a class, and not one ORION planned itself. */
const cancelled = (b) => /^\s*(cancell?ed|canceled)\b/i.test(String(b.title ?? ""));
export const isRealClass = (b) => b.kind === "class" && b.fixed && b.source !== "orion" && !cancelled(b);

export function classLadder(ctx, say) {
  const signals = ctx.signals ?? {};
  const blocks = ctx.day ?? [];
  // Away / left: awareness location when it is known (atHome true or false), else the calendar-derived `out` and the
  // phone's leftAt, as before. Unknown is never "left".
  const located = typeof ctx.atHome === "boolean";
  // a home answer older than the phone's leftAt is stale: he left after it (homeFixMinute: when that answer was last confirmed)
  const leftSince = ctx.atHome === true && signals.leftAt != null && ctx.homeFixMinute != null && signals.leftAt > ctx.homeFixMinute;
  const away = located ? !ctx.atHome || leftSince : ctx.out;
  const moved = located ? !ctx.atHome || leftSince : signals.leftAt != null;
  // Leave soon: travel starts in 5-15 minutes, for any fixed destination.
  for (const w of ctx.travel ?? []) {
    const inMin = w.start - ctx.minute;
    if (inMin < 5 || inMin > 15 || away) continue;
    const dest = blocks.filter((b) => b.fixed && b.start >= w.end - 1).sort((a, b) => a.start - b.start)[0];
    if (!dest || cancelled(dest)) continue;
    // Only the PLAIN nudge checks the shared claim (checkClaim): the urgent steps below mark it but are never skipped by it
    // (review H1: a pre-marked key used to silence the whole ladder). Only a real class bypasses quiet hours; a dinner does not.
    say(`leave-${dest.start}`, `Leave in ${inMin} min for ${strip(dest.title)} at ${hm(dest.start)}.`, "reminder",
      { ...(isRealClass(dest) ? { urgentKind: "class" } : {}), claim: `class-${dest.start}`, checkClaim: true, level: 1 });   // a class he is about to miss: gets through quiet hours, but is a plain banner
  }
  leaveLateOthers(ctx, say, moved);
  const realClasses = blocks.filter(isRealClass).sort((a, b) => a.start - b.start);
  for (const cls of realClasses) {
    const name = strip(cls.title);
    const attendance = classAttendance(cls, { wokeAt: signals.wokeAt ?? null, phone: signals.phone ?? [] });
    if (attendance === "attended") continue;
    const wall = (ctx.travel ?? []).find((w) => /^(commute to|getting to)/i.test(w.title) && w.end >= cls.start - 1 && w.end <= cls.start + 1);
    const leaveAt = wall ? wall.start : cls.start - 30;
    const toLeave = leaveAt - ctx.minute;
    const toStart = cls.start - ctx.minute;
    if (moved) continue;
    // Review M5: already on campus (inside the previous class, or just out of it and not known to have missed it): no "Up now".
    // Re-review N1: "on campus" needs POSITIVE evidence that he was at the earlier class: "attended" (leftAt, moving, is handled above).
    // Unknown must not suppress, and neither may an early wake: he can wake at 7:30 and still miss the 9:00 (phone on its charger).
    const onCampus = realClasses.some((o) => o !== cls && o.start < cls.start && o.start <= ctx.minute && ctx.minute < o.end + 45
      && classAttendance(o, { wokeAt: signals.wokeAt ?? null, phone: signals.phone ?? [] }) === "attended");
    if (onCampus) continue;
    if (toLeave <= 0 && toLeave >= -10) say(`leave-late-${cls.start}`, `You should be out the door now - ${name} is at ${hm(cls.start)}. Go, and I'll sort the rest.`, "reminder", { urgent: true, urgentKind: "class", claim: `class-${cls.start}`, level: 2 });
    if (toLeave < -10 && toStart >= -10) {
      const up = signals.wokeAt != null && signals.wokeAt < cls.start;   // already awake: a head-out line, not a wake-up call
      say(`wake-${cls.start}`, toStart > 0
        ? (up ? `${name} starts in ${toStart} min - time to head out.` : `${name} starts in ${toStart} min. Up now - you can still make most of it.`)
        : `${name} started ${-toStart} min ago. Go now and you'll still catch part of it.`, "reminder", { urgent: true, urgentKind: "class", loud: true, claim: `class-${cls.start}`, level: 3 });
    }
    if (attendance === "missed" && ctx.minute >= cls.start + 15 && ctx.minute <= cls.end + 90) {
      const next = blocks.filter((b) => b.start > ctx.minute && b.id !== cls.id).sort((a, b) => a.start - b.start)[0];
      const where = next ? `Next up: ${strip(next.title)} at ${hm(next.start)}.` : "The rest of today is open.";
      say(`class-missed-${cls.start}`, `Looks like ${name} didn't happen today - it happens. ${where} Want me to fit in time to catch up on it (the recording or notes), or leave it?`, "question", { level: 0 });
    }
  }
}

/** A fixed destination that is not a class (dinner with friends): the same "you should be out the door" line, but a plain
 * reminder (no urgentKind), so it does not cut through focus or quiet hours (spec 3.4.2). Needs him to be known at home
 * (or, with no location, not seen leaving). */
function leaveLateOthers(ctx, say, moved) {
  if (moved || ctx.atHome === null) return;
  for (const dest of (ctx.day ?? []).filter((b) => b.fixed && !isRealClass(b) && !cancelled(b) && b.kind !== "class")) {
    const wall = (ctx.travel ?? []).find((w) => w.end >= dest.start - 1 && w.end <= dest.start + 1);
    if (!wall) continue;
    const toLeave = wall.start - ctx.minute;
    if (toLeave <= 0 && toLeave >= -10) say(`leave-late-${dest.start}`, `You should be out the door now - ${strip(dest.title)} is at ${hm(dest.start)}.`, "reminder", { level: 2, tier: "protected" });   // a fixed destination he must reach: never starved by the low-value budget
  }
}
