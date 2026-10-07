// What is worth interrupting Nick for (2026-10-07). Pure: items in, verdicts out.
// The local model only ever answers "important or not"; the rules around it
// decide when it is asked at all.

const norm = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9@+ ]/g, " ").replace(/\s+/g, " ").trim();

/** His important people: a name or number he gave matches the sender. */
export function importantPerson(sender, people = []) {
  const s = norm(sender);
  const digits = String(sender ?? "").replace(/\D/g, "");
  return people.find((p) => {
    const n = norm(p); const d = String(p).replace(/\D/g, "");
    return (n && (s === n || s.includes(n))) || (d.length >= 7 && digits.endsWith(d.slice(-10)));
  }) ?? null;
}

export const URGENT = /\b(urgent|emergency|asap|call me|right now|hospital|accident|are you ok|where are you|deadline (is )?(today|tonight|moved)|cancel(l)?ed|due (today|tonight|tomorrow))\b/i;

/** The question for the local model. One word back. */
export function importancePrompt(item, about) {
  return `You screen ${about.channel} for Nick, a university student (${about.context}). Decide if this one is worth interrupting him for RIGHT NOW: something from a person that needs him, a change to a class, deadline, interview, appointment or money, or anything time-sensitive. NOT worth it: newsletters, promotions, receipts, social media, automated notices, group chatter, small talk.
From: ${String(item.from).slice(0, 80)}
${item.subject ? `Subject: ${String(item.subject).slice(0, 120)}\n` : ""}Text: ${String(item.text).slice(0, 400)}
Answer with one word: important or skip.`;
}

export const parseVerdict = (answer) => /^\W*important/i.test(String(answer)) ? "important" : /^\W*skip/i.test(String(answer)) ? "skip" : null;

/**
 * The verdict for one item. `model` is an async (prompt) => answer or null when
 * no local model may be used (on battery). Without it only his people and
 * plainly urgent words get through — never a guess.
 */
export async function judge(item, { people = [], model = null, about }) {
  const person = importantPerson(item.from, people);
  if (person) return { verdict: "important", why: `from ${person}` };
  if (URGENT.test(`${item.subject ?? ""} ${item.text ?? ""}`)) return { verdict: "important", why: "urgent words" };
  if (!model) return { verdict: "skip", why: "on battery: only his people and urgent words get through" };
  const answer = await model(importancePrompt(item, about));
  const verdict = parseVerdict(answer);
  return verdict ? { verdict, why: "local model" } : { verdict: "skip", why: "the local model gave no clear answer" };
}

/** Weather watch: { condition: "rain"|"snow"|"storm"|"below"|"above"|"wind", value?, day: "today"|"tomorrow" }. */
export function weatherHit(watch, forecast) {
  const hours = (forecast?.hours ?? []).filter((h) => h.day === watch.day);
  if (!hours.length) return null;
  const at = (h) => { const n = Number(h.time.slice(11, 13)); return `${((n + 11) % 12) + 1} ${n >= 12 ? "PM" : "AM"}`; };
  const first = (pred) => hours.find(pred);
  const when = watch.day === "tomorrow" ? "tomorrow" : "today";
  switch (watch.condition) {
    case "rain": { const h = first((x) => x.rainChance >= 60 || x.rainMm >= 0.5); return h ? `Rain likely ${when} from about ${at(h)} (${h.rainChance}% chance).` : null; }
    case "snow": { const h = first((x) => x.snowCm > 0); return h ? `Snow ${when} from about ${at(h)}.` : null; }
    case "storm": { const h = first((x) => x.code >= 95); return h ? `Thunderstorms ${when} around ${at(h)}.` : null; }
    case "wind": { const h = first((x) => x.windKph >= (watch.value ?? 40)); return h ? `Strong wind ${when} around ${at(h)} (${Math.round(h.windKph)} km/h).` : null; }
    case "below": { const h = first((x) => x.tempC < watch.value); return h ? `It drops below ${watch.value}°C ${when} around ${at(h)}.` : null; }
    case "above": { const h = first((x) => x.tempC > watch.value); return h ? `It goes above ${watch.value}°C ${when} around ${at(h)}.` : null; }
    default: return null;
  }
}

/** "rain tomorrow", "below 5", "snow", "wind above 50 today" → a watch, or a TypeError. */
export function parseWeatherWatch(text) {
  const t = norm(text);
  const day = /\btomorrow\b/.test(t) ? "tomorrow" : "today";
  const num = Number((/(-?\d+)/.exec(t) ?? [])[1]);
  if (/\b(below|under|colder than|freez)/.test(t)) return { kind: "weather", condition: "below", value: Number.isFinite(num) ? num : 0, day };
  if (/\b(above|over|hotter than|warmer than)\b/.test(t)) { if (!Number.isFinite(num)) throw new TypeError("give a temperature, e.g. above 25"); return { kind: "weather", condition: "above", value: num, day }; }
  if (/\bwind/.test(t)) return { kind: "weather", condition: "wind", value: Number.isFinite(num) ? num : 40, day };
  for (const c of ["rain", "snow", "storm"]) if (t.includes(c) || (c === "storm" && t.includes("thunder"))) return { kind: "weather", condition: c, day };
  throw new TypeError('say what to watch for: rain, snow, storm, wind, below N or above N (°C), and "tomorrow" if not today');
}
