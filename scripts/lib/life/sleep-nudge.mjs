// The bedtime nudge and escalation engine (W10-F, 2026-11-02). Pure: decide(now, plan, signals, state) -> { actions, state, why }.
// Nick: "Orion should help nudge me to sleep... If I'm doom scrolling he can shut it down."
// Ladder, each rung once per night: soft wind-down (nudgeAt) -> bedtime (sleepBy, names the alarm) -> firmer, with an
// offer (sleepBy+15) -> warning, then dim the Mac + quit games + block phone games/video (projected sleep < 7 h) ->
// lockdown (projected sleep <= lockdownBelowHours): phone social/video/games/browsers until wake + lock the Mac.
// A legit exception (one he told ORION, a calendar night out, schoolwork running now) means no lockdown and at most one
// gentle message. Gaming never voids what he told ORION, but it voids a guessed reason. Never acts on a plan that is not
// Nick's own, or on a sleeping Nick. One rung per tick, so the escalation is slow.
const MIN = 60_000;
export const ACTIVE_MINUTES = 10;
export const DIM_BELOW_HOURS = 7;
export const WARN_GAP_MIN = 15;
export const FIRM_AFTER_MIN = 15;
export const LOCK_GROUPS = ["social", "video", "games", "browsers"];
export const DIM_GROUPS = ["games", "video"];
/** Known game launchers and games. Never an app that can hold unsaved documents: quit-app refuses those too. */
export const GAME_BUNDLES = ["com.mojang.minecraftlauncher", "com.mojang.minecraft", "com.overwolf.curseforge", "com.valvesoftware.steam",
  "com.epicgames.EpicGamesLauncher", "net.battle.app", "com.roblox.RobloxPlayer", "com.riotgames.RiotGames.RiotClient"];
const GAME_NAMES = /minecraft|curseforge|steam|roblox|epic ?games|battle\.net|riot client|valorant|fortnite|league of legends/i;
const FRIENDS = /\bwith\b|friends?\b|party|\bbar\b|\bpub\b|club|birthday|dinner|drinks|hang ?out|game night|concert|formal|cookout|gathering/i;
const SCHOOLWORK = /study|homework|assignment|exam|midterm|final\b|quiz|project|deadline|due\b|essay|paper|report|\blab\b|problem set|pset|thesis|presentation|lecture/i;

const hhmm12 = (d) => { const h = d.getHours(), m = String(d.getMinutes()).padStart(2, "0"); return `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`; };
const hours1 = (h) => `${Math.round(h * 10) / 10}`;
const at = (iso) => new Date(iso).getTime();

export const isGameApp = (bundleId, name) => GAME_BUNDLES.includes(bundleId ?? "") || GAME_NAMES.test(`${bundleId ?? ""} ${name ?? ""}`);

/** Is Nick up? Mac in use (not locked, display on, idle under 10 min) or phone screen on in the last 10 min. */
export function isActive(signals) {
  const mac = signals?.mac ?? {};
  const idle = mac.idleSeconds == null ? NaN : Number(mac.idleSeconds);
  const macUp = mac.locked !== true && mac.displayAsleep !== true && Number.isFinite(idle) && idle < ACTIVE_MINUTES * 60;
  const age = signals?.phone?.usedMinutesAgo;
  const phoneUp = age != null && Number.isFinite(Number(age)) && Number(age) <= ACTIVE_MINUTES;
  return macUp || phoneUp;
}

// HH:MM on the evening's date, pushed to the next day while it is before `floor` (an exception can run past midnight).
function untilInstant(evening, hhmm, floor) {
  const [h, m] = hhmm.split(":").map(Number);
  const [y, mo, d] = evening.split("-").map(Number);
  let t = new Date(y, mo - 1, d, h, m, 0, 0).getTime();
  while (t < floor) t += 24 * 3600_000;
  return t;
}

