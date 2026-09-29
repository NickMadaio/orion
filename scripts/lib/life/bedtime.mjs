// How hard to push Nick to sleep (life-bedtime). Plain words; the sleep still
// available is the argument.
const hhmm = (minute) => `${String(Math.floor(((minute % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(((minute % 60) + 60) % 60).padStart(2, "0")}`;
const duration = (minutes) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

export function bedtimeNudge({ state, minutesPastBedtime, nudgesSent, firstFixedTomorrow, sleepNeedMinutes = 480, now }) {
  if (state !== "awake_late" && state !== "winding_down") return { level: "none", recheckInMinutes: 30, message: "" };
  let level;
  let recheckInMinutes;
  if (minutesPastBedtime < 15) { level = "gentle"; recheckInMinutes = 15; }
  else if (minutesPastBedtime < 60 || nudgesSent < 2) { level = "firm"; recheckInMinutes = 10; }
  else { level = "escalated"; recheckInMinutes = 5; }
  let message = `It's ${hhmm(now)}.`;
  if (firstFixedTomorrow !== null && firstFixedTomorrow !== undefined) {
    const available = Math.max(0, ((firstFixedTomorrow - now + 1440) % 1440) - 60);
    message += ` Class at ${hhmm(firstFixedTomorrow)} — go to sleep now and you still get ${duration(available)}.`;
    if (available < 240) message += " I'll adjust tomorrow around a short night — a nap and a lighter afternoon.";
  } else {
    message += " Go to sleep now.";
  }
  void sleepNeedMinutes;
  return { level, recheckInMinutes, message };
}
