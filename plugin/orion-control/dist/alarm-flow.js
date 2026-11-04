import { cap, meridiem } from "./sleep-fmt.js";
const FULL = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const ORDER = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const ymd = (d) => d.toLocaleDateString("en-CA");
const plusDays = (date, n) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + n); return ymd(d); };
/** The day turns at 4 AM: at 1am "tomorrow" still means the morning coming up. */
const eveningOf = (now) => ymd(new Date(now.getTime() - 4 * 3_600_000));
const weekdayOf = (date) => ORDER[new Date(`${date}T12:00:00`).getDay()];
const hhmmOf = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
/** The wake date a request means: tomorrow (the coming morning), today, a weekday word (the CLI picks the next), or the next time that clock comes round. */
export function wakeDateArg(day, time, now) {
    if (day === "tomorrow")
        return plusDays(eveningOf(now), 1);
    if (day === "today")
        return ymd(now);
    if (day)
        return day;
    return hhmmOf(now) < time ? ymd(now) : plusDays(ymd(now), 1);
}
/** "tomorrow", "today", "Saturday", or "Saturday 7 Nov" when it is more than a few days out. */
export function dayLabel(date, now) {
    const evening = eveningOf(now);
    if (date === plusDays(evening, 1))
        return "tomorrow";
    if (date === ymd(now) || date === evening)
        return "today";
    const far = (new Date(`${date}T12:00:00`).getTime() - now.getTime()) / 86_400_000 > 5;
    return far ? `${FULL[weekdayOf(date)]} ${new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : FULL[weekdayOf(date)];
}
const say = (text) => ({ outcome: "say", kind: "plain", text });
const done = (tools, reply) => ({ flow: { outcome: "done", calls: tools.map((t) => t.canonical), outputs: tools.map((t) => t.stdout), reply }, tools });
const parse = (stdout) => { try {
    const o = JSON.parse(stdout);
    return o && typeof o === "object" ? o : undefined;
}
catch {
    return undefined;
} };
async function call(run, args, tools) {
    const r = await run(args).catch(() => ({ stdout: "", code: 1 }));
    tools.push({ canonical: `exec orion-sleepplan ${args.join(" ")}`, stdout: r.stdout, exit: r.code });
    return { code: r.code, out: parse(r.stdout) };
}
/** What reached the phone, from its own receipt and the link's state. Never "set" without the phone's say-so. */
async function phoneLine(run, tools) {
    const { out } = await call(run, ["alarms", "--json"], tools);
    if (out?.phone?.state === "confirmed")
        return "Set on your phone.";
    if (out?.link?.fresh)
        return "Sent to your phone.";
    return "Saved, but the phone link isn't running on this Mac, so your phone gets it when the link is back.";
}
const bedLine = (days, date) => {
    const d = days?.find((x) => x.date === date);
    return d ? `Bedtime target ${meridiem(d.sleepBy)}.` : "";
};
const join = (...parts) => parts.filter(Boolean).join(" ");
const failed = (what) => ({ flow: say(`I couldn't ${what} just now, so your alarm is as it was.`), tools: [] });
async function setAlarm(req, run, now) {
    const tools = [];
    const r = await call(run, ["wake-on", "--date", wakeDateArg(req.day, req.time, now), "--time", req.time, "--json"], tools);
    const date = r.out?.changed?.date;
    if (r.code !== 0 || !r.out?.ok || !date)
        return { ...failed("set that"), tools };
    return done(tools, join(`Alarm set for ${meridiem(req.time)} ${dayLabel(date, now)}.`, bedLine(r.out.days, date), await phoneLine(run, tools)));
}
async function alarmOff(req, run, now) {
    const tools = [];
    if (req.days) {
        if (!req.days.length)
            return { flow: say("Which days should I take the alarm off?"), tools };
        const r = await call(run, ["unset", "--days", req.days.join(","), "--json"], tools);
        if (r.code !== 0 || !r.out?.ok)
            return { ...failed("change that"), tools };
        const names = req.days.map((d) => FULL[d]);
        const label = req.days.join() === "sat,sun" ? "weekends" : `${names.join(" and ")}s`;
        return done(tools, join(`No alarm on ${label} from now on.`, await phoneLine(run, tools)));
    }
    const date = req.day ? wakeDateArg(req.day, "00:00", now) : undefined;
    const args = ["wake-on", "--date", date ?? "next", "--time", "off", "--json"];
    const r = await call(run, args, tools);
    const off = r.out?.changed?.date;
    if (r.code !== 0 || !r.out?.ok || !off)
        return { ...failed("turn that off"), tools };
    return done(tools, join(`No alarm ${dayLabel(off, now)}.`, await phoneLine(run, tools)));
}
async function shiftAlarm(req, run, now) {
    const tools = [];
    const r = await call(run, ["shift", "--minutes", String(req.minutes), "--json"], tools);
    if (r.code === 3 || (r.out && !r.out.ok && /no alarm is set/.test(r.out.error ?? ""))) {
        return { flow: say("You don't have an alarm set for the next morning, so there's nothing to move. Tell me a time and I'll set one."), tools };
    }
    const c = r.out?.changed;
    if (r.code !== 0 || !r.out?.ok || !c)
        return { ...failed("move that"), tools };
    const by = Math.abs(req.minutes);
    const howMuch = by % 60 === 0 ? `${by / 60} hr` : `${by} min`;
    const lead = req.minutes > 0 ? `Pushed your alarm back ${howMuch}` : `Moved your alarm ${howMuch} earlier`;
    return done(tools, join(`${lead}, now ${meridiem(c.time)} ${dayLabel(c.date, now)}.`, bedLine(r.out.days, c.date), await phoneLine(run, tools)));
}
async function readAlarms(run, now) {
    const tools = [];
    const r = await call(run, ["alarms", "--json"], tools);
    const o = r.out;
    if (r.code !== 0 || !o?.ok)
        return { ...failed("read your alarms"), tools };
    const ahead = o.alarms ?? [];
    if (!ahead.length)
        return { flow: say("You don't have an alarm set right now. Tell me a time and I'll set one."), tools };
    const [first, ...rest] = ahead;
    const next = o.days?.find((d) => d.date === first.date);
    const then = rest.slice(0, 3).map((a) => `${cap(weekdayOf(a.date))} ${meridiem(a.at)}`);
    const phone = o.phone?.state === "confirmed" ? "It's set on your phone." : o.link?.fresh ? "Sent to your phone, not confirmed yet." : "Your phone hasn't got it yet, the link on this Mac isn't running.";
    return done(tools, join(`Next alarm ${meridiem(first.at)} ${dayLabel(first.date, now)}.`, then.length ? `Then ${then.join(", ")}.` : "", next ? `Bedtime target ${meridiem(next.sleepBy)}.` : "", phone));
}
/** One alarm request, end to end. `now` is the plugin clock. */
export async function runAlarmTurn(req, { run, now }) {
    if (req.kind === "set")
        return setAlarm(req, run, now);
    if (req.kind === "off")
        return alarmOff(req, run, now);
    if (req.kind === "shift")
        return shiftAlarm(req, run, now);
    return readAlarms(run, now);
}