/** A legit reason tonight, and where it came from. `gaming` voids the guessed (calendar) reasons, never one he told ORION. */
export function legitException({ now, lock, evening, calendar = [], gaming }) {
  const t = now.getTime();
  const stored = lock?.exception;
  if (stored) {
    const floor = lock?.iso ? at(lock.iso) - 6 * 3600_000 : at(`${evening}T12:00:00`);
    const until = stored.until && /^\d{1,2}:\d{2}$/.test(stored.until) ? untilInstant(evening, stored.until, floor) : null;
    if (until == null || t < until) return { legit: true, source: "told", reason: stored.reason ?? null };
  }
  if (gaming) return { legit: false, source: null, reason: null };
  const eveningStart = at(`${evening}T12:00:00`);
  const out = calendar.find((e) => FRIENDS.test(e.title ?? "") && at(e.end) >= t - 90 * MIN && at(e.start) <= t + 6 * 3600_000 && at(e.start) >= eveningStart);
  if (out) return { legit: true, source: "calendar", reason: "friends" };
  const work = calendar.find((e) => (SCHOOLWORK.test(e.title ?? "") || ["study", "deadline"].includes(e.kind)) && at(e.start) <= t && at(e.end) > t);
  if (work) return { legit: true, source: "calendar", reason: "schoolwork" };
  return { legit: false, source: null, reason: null };
}

const fresh = (evening, wakeIso) => ({ evening, wakeIso, done: [], warnAt: null, held: { groups: [], dimmed: false, locked: false } });
const clear = { groups: [], dimmed: false, locked: false };

/** What undoes the rungs this night set. */
function undoActions(state) {
  return [...(state.held.dimmed ? [{ type: "undim" }] : []), ...state.held.groups.map((group) => ({ type: "phone-unblock", group }))];
}

function pickNight(now, plan) {
  const idx = (plan.alarms ?? []).findIndex((a) => at(a.iso) > now.getTime());
  const bed = idx >= 0 ? (plan.bedtimes ?? [])[idx] : null;
  return bed ? { alarm: plan.alarms[idx], bed, lock: (plan.lockdowns ?? [])[idx] ?? null, evening: bed.date } : null;
}

