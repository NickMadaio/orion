// Where Nick is relative to his night (life-sleep-state). Minutes on a 24h clock;
// the night may cross midnight. No activity signal means "unknown", never asleep.
const inNight = (now, bed, wake) => (bed <= wake ? now >= bed && now < wake : now >= bed || now < wake);
const since = (now, bed) => (now >= bed ? now - bed : now + 1440 - bed);

export function sleepState({ now, bedtime, wake, lastActiveMinutesAgo, charging }) {
  if (!inNight(now, bedtime, wake)) return { state: "day", minutesPastBedtime: 0, reason: "Outside the planned night." };
  const minutesPastBedtime = since(now, bedtime);
  if (lastActiveMinutesAgo === null || lastActiveMinutesAgo === undefined) {
    return { state: "unknown", minutesPastBedtime, reason: "No recent phone activity signal." };
  }
  if (lastActiveMinutesAgo <= 5) {
    return { state: "awake_late", minutesPastBedtime, reason: `The phone was used ${lastActiveMinutesAgo} min ago.` };
  }
  if (lastActiveMinutesAgo >= 20 && (charging === true || charging === undefined)) {
    return { state: "probably_asleep", minutesPastBedtime, reason: `No phone use for ${lastActiveMinutesAgo} min${charging ? " and it is charging" : ""}.` };
  }
  return { state: "winding_down", minutesPastBedtime, reason: `Last phone use ${lastActiveMinutesAgo} min ago.` };
}
