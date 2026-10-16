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
  // 2026-10-16 audit: on 10-13 five signals (07:18Z-09:10Z) all reached the Mac at 12:27Z, were rejected
  // as stale, and there was no brief all day. A stale signal now briefs ONCE if nothing went out yet and
  // it is still morning; the claim lock makes the rest of the backlog no-ops.
  const stale = now - signalAt > STALE_MS;
  if (stale && now.toLocaleDateString("en-CA") !== signalAt.toLocaleDateString("en-CA")) return { ok: false, reason: "the signal is from another day" };
  if (stale && minuteOf(now) >= LATEST) return { ok: false, reason: "not the morning" };
  if (signalAt - now > 2 * 60_000) return { ok: false, reason: "the signal is in the future" };
  const at = minuteOf(signalAt);
  if (at < EARLIEST || at >= LATEST) return { ok: false, reason: "not the morning" };
  const alarm = parseClock(wake);
  if (alarm !== null && alarm >= EARLIEST && at < alarm - BEFORE_ALARM) {
    return { ok: false, reason: `more than ${BEFORE_ALARM} min before his ${wake} alarm` };
  }
  return { ok: true, reason: `${stale ? "catching up on a missed signal: " : ""}phone ${signal === "unplugged" ? "unplugged" : "in use"} at ${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}` };
}

/**
 * The alarm that actually rang, as "HH:MM": a wake-up he asked for today
 * (orion-wake) or the planner's, whichever is earlier. 2026-10-08: the alarm
 * was moved to 7:15, the planner still said 09:00, and his 7:15 unplug was
 * judged "too early".
 */
