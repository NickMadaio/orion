// The morning briefing (2026-10-08). Nick: "two main gates for orion knowing im
// actually awake. one, using my phone for a few minutes. two, unplugging my
// phone. either work… once orion sees im awake he will outloud with max volume
// talk to me… tell me i have these things to do today, and what the weather is
// like." Pure: the gate and the words. scripts/orion-morning does the reading.

export const SIGNALS = ["unplugged", "used", "up"];
const EARLIEST = 4 * 60;          // 04:00 — before this, unplugging is a trip to the bathroom
const LATEST = 13 * 60;           // 13:00 — after this it is not a morning any more
const BEFORE_ALARM = 45;          // up to 45 min before the alarm still counts as getting up
const STALE_MS = 20 * 60_000;     // a signal that arrives late (phone was offline) is not "now"

const minuteOf = (at) => at.getHours() * 60 + at.getMinutes();
const parseClock = (text) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Whether this signal means he is up and should hear the briefing.
 * @param {{ signal: string, signalAt: Date, now: Date, wake?: string|null, briefedToday?: boolean }} input
 * @returns {{ ok: boolean, reason: string }}
 */
export function shouldBrief({ signal, signalAt, now, wake = null, briefedToday = false }) {
  if (!SIGNALS.includes(signal)) return { ok: false, reason: `unknown signal "${signal}"` };
  if (!(signalAt instanceof Date) || Number.isNaN(signalAt.getTime())) return { ok: false, reason: "no time on the signal" };
  if (briefedToday) return { ok: false, reason: "already briefed him this morning" };
  if (now - signalAt > STALE_MS) return { ok: false, reason: "the signal is more than 20 minutes old" };
  if (signalAt - now > 2 * 60_000) return { ok: false, reason: "the signal is in the future" };
  const at = minuteOf(signalAt);
  if (at < EARLIEST || at >= LATEST) return { ok: false, reason: "not the morning" };
  const alarm = parseClock(wake);
  if (alarm !== null && alarm >= EARLIEST && at < alarm - BEFORE_ALARM) {
    return { ok: false, reason: `more than ${BEFORE_ALARM} min before his ${wake} alarm` };
  }
  return { ok: true, reason: `phone ${signal === "unplugged" ? "unplugged" : "in use"} at ${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}` };
}

/** "9", "9:30", "1:15" — how a time is said aloud. */
export function spokenClock(minute) {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? String(twelve) : `${twelve}:${String(m).padStart(2, "0")}`;
}

