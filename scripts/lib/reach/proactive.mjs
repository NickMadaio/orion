// What ORION says without being asked (2026-10-07). Nick: "the app is giving me
// notifications about how i should be asleep but whats the point? he sees im
// not at home and that im inside a focus session". Pure: the moment in, the
// messages worth sending out — each at most once a day by its key.
//
// ctx: { minute, day: [{ id, title, start, end, fixed, kind }], session: { status,
//   phase, remainingSeconds, blockNumber, totalBlocks, sessionId, endedMinute? },
//   out, where, idleSeconds, bed, wake, focusToday, sent: { key: true } }

import { classLadder } from "./class-ladder.mjs";

const hm = (m) => { const h = Math.floor(((m % 1440) + 1440) % 1440 / 60), mm = ((m % 60) + 60) % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };
const toMin = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
const span = (min) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m} min`; };

/** Minutes until `to` going forward through midnight. */
const ahead = (from, to) => ((to - from) % 1440 + 1440) % 1440;

export function decide(ctx) {
  const out = [];
  const say = (key, text, kind, extra = {}) => { if (!ctx.sent?.[key]) out.push({ key, text, kind, ...extra }); };
  // Awareness gives the session state (a break is a session too: no bedtime nag while he rests between blocks) and
  // atHome; without them (old callers) the legacy status and the calendar-derived `out` apply. Unknown is not away.
  const busy = ctx.sessionState !== undefined ? ["focus", "rest", "paused"].includes(ctx.sessionState)
    : ctx.session?.status === "running" || ctx.session?.status === "paused";
  const away = ctx.atHome !== undefined ? ctx.atHome === false : ctx.out;
  const bed = toMin(ctx.bed ?? "23:45"), wake = toMin(ctx.wake ?? "07:45");
  const toBed = ahead(ctx.minute, bed);           // minutes until bedtime (0..1439)
  const pastBed = ahead(bed, ctx.minute);          // minutes since bedtime (0..1439)
  const sleepLeft = (m) => span(ahead(m, wake));
  const strip = (t) => String(t).replace(/ — .*$/, "");
  const blocks = ctx.day ?? [];
  // TOMORROW's first thing, from tomorrow's calendar (2026-10-16 audit, finding 7: the bedtime line took TODAY's
  // first fixed block and printed it as "tomorrow": CS1800 on 10-08, CS2100 on 10-12, both wrong). After midnight
  // "tomorrow" is today, and only what is still ahead counts. Unknown tomorrow means no claim about it.
  const tom = (ctx.tomorrowDay ?? []).filter((b) => b.start >= 4 * 60 && (!ctx.tomorrowIsToday || b.start > ctx.minute)).sort((a, b) => a.start - b.start);
  const first = tom.find((b) => b.fixed);
  const firstMovable = tom.find((b) => !b.fixed);
  const bedKeys = ["bed-wind", "bed-now", "bed-late"];

  // A session just finished: say how it went and what's next. Only a REAL session (2026-10-16, finding 10: "Session
  // done" went out for 2-second abandoned test sessions, one as a 03:09 push): not abandoned, more than 5 min served.
  let announcedLate = false;
  const s = ctx.session;
  if (s?.status === "finished" && s.endedMinute !== undefined && ahead(s.endedMinute, ctx.minute) <= 10
      && s.reason !== "abandoned" && Number(s.servedFocusSeconds) > 5 * 60) {
    const late = pastBed <= 180;
    const next = blocks.filter((b) => b.start > ctx.minute).sort((a, b) => a.start - b.start)[0];
    // Late: ONE message that carries the bedtime line too, and the bed-* keys are said with it, so the pair of
    // lines one second apart (10-07 23:54, 10-15 01:25) cannot happen.
    announcedLate = late;
    say(`session-done-${s.sessionId}`, late
      ? `Session done. ${ctx.focusToday ? `${ctx.focusToday} today. ` : ""}It's ${hm(ctx.minute)} — past bedtime; sleep now and you get ${sleepLeft(ctx.minute)}.`
      : `Session done.${ctx.focusToday ? ` ${ctx.focusToday} today.` : ""}${ctx.heldText ? ` ${ctx.heldText}` : ""}${next ? ` Next: ${strip(next.title)} at ${hm(next.start)}.` : ""}`,
      late ? "reminder" : "update", late ? { also: bedKeys, expires: true } : {});
  }

  // Classes (priority 1): leave nudge, urgent, wake-up call, then one replan if he missed it
  // (even mid-session: missing class matters more). See class-ladder.mjs.
  // (the plan-vs-reality loop runs the ladder itself, as its should-leave mismatch, and sets skipLadder)
  if (!ctx.skipLadder) classLadder(ctx, say);

  const open = (ctx.todos ?? []).filter((t) => !t.booked && !t.waiting);
  // Free time and blanks are the curiosity loop's now (lib/curiosity): "what are you up to?", not a to-do offer.
  // Due tomorrow (or today) and nothing booked: ask in the evening, once.
  if (ctx.minute >= 17 * 60 && ctx.minute <= 21 * 60) {
    for (const t of open.filter((x) => x.dueDate && (x.dueDate === ctx.today || x.dueDate === ctx.tomorrow))) {
      say(`due-${t.title}-${t.dueDate}`, `${t.title} is due ${t.dueDate === ctx.today ? "today" : "tomorrow"} and nothing's booked for it — want me to find an hour tonight?`, "question");
    }
  }

  // Bedtime — never while he's in a session or out; the session's end or his getting home brings it instead. They are
  // nudges: never urgent (2026-10-16), pointless once the night is over (expires), and one per window.
  if (!busy && !away && !announcedLate) {
    if (toBed > 0 && toBed <= 30) {
      say("bed-wind", `Bed at ${hm(bed)}${first ? ` — ${strip(first.title)} at ${hm(first.start)} tomorrow` : ""}. Start wrapping up.`, "reminder", { expires: true });
    } else if (pastBed <= 20) {
      say("bed-now", `It's ${hm(ctx.minute)}, bedtime. Sleep now and you get ${sleepLeft(ctx.minute)} before your alarm.`, "reminder", { expires: true });
    } else if (pastBed >= 40 && pastBed <= 150 && Number(ctx.idleSeconds) < 300) {
      // Only when he is clearly up (at the Mac), and once. A fixed class is never offered a move: it is protected.
      const tail = first && first.kind === "class" ? ` Your first class is ${strip(first.title)} at ${hm(first.start)} — go now and I'll protect it.`
        : first ? ` Your first thing is ${strip(first.title)} at ${hm(first.start)}.`
        : firstMovable ? ` Want me to move ${strip(firstMovable.title)} later?` : "";
      say("bed-late", `Still up at ${hm(ctx.minute)} — ${sleepLeft(ctx.minute)} left before your alarm.${tail}`, tail.includes("Want me") ? "question" : "reminder", { expires: true });
    }
  }
  return out;
}

export const _test = { hm, toMin, ahead };