/** The rung messages: plain words, no tool names. */
const say = {
  nudge: (c) => `It's ${hhmm12(c.now)}. Bedtime is ${hhmm12(c.sleepBy)} and you're up at ${hhmm12(c.wake)}${c.tail}. Start winding down when you hit a stopping point.`,
  bedtime: (c) => `It's bedtime (${hhmm12(c.sleepBy)}). Alarm is ${hhmm12(c.wake)}${c.tail}. Phone down and head to bed now and you still get ${hours1(c.hours)}h.`,
  firm: (c) => `It's ${hhmm12(c.now)} and you're still up, ${hours1(c.hours)}h of sleep left before ${hhmm12(c.wake)}. Want me to shut things down so you actually go to bed?`,
  warn: (c) => `Down to ${hours1(c.hours)}h of sleep. In ${WARN_GAP_MIN} minutes I'm dimming the Mac, closing games and blocking games and video on your phone. Tell me if you need it left alone.`,
  lockdown: (c) => `You're at ${hours1(c.hours)}h of sleep before ${hhmm12(c.wake)}, so I've shut off social, video, games and browsers on your phone until morning and locked the Mac. If it's schoolwork or you're out, tell me and I'll undo it.`,
  gentle: (c) => `Heads up, it's ${hhmm12(c.now)} and you're down to ${hours1(c.hours)}h before ${hhmm12(c.wake)}${c.why ? ` (leaving you alone since it's ${c.why})` : ""}. Get to bed when you can.`,
};

function dimActions() {
  return [{ type: "dim" }, ...GAME_BUNDLES.slice(0, 5).map((bundleId) => ({ type: "quit-app", bundleId })),
    { type: "phone-block", groups: DIM_GROUPS, minutes: 120, why: "bedtime wind-down" }];
}

/**
 * actions: message{step,text,why} | dim | undim | quit-app{bundleId} | phone-block{groups,minutes,why} | phone-unblock{group} | lock-screen.
 * `state` is the next persisted state (pass it back next tick). signals: { mac:{idleSeconds,locked,displayAsleep,app,bundleID},
 * phone:{usedMinutesAgo}, calendar:[{title,kind,start,end}], sandbox, drivenByTest }.
 */
export function decide(now, plan, signals = {}, state = null) {
  const idle = (why, st = state) => ({ actions: [], state: st, why });
  if (!plan || plan.source !== "nick") return idle("plan is not Nick's own");
  if (signals.sandbox && !signals.drivenByTest) return idle("evaluation sandbox");
  const t = now.getTime();
  // Wake undo: the rungs of the last night end with its alarm, whether or not he is awake right now.
  if (state?.wakeIso && t >= at(state.wakeIso)) {
    return { actions: undoActions(state), state: { ...state, evening: null, wakeIso: null, done: [], held: clear }, why: "wake: undone" };
  }
  const night = pickNight(now, plan);
  if (!night) return idle("no coming alarm");
  const { alarm, bed, lock, evening } = night;
  const st = state && state.evening === evening ? state : fresh(evening, alarm.iso);
  if (t < at(bed.nudgeAtIso)) return idle("before nudge time", st);
  const hours = (at(alarm.iso) - t) / 3600_000;
  const gaming = isGameApp(signals.mac?.bundleID, signals.mac?.app);
  const ex = legitException({ now, lock, evening, calendar: signals.calendar, gaming });
  // He talked ORION out of it: lift what is held, no relock.
  if (ex.legit && (st.held.dimmed || st.held.groups.length)) {
    return { actions: undoActions(st), state: { ...st, held: clear, done: [...st.done, "lifted"] }, why: "legit exception: lifted" };
  }
  if (!isActive(signals)) return idle("not active: never nudge a sleeping Nick", st);
  const ctx = { now, sleepBy: new Date(bed.sleepByIso), wake: new Date(alarm.iso), hours, why: ex.reason,
    tail: alarm.reason === "class" ? " for class" : alarm.reason === "commitment" ? " for your first commitment" : "" };
  const done = (step) => st.done.includes(step);
  const mark = (steps, extra = {}) => ({ ...st, ...extra, done: [...new Set([...st.done, ...steps])] });
  const msg = (step, text) => ({ type: "message", step, text, why: `sleep-nudge: ${step}` });
  const lockLimit = Number(plan.lockdownBelowHours ?? 6);

  if (ex.legit) {
    const gentleAt = lock ? at(lock.iso) : at(alarm.iso) - lockLimit * 3600_000;
    if (t >= gentleAt && !done("gentle")) return { actions: [msg("gentle", say.gentle(ctx))], state: mark(["gentle"]), why: `exception (${ex.source})` };
    return idle(`exception (${ex.source}): no nudge`, st);
  }
  const sleepByT = at(bed.sleepByIso);
  const due = ["nudge"];
  if (t >= sleepByT) due.push("bedtime");
  if (t >= sleepByT + FIRM_AFTER_MIN * MIN) due.push("firm");
  const warnedLongEnough = done("warn") && t >= at(st.warnAt) + WARN_GAP_MIN * MIN;
  const wantDim = hours < DIM_BELOW_HOURS;

  if (hours <= lockLimit && warnedLongEnough && !done("lockdown")) {
    const minutes = Math.min(480, Math.max(1, Math.ceil((at(alarm.iso) - t) / MIN)));
    const actions = [...(done("dim") ? [] : dimActions().filter((a) => a.type !== "phone-block")),
      { type: "phone-block", groups: LOCK_GROUPS, minutes, why: "bedtime lockdown" }, { type: "lock-screen" }, msg("lockdown", say.lockdown(ctx))];
    return { actions, state: mark(["lockdown", "dim"], { held: { groups: [...new Set([...st.held.groups, ...LOCK_GROUPS])], dimmed: true, locked: true } }), why: "lockdown" };
  }
  if (wantDim && !done("warn")) return { actions: [msg("warn", say.warn(ctx))], state: mark(["warn", ...due], { warnAt: now.toISOString() }), why: "warning before dimming" };
  if (wantDim && warnedLongEnough && !done("dim")) {
    return { actions: dimActions(), state: mark(["dim"], { held: { ...st.held, groups: [...new Set([...st.held.groups, ...DIM_GROUPS])], dimmed: true } }), why: "dim" };
  }
  const next = due.filter((s) => !done(s)).at(-1);
  // A rung he has already outrun is marked done, not sent late in a pile.
  if (next && !wantDim) return { actions: [msg(next, say[next](ctx))], state: mark(due), why: next };
  return idle("nothing due", st);
}