function listOf(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const cleanTitle = (title) => String(title).replace(/ — .*$/, "").replace(/\s+/g, " ").trim();

/** One sentence about the day's weather from open-meteo hours (orion-watches' shape). */
export function weatherLine(weather, nowMinute) {
  const hours = (weather?.hours ?? []).filter((h) => h.day === "today")
    .map((h) => ({ ...h, minute: Number(h.time.slice(11, 13)) * 60 }))
    .filter((h) => h.minute >= nowMinute - 59 && h.minute <= 21 * 60);
  if (!hours.length) return null;
  const temps = hours.map((h) => Math.round(h.tempC));
  const now = temps[0];
  const high = Math.max(...temps);
  const wet = hours.find((h) => h.rainChance >= 50 || h.rainMm >= 0.5 || h.snowCm > 0);
  const temp = high - now >= 3 ? `${now} degrees now, up to ${high}` : `${now} degrees`;
  if (!wet) return `It's ${temp} and dry today.`;
  const what = wet.snowCm > 0 ? "snow" : "rain";
  const when = wet.minute <= nowMinute ? "already" : `from about ${spokenClock(wet.minute)}`;
  return `It's ${temp}, with ${what} ${when} — take a jacket.`;
}

/**
 * The briefing, as it is said aloud: what is on today, when to leave, what is
 * due, the weather, and a question so he can answer.
 * @param {{ now: Date, day: object[], travel: object[], todos: object[], today: string, weather?: object|null }} input
 */
export function composeBriefing({ now, day = [], travel = [], todos = [], today, weather = null }) {
  const nowMinute = minuteOf(now);
  const greeting = nowMinute < 12 * 60 ? "Morning, Nick." : "Hey Nick, you're up.";
  const ahead = day.filter((b) => b.fixed && b.end > nowMinute && !/^commute|^getting (to|back)/i.test(b.title));
  const parts = [greeting];
  if (ahead.length) {
    const named = ahead.slice(0, 4).map((b) => `${cleanTitle(b.title)} at ${spokenClock(b.start)}`);
    const more = ahead.length > 4 ? ` and ${ahead.length - 4} more` : "";
    parts.push(`Today you've got ${listOf(named)}${more}.`);
  } else {
    parts.push("Nothing on the calendar today.");
  }
  const leave = travel.filter((w) => /^(commute to|getting to)/i.test(w.title) && w.start >= nowMinute).sort((a, b) => a.start - b.start)[0];
  if (leave) parts.push(`Leave by ${spokenClock(leave.start)}.`);
  const due = todos.filter((t) => t.dueDate === today && !t.booked).map((t) => cleanTitle(t.title));
  if (due.length) parts.push(`Due today: ${listOf(due.slice(0, 3))}${due.length > 3 ? ` and ${due.length - 3} more` : ""}.`);
  else {
    const open = todos.filter((t) => !t.waiting).map((t) => cleanTitle(t.title));
    if (open.length) parts.push(`Top of your list: ${listOf(open.slice(0, 2))}.`);
  }
  const sky = weatherLine(weather, nowMinute);
  if (sky) parts.push(sky);
  parts.push("Anything you want to change?");
  return parts.join(" ");
}

/** An SF Symbol for an open-meteo weather code, with a moon at night. */
export function weatherSymbol(code, hour = 12) {
  const night = hour < 7 || hour >= 20;
  if (code === 0) return night ? "moon.stars" : "sun.max";
  if (code <= 2) return night ? "cloud.moon" : "cloud.sun";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "cloud.fog";
  if (code >= 51 && code <= 57) return "cloud.drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return code >= 65 ? "cloud.heavyrain" : "cloud.rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "cloud.snow";
  if (code >= 95) return "cloud.bolt.rain";
  return "cloud";
}

/**
 * What the Mac's morning screen shows (2026-10-08: "a nicer view of my day BIG
 * on one side of the screen, and on the other side the weather").
 */
export function buildView({ now, day = [], travel = [], todos = [], today, weather = null }) {
  const nowMinute = minuteOf(now);
  const clock = (minute) => { const h = Math.floor(minute / 60) % 24; return `${h % 12 === 0 ? 12 : h % 12}:${String(minute % 60).padStart(2, "0")}`; };
  const half = (minute) => (Math.floor(minute / 60) % 24 < 12 ? "AM" : "PM");
  const events = day.filter((b) => b.end > nowMinute && !/^commute|^getting (to|back)/i.test(b.title))
    .slice(0, 7).map((b) => ({ title: cleanTitle(b.title), start: clock(b.start), half: half(b.start), end: clock(b.end), kind: b.kind ?? "other", fixed: !!b.fixed }));
  const leave = travel.filter((w) => /^(commute to|getting to)/i.test(w.title) && w.start >= nowMinute).sort((a, b) => a.start - b.start)[0];
  const due = todos.filter((t) => t.dueDate === today && !t.booked).map((t) => cleanTitle(t.title)).slice(0, 4);
  const top = due.length ? [] : todos.filter((t) => !t.waiting).map((t) => cleanTitle(t.title)).slice(0, 3);
  const hours = (weather?.hours ?? []).filter((h) => h.day === "today" && Number(h.time.slice(11, 13)) * 60 >= nowMinute - 59);
  const sky = hours.length ? (() => {
    const temps = hours.map((h) => Math.round(h.tempC));
    const first = hours[0]; const hour = Number(first.time.slice(11, 13));
    return {
      now: temps[0], high: Math.max(...temps), low: Math.min(...temps), symbol: weatherSymbol(first.code ?? 0, hour),
      line: weatherLine(weather, nowMinute),
      hours: hours.filter((_, i) => i % 2 === 0).slice(0, 8).map((h) => {
        const at = Number(h.time.slice(11, 13));
        return { label: `${spokenClock(at * 60)} ${at < 12 ? "AM" : "PM"}`, temp: Math.round(h.tempC), rain: Math.round(h.rainChance ?? 0), symbol: weatherSymbol(h.code ?? 0, at) };
      }),
    };
  })() : null;
  return {
    generatedAt: now.toISOString(),
    greeting: nowMinute < 12 * 60 ? "Good morning, Nick" : "You're up, Nick",
    date: now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }),
    events, leaveBy: leave ? `${clock(leave.start)} ${half(leave.start)}` : null, due, top, weather: sky,
  };
}
