// How a due reminder is worded and sent (w19-reminders). Pure: the reminder, the moment and what the Mac is doing in,
// the orion-reach arguments out. orion-reach still owns the channel (phone when he is away, bubble and voice when he is
// at the Mac) and the gate; this only says what the reminder asks of them.
import { clock12 } from "./schedule.mjs";

/** Activity older than this says nothing: the writer rewrites it at least every 15 s (ACTIVITY CONTRACT). */
export const ACTIVITY_FRESH_MS = 90_000;

const MEETING_APPS = new Set(["us.zoom.xos", "com.microsoft.teams", "com.microsoft.teams2", "com.apple.FaceTime", "com.cisco.webexmeetingsapp", "Cisco-Systems.Spark", "com.tinyspeck.slackmacgap.huddle"]);
const MEETING_SITES = /(^|\.)(meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|whereby\.com|webex\.com)$/i;

/** activity.json, or null when it is missing or too old to trust. */
export function freshActivity(activity, now) {
  const at = Date.parse(activity?.at);
  return Number.isFinite(at) && Math.abs(now.getTime() - at) <= ACTIVITY_FRESH_MS ? activity : null;
}

export const inGame = (activity) => !!activity && (!!activity.game || activity.category === "game");
export const inMeeting = (activity, aw) => !!activity && (MEETING_APPS.has(activity.app?.bundleId) || MEETING_SITES.test(String(activity.domain ?? "")))
  || aw?.calendar?.now?.kind === "meeting";

const GENERIC = new Set(["alarm", "reminder", "timer", ""]);

/** The sentence he hears or reads. */
export function reminderText(reminder, reason, now) {
  const label = String(reminder.label ?? "").trim();
  const generic = GENERIC.has(label.toLowerCase());
  const due = new Date(reminder.dueAt);
  const time = clock12(`${due.getHours()}:${String(due.getMinutes()).padStart(2, "0")}`);
  if (reason === "nudge") return generic ? "Still open: your reminder. Say done, or snooze it." : `Still open: ${label}. Say done, or snooze it.`;
  if (reason === "missed") return generic ? `Missed reminder: it was due at ${time}.` : `Missed reminder: ${label} (it was due at ${time}).`;
  if (reason === "snoozed") return generic ? "Reminder again." : `Reminder again: ${label}.`;
  const body = generic ? `it's ${clock12(`${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`)}, the time you asked me to remind you.`
    : reminder.kind === "timer" ? null : `${label}.`;
  if (reminder.kind === "timer" && !generic) return `${label} is up.`;
  const line = `Reminder: ${body}`;
  return reason === "arrived" ? `${reminder.place && reminder.place !== "home" ? `You're at ${reminder.place}.` : "You're home."} ${line}` : line;
}

/**
 * @param {{ reminder: object, now: Date, reason: "due"|"snoozed"|"missed"|"nudge"|"arrived", activity?: object|null, aw?: object }} input
 * @returns {{ text: string, args: string[], why: string }}
 */
export function deliveryPlan({ reminder, now, reason = "due", activity = null, aw = {} }) {
  const text = reminderText(reminder, reason, now);
  const live = freshActivity(activity, now);
  const away = inGame(live) ? "he is in a game" : inMeeting(live, aw) ? "he is in a meeting" : null;
  const args = [text, "--kind", "reminder", "--why", "a reminder he asked for", "--urgent", "--id", `rem-${reminder.id}-${reason}-${Math.floor(now.getTime() / 1000)}`];
  // Important cuts through a focus session; any other reminder waits for the break (quiet hours still let it through).
  if (!reminder.important) args.push("--hold-in-focus");
  // A game or a call: the Mac speaking over it is the worst place, so the phone takes it (the Mac still shows a silent bubble).
  if (away) args.push("--channel", "phone");
  return { text, args, why: away ?? "he is not in a game or a meeting" };
}
