// What ORION says without being asked (2026-10-07). Nick: "the app is giving me
// notifications about how i should be asleep but whats the point? he sees im
// not at home and that im inside a focus session". Pure: the moment in, the
// messages worth sending out — each at most once a day by its key.
//
// ctx: { minute, day: [{ id, title, start, end, fixed, kind }], session: { status,
//   phase, remainingSeconds, blockNumber, totalBlocks, sessionId, endedMinute? },
//   out, where, idleSeconds, bed, wake, focusToday, sent: { key: true } }

const hm = (m) => { const h = Math.floor(((m % 1440) + 1440) % 1440 / 60), mm = ((m % 60) + 60) % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };
const toMin = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
const span = (min) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m} min`; };

/** Minutes until `to` going forward through midnight. */
const ahead = (from, to) => ((to - from) % 1440 + 1440) % 1440;

export function decide(ctx) {
  const out = [];
  const say = (key, text, kind, extra = {}) => { if (!ctx.sent?.[key]) out.push({ key, text, kind, ...extra }); };
  const busy = ctx.session?.status === "running" || ctx.session?.status === "paused";
  const away = ctx.out;
  const bed = toMin(ctx.bed ?? "23:45"), wake = toMin(ctx.wake ?? "07:45");
  const toBed = ahead(ctx.minute, bed);           // minutes until bedtime (0..1439)
  const pastBed = ahead(bed, ctx.minute);          // minutes since bedtime (0..1439)
  const sleepLeft = (m) => span(ahead(m, wake));
  const first = (ctx.day ?? []).filter((b) => b.fixed && b.start >= 4 * 60).sort((a, b) => a.start - b.start)[0];

  // A session just finished: say how it went and what's next.
  if (ctx.session?.status === "finished" && ctx.session.endedMinute !== undefined && ahead(ctx.session.endedMinute, ctx.minute) <= 10) {
    const late = pastBed <= 180;
    const next = (ctx.day ?? []).filter((b) => b.start > ctx.minute).sort((a, b) => a.start - b.start)[0];
    say(`session-done-${ctx.session.sessionId}`, late
      ? `Session done. ${ctx.focusToday ? `${ctx.focusToday} today. ` : ""}It's ${hm(ctx.minute)} — past bedtime; sleep now and you get ${sleepLeft(ctx.minute)}.`
      : `Session done.${ctx.focusToday ? ` ${ctx.focusToday} today.` : ""}${next ? ` Next: ${next.title.replace(/ — .*$/, "")} at ${hm(next.start)}.` : ""}`,
      late ? "reminder" : "update", { urgent: late });
  }

  // Bedtime — never while he's in a session or out; the session's end or his
  // getting home brings it instead.
  if (!busy && !away) {
    if (toBed > 0 && toBed <= 30) {
      say("bed-wind", `Bed at ${hm(bed)}${first ? ` — ${first.title.replace(/ — .*$/, "")} at ${hm(first.start)} tomorrow` : ""}. Start wrapping up.`, "reminder");
    } else if (pastBed <= 20) {
      say("bed-now", `It's ${hm(ctx.minute)}, bedtime. Sleep now and you get ${sleepLeft(ctx.minute)} before your alarm.`, "reminder", { urgent: true });
    } else if (pastBed >= 40 && pastBed <= 150 && Number(ctx.idleSeconds) < 300) {
      // Only when he is clearly up (at the Mac), and once.
      say("bed-late", `Still up at ${hm(ctx.minute)} — ${sleepLeft(ctx.minute)} left before your alarm. Want me to move tomorrow's first block later?`, "question", { urgent: true });
    }
  }
  return out;
}

export const _test = { hm, toMin, ahead };
