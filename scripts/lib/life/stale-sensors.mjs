// Tell Nick ONCE what ORION cannot see and how to fix it (2026-10-30). Pure: sensor health in, notices out.
// "Once" is per outage: a sensor is told about again only when it has reported since (its lastAt changed).

const FIX = {
  phone: (since) => `your phone hasn't reported ${since} - open ORION on it`,
  mac: (since) => `the Mac app hasn't reported ${since} - open ORION from the menu bar`,
  whoop: (since) => `WHOOP hasn't synced ${since} - open the WHOOP app to sync`,
};
// WHOOP syncs when its app opens, not on a clock: only a long gap is worth a message.
const MIN_AGE = { phone: 0, mac: 0, whoop: 12 * 3600_000 };

const sinceWords = (lastAt, now) => {
  if (!lastAt) return "at all yet";
  const d = new Date(lastAt);
  const sameDay = d.toLocaleDateString("en-CA") === now.toLocaleDateString("en-CA");
  if (sameDay) return `since ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  return now - d < 6 * 86_400_000 ? `since ${d.toLocaleDateString("en-US", { weekday: "long" })}` : `since ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
};

/**
 * @param health sensorHealth() result (lib/awareness/facets.mjs)
 * @param told   { phone: lastAt|"none", ... } what has been said already (stored by the caller)
 * @returns {{ notices: {sensor, lastAt, text}[], told: object }} `told` is the new record; the caller stores it
 */
export function sensorNotices({ health, told = {}, now }) {
  const notices = [];
  let record = { ...told };
  for (const name of ["phone", "mac", "whoop"]) {
    const h = health?.[name];
    if (!h || h.state !== "stale" || (h.ageMs !== null && h.ageMs < MIN_AGE[name])) continue;
    const key = h.lastAt ?? "none";
    if (record[name] === key) continue;
    notices.push({ sensor: name, lastAt: h.lastAt, text: FIX[name](sinceWords(h.lastAt, now)) });
    record = { ...record, [name]: key };
  }
  return { notices, told: record };
}

/** Notices as sentences: "Your phone hasn't reported since Monday - open ORION on it so I can see you." */
export function noticeLine(notices) {
  return notices.map((n) => `${n.text[0].toUpperCase()}${n.text.slice(1)}.`).join(" ");
}