export function alarmClock({ planned = null, asked = null, today }) {
  const at = asked ? new Date(asked) : null;
  const mine = at && !Number.isNaN(at.getTime()) && at.toLocaleDateString("en-CA") === today ? at.toTimeString().slice(0, 5) : null;
  if (!mine) return planned;
  return !planned || mine < planned ? mine : planned;
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

/** Plain words for an open-meteo weather code. */
export function describeSky(code) {
  if (code === 0) return "clear";
  if (code === 1) return "mostly sunny";
  if (code === 2) return "partly cloudy";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "foggy";
  if (code >= 51 && code <= 57) return "drizzly";
  if (code >= 61 && code <= 63) return "rainy";
  if (code >= 64 && code <= 67) return "heavy rain";
  if (code >= 80 && code <= 82) return "showery";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snowy";
  if (code >= 95) return "stormy";
  return "cloudy";
}

const WET = (h) => h.rainChance >= 40 || h.rainMm >= 0.2 || h.snowCm > 0;

/**
 * The rest of today's weather (2026-10-08: "i could use a better description
 * and i def want to know high and low aswell as if its raining is huge"):
 * what it's like, the high and low, and whether, when and how likely rain is.
 */
export function weatherFacts(weather, nowMinute) {
  const hours = (weather?.hours ?? []).filter((h) => h.day === "today")
    .map((h) => ({ ...h, minute: Number(h.time.slice(11, 13)) * 60 }))
    .filter((h) => h.minute >= nowMinute - 59);
  if (!hours.length) return null;
  const temps = hours.map((h) => Math.round(h.tempC));
  const daytime = hours.filter((h) => h.minute <= 20 * 60);
  // The condition he will mostly be out in: the most common one before 8 PM.
  const counts = new Map();
  for (const h of daytime.length ? daytime : hours) { const d = describeSky(h.code ?? 3); counts.set(d, (counts.get(d) ?? 0) + 1); }
  const sky = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const wet = hours.filter((h) => WET(h) && h.minute <= 22 * 60);
  let rain = null;
  if (wet.length) {
    const what = wet.some((h) => h.snowCm > 0) ? "snow" : "rain";
    const from = wet[0].minute;
    // The first wet stretch: consecutive wet hours from the first one.
    let to = from;
    for (const h of wet) { if (h.minute <= to + 60) to = h.minute; else break; }
    const chance = Math.max(...wet.map((h) => Math.round(h.rainChance ?? 0)));
    const now = from <= nowMinute;
    rain = { what, from, to: to + 60, chance, now };
  }
  return { sky, now: temps[0], high: weather.dayHigh ?? Math.max(...temps), low: weather.dayLow ?? Math.min(...temps), rain, windy: hours.some((h) => (h.windKph ?? 0) >= 35 && h.minute <= 21 * 60) };
}

/** The spoken weather: "Partly cloudy, 10 degrees now. High of 15, low of 8. No rain today." */
export function weatherLine(weather, nowMinute) {
  const w = weatherFacts(weather, nowMinute);
  if (!w) return null;
  const sky = w.sky[0].toUpperCase() + w.sky.slice(1);
  const parts = [`${sky}, ${w.now} degrees now.`, `High of ${w.high}, low of ${w.low}.`];
  if (!w.rain) parts.push(w.windy ? "No rain, but it's windy." : "No rain today.");
  else {
    const span = `${spokenClock(w.rain.from)} to ${spokenClock(w.rain.to)}`;
    const likely = w.rain.chance >= 70 ? "likely" : "possible";
    parts.push(w.rain.now
      ? `It's ${w.rain.what === "snow" ? "snowing" : "raining"} now, until about ${spokenClock(w.rain.to)} — take an umbrella.`
      : `${w.rain.what === "snow" ? "Snow" : "Rain"} ${likely} from ${span}, ${w.rain.chance}% chance — take an umbrella.`);
  }
  return parts.join(" ");
}

/** The same, short, for the screen: "Rain 2–5 PM · 70%" or "No rain today". */
export function rainLabel(rain) {
  if (!rain) return "No rain today";
  const ampm = (m) => `${spokenClock(m)} ${Math.floor(m / 60) % 24 < 12 ? "AM" : "PM"}`;
  const word = rain.what === "snow" ? "Snow" : "Rain";
  return rain.now ? `${word} now, until ${ampm(rain.to)}` : `${word} ${ampm(rain.from)} – ${ampm(rain.to)} · ${rain.chance}%`;
}

/**
 * The briefing, as it is said aloud: what is on today, when to leave, what is
 * due, the weather, and a question so he can answer.
 * @param {{ now: Date, day: object[], travel: object[], todos: object[], today: string, weather?: object|null, calendar?: "ok"|"unknown", missed?: object[] }} input
 */
export function composeBriefing({ now, day = [], travel = [], todos = [], today, weather, calendar = "ok", missed = [] }) {
  const nowMinute = minuteOf(now);
  const greeting = nowMinute < 12 * 60 ? "Morning, Nick." : "Hey Nick, you're up.";
  const real = day.filter((b) => !/^commute|^getting (to|back)/i.test(b.title));
  const ahead = real.filter((b) => b.fixed && b.end > nowMinute);
  const upcoming = real.filter((b) => b.end > nowMinute).sort((a, b) => a.start - b.start);
  const parts = [greeting];
  // 2026-10-16 audit: "Nothing on the calendar today" was said on 2026-10-15 with four blocks planned. A failed
  // or empty read is UNKNOWN, never "nothing", and the words come from every block left today, not only fixed ones.
  if (calendar === "unknown") {
    parts.push("I couldn't read your calendar just now, so I don't have your day. Ask me again in a minute.");
  } else if (!real.length) {
    parts.push("I'm not seeing anything on your calendar, but I can't be sure the read was complete.");
  } else if (ahead.length) {
    const named = ahead.slice(0, 4).map((b) => `${cleanTitle(b.title)} at ${spokenClock(b.start)}`);
    const more = ahead.length > 4 ? ` and ${ahead.length - 4} more` : "";
    parts.push(`Today you've got ${listOf(named)}${more}.`);
  } else if (upcoming.length) {
    const named = upcoming.slice(0, 4).map((b) => `${cleanTitle(b.title)} at ${spokenClock(b.start)}`);
    parts.push(`Nothing fixed left today. Coming up: ${listOf(named)}${upcoming.length > 4 ? ` and ${upcoming.length - 4} more` : ""}.`);
  } else {
    parts.push("Everything on today's calendar is already behind us.");
  }
  for (const b of missed) parts.push(`${cleanTitle(b.title)} was at ${spokenClock(b.start)} and it looks like it didn't happen - no stress. Want me to move the work around?`);
  const leave = travel.filter((w) => /^(commute to|getting to)/i.test(w.title) && w.start >= nowMinute).sort((a, b) => a.start - b.start)[0];
  if (leave) parts.push(`Leave by ${spokenClock(leave.start)}.`);
  const due = todos.filter((t) => t.dueDate === today && !t.booked).map((t) => cleanTitle(t.title));
  if (due.length) parts.push(`Due today: ${listOf(due.slice(0, 3))}${due.length > 3 ? ` and ${due.length - 3} more` : ""}.`);
  else {
    const open = todos.filter((t) => !t.waiting).map((t) => cleanTitle(t.title));
    if (open.length) parts.push(`Top of your list: ${listOf(open.slice(0, 2))}.`);
  }
  const sky = weatherLine(weather, nowMinute);
  // weather === null means it was asked for and failed (undefined: not asked): say so instead of dropping it silently.
  if (sky) parts.push(sky);
  else if (weather === null) parts.push("I couldn't get the weather just now - check the forecast before you head out.");
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
    const facts = weatherFacts(weather, nowMinute);
    return {
      now: temps[0], high: facts?.high ?? Math.max(...temps), low: facts?.low ?? Math.min(...temps), symbol: weatherSymbol(first.code ?? 0, hour),
      line: weatherLine(weather, nowMinute), sky: facts?.sky ?? null, rain: rainLabel(facts?.rain ?? null), wet: !!facts?.rain,
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
