// Rule-based reading of a workout description (orion-workout-log): the patterns that never need a model, and the check that keeps
// the model honest. "bench 3x8 at 135", "incline db 3x10 w 50s", "20 min on the stairmaster", "3 mile run", "push day".
// Pure; returns a partial draft (workout-draft shape in schema.mjs) with only what the words actually say.
const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60 };
export const CARDIO_WORDS = String.raw`(?:run|ran|running|jog|jogged|jogging|walk|walked|walking|hike|hiked|hiking|bike|biked|biking|cycle|cycled|cycling|swim|swam|swimming|row|rowed|rowing|rower|stair ?master|stairs|stair climber|treadmill|elliptical|spin|spinning|hiit|sprints?|cardio|bike ride)`;
const SPORT_WORDS = /\b(?:basketball|soccer|football|tennis|squash|badminton|pickleball|volleyball|climbing|bouldering|boxing|bjj|jiu jitsu|muay thai|rugby|hockey|golf|frisbee|padel|yoga|pilates|skiing|surfing|skating|martial arts)\b/i;
const BODYWEIGHT = /\b(?:pull ?-?ups?|chin ?-?ups?|push ?-?ups?|dips?|planks?|sit ?-?ups?|crunch(?:es)?|burpees?|lunges?|air squats?|bodyweight|leg raises?|mountain climbers?|handstands?|muscle ?-?ups?|abs?)\b/i;
export const isBodyweight = (name) => BODYWEIGHT.test(name);

/** Every number the words contain (digits and small number words), plus "an hour" and its kin as minutes: what a model's number must match. */
export function numbersIn(text) {
  const s = String(text ?? "").toLowerCase();
  const found = new Set((s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number));
  for (const w of s.split(/[^a-z]+/)) if (WORD_NUM[w] !== undefined) found.add(WORD_NUM[w]);
  if (/\bhalf (?:an |a )?hour\b/.test(s)) found.add(30);
  if (/\b(?:an|one|1) hour and a half\b|\bhour and a half\b|\b1\.5 hours?\b/.test(s)) found.add(90);
  if (/\b(?:an|a|one) hour\b/.test(s)) found.add(60);
  if (/\b(\d+(?:\.\d+)?) ?(?:hours?|hrs?|h)\b/.test(s)) for (const m of s.matchAll(/(\d+(?:\.\d+)?) ?(?:hours?|hrs?|h)\b/g)) found.add(Math.round(Number(m[1]) * 60));
  return found;
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const unitOf = (u) => (/^kg/i.test(u ?? "") ? "kg" : u ? "lb" : "");
const clean = (name) => name.replace(/\b(?:and|then|also|did|i|just|so|first|next|after that|after|for|the|some|my|a|an|on|with|did a|started with|finished with|finished off with|did like)\b/gi, " ")
  .replace(/\b(?:push|pull|leg|legs|chest|back|arm|arms|upper|lower|full body|shoulder|shoulders)\s+day\b/gi, " ").replace(/[^a-z0-9' -]+/gi, " ").replace(/\s+/g, " ").trim();

const WEIGHT = String.raw`(?:@|at|w|with|using|x|using)?\s*(\d+(?:\.\d+)?)\s*(lbs?|pounds?|kgs?|kilos?|#)?s?`;
const SETS_X_REPS = new RegExp(String.raw`(\d+)\s*(?:x|×|sets? of|sets? x)\s*(\d+)(?:\s*reps?)?(?:\s*${WEIGHT})?`, "i");

/** One comma/then separated piece of the description as a lift, or null. */
function liftIn(segment) {
  const m = SETS_X_REPS.exec(segment);
  if (!m) return null;
  let sets = num(m[1]), reps = num(m[2]), weight = m[3] ? num(m[3]) : 0, unit = unitOf(m[4]);
  // "135x8": a weight and its reps, one set (no one does 135 sets).
  if (sets > 20 && reps <= 50 && !m[3]) { weight = sets; sets = 1; }
  const before = clean(segment.slice(0, m.index).replace(/^[^:]*:/, ""));   // "legs: squats 4x6": the colon ends the split name
  const after = m[3] ? "" : clean(segment.slice(m.index + m[0].length).replace(/\b(?:at|w|with|@)\s*\d.*$/i, ""));
  const name = before || after;
  if (!name || sets < 1 || sets > 20 || reps < 1 || reps > 200) return null;
  const tail = /\b(?:at|w|with|@)\s*(\d+(?:\.\d+)?)\s*(lbs?|pounds?|kgs?|kilos?)?s?\b/i.exec(segment.slice(m.index + m[0].length));
  if (!weight && tail) { weight = num(tail[1]); unit = unitOf(tail[2]); }
  return { name: name.slice(0, 60), sets, reps, weight, unit: weight ? unit || "lb" : "" };
}

const DIST = /(\d+(?:\.\d+)?)\s*(miles?|mi|km|kms|kilometers?|kilometres?|k)\b/i;
const MINS = /(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|min|m)\b/i;
const MACHINE = /\b(stair ?master|treadmill|elliptical|rower|rowing machine|bike|spin bike|stair climber|assault bike|peloton)\b/i;
const ACTIVITY = new RegExp(String.raw`\b${CARDIO_WORDS}\b`, "i");

/** Total time ("55 min", "an hour", "1.5 hours"), or 0. Minutes that sit next to a cardio word belong to that cardio, not the whole session. */
function totalMinutes(text, cardioMinutes) {
  const s = text.toLowerCase();
  const hours = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b(?:\s*(?:and\s*)?(\d+)\s*(?:minutes?|mins?|m)\b)?/.exec(s);
  if (hours) return Math.round(num(hours[1]) * 60 + num(hours[2]));
  if (/\bhalf (?:an |a )?hour\b/.test(s)) return /\b(?:\d+|a|an) ?(?:min|minutes)? ?(?:on|of)\b/.test(s) ? 0 : 30;
  if (/\bhour and a half\b/.test(s)) return 90;
  if (/\b(?:an|a|one) hour\b/.test(s)) return 60;
  for (const m of s.matchAll(new RegExp(MINS.source, "gi"))) {
    const v = num(m[1]);
    if (cardioMinutes.includes(v)) continue;
    return v;
  }
  return 0;
}

/** Cardio blocks: "20 min on the stairmaster", "3 mile run", "ran 5k in 28 minutes", "30 min walk". */
function cardioIn(segments) {
  const out = [];
  for (const seg of segments) {
    if (SETS_X_REPS.test(seg) && !ACTIVITY.test(seg)) continue;
    const activity = ACTIVITY.exec(seg)?.[0];
    const machine = MACHINE.exec(seg)?.[0];
    if (!activity && !machine) continue;
    const d = DIST.exec(seg), t = MINS.exec(seg), h = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/i.exec(seg);
    const km = d && /^k/i.test(d[2]);
    out.push({
      activity: normalise(activity ?? machine), machine: machine ? machine.toLowerCase().replace(/\s+/g, " ") : "",
      minutes: t ? num(t[1]) : h ? Math.round(num(h[1]) * 60) : 0, distance: d ? num(d[1]) : 0, distanceUnit: d ? (km ? "km" : "mi") : "",
    });
  }
  return out;
}
const normalise = (a) => ({ ran: "run", running: "run", jog: "run", jogged: "run", jogging: "run", walked: "walk", walking: "walk", hiked: "hike", hiking: "hike", biked: "bike", biking: "bike", cycled: "bike", cycling: "bike", swam: "swim", swimming: "swim", rowed: "row", rowing: "row", rower: "row" }[String(a).toLowerCase()] ?? String(a).toLowerCase().replace(/\s+/g, " "));

const SPLITS = String.raw`(?:push|pull|legs?|chest|back|arms?|upper|lower|full body|shoulders?|core|abs)`;
// "push day", "did legs", "legs: ...": the split he named. Not "leg press" or "back squat" (an exercise, not the day's focus).
const TITLE = new RegExp(String.raw`\b(${SPLITS})(?:\s+(?:and|&)\s+(?:tris|triceps|bis|biceps|back|shoulders?|chest))?\s+day\b|(?:^|\b(?:did|hit|trained|doing|worked|workout|session|log|just)\s+(?:my |a |some |the )?)(${SPLITS})(?:\s+(?:and|&)\s+(?:tris|triceps|bis|biceps|back|shoulders?|chest))?\b(?!\s+(?:press|curl|curls|extension|extensions|raise|raises|squat|squats|row|rows|fly|flies|pull|deadlift|pulldown|pulldowns))`, "i");
const SPLIT = /\s*(?:,|;|\.\s|\n|\bthen\b|\band then\b|\bafter that\b|\bfollowed by\b|\+)\s*/i;

/** The partial draft the words support. Never invents: a field he did not say is 0, "" or absent. */
export function readRules(text) {
  const said = String(text ?? "").replace(/\s+/g, " ").trim();
  const segments = said.split(SPLIT).filter(Boolean);
  const exercises = segments.map(liftIn).filter(Boolean);
  const cardio = cardioIn(segments);
  const cardioMinutes = cardio.map((c) => c.minutes).filter(Boolean);
  const effort = /\b(?:rpe|effort)\s*(?:of\s*)?(\d{1,2})\b|\b(\d{1,2})\s*\/\s*10\b/i.exec(said);
  const title = TITLE.exec(said);
  const sport = SPORT_WORDS.exec(said)?.[0]?.toLowerCase();
  const startTime = /\bat (\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(said);
  const type = exercises.length && cardio.length ? "mixed" : exercises.length ? "strength" : cardio.length ? "cardio" : sport ? "sport" : title ? "strength" : "unknown";
  const hh = startTime ? num(startTime[1]) % 12 + (/pm/i.test(startTime[3]) ? 12 : 0) : 0;
  return {
    type, title: title ? (title[1] ?? title[2]).toLowerCase() : "",
    day: /\byesterday\b|\blast night\b/i.test(said) ? "yesterday" : "", startTime: startTime ? `${String(hh).padStart(2, "0")}:${startTime[2] ?? "00"}` : "",
    durationMin: totalMinutes(said, cardioMinutes), exercises, cardio, sport: sport ?? "",
    effort: effort ? num(effort[1] ?? effort[2]) : 0, notes: "",
  };
}
