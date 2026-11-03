// Working with a workout draft (orion-workout-log): merging what a later answer adds, what is still missing, the one follow-up question, and
// the compact line that says what was logged. Pure.
import { isBodyweight } from "./rules.mjs";
import { emptyDraft, kindOf } from "./schema.mjs";

const stem = (w) => w.toLowerCase().replace(/(?:es|s)$/, "");
const words = (name) => name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3).map(stem);
const sameName = (a, b) => { const x = words(a), y = words(b); return x.some((w) => y.includes(w)); };
const same = (a, b) => a.sets === b.sets && a.reps === b.reps && a.weight === b.weight;
const pick = (base, add) => (add ? add : base);

/** `add` laid over `base`: what `add` says wins, what it leaves out stays. Lifts and cardio blocks are matched by name, never doubled. */
export function mergeDrafts(base, add) {
  const exercises = base.exercises.map((e) => ({ ...e }));
  for (const e of add.exercises) {
    const i = exercises.findIndex((x) => sameName(x.name, e.name)) >= 0 ? exercises.findIndex((x) => sameName(x.name, e.name))
      : exercises.findIndex((x) => x.sets && same(x, e));
    if (i < 0) { exercises.push({ ...e }); continue; }
    const x = exercises[i];
    exercises[i] = { name: x.name.length >= e.name.length ? x.name : e.name, sets: pick(x.sets, e.sets), reps: pick(x.reps, e.reps), weight: pick(x.weight, e.weight), unit: e.weight ? e.unit : x.unit };
  }
  const cardio = base.cardio.map((c) => ({ ...c }));
  for (const c of add.cardio) {
    const i = cardio.findIndex((x) => x.activity === c.activity || (x.machine && x.machine === c.machine));
    if (i < 0) { cardio.push({ ...c }); continue; }
    const x = cardio[i];
    cardio[i] = { activity: x.activity, machine: pick(x.machine, c.machine), minutes: pick(x.minutes, c.minutes), distance: pick(x.distance, c.distance), distanceUnit: c.distance ? c.distanceUnit : x.distanceUnit };
  }
  const sport = pick(base.sport, add.sport);
  return { type: kindOf(exercises, cardio, sport) === "unknown" ? (add.type !== "unknown" ? add.type : base.type) : kindOf(exercises, cardio, sport),
    title: pick(base.title, add.title), day: pick(base.day, add.day), startTime: pick(base.startTime, add.startTime), durationMin: pick(base.durationMin, add.durationMin),
    exercises, cardio, sport, effort: pick(base.effort, add.effort), notes: [base.notes, add.notes].filter(Boolean).join("; ").slice(0, 240) };
}
export { emptyDraft };

/** The whole session's minutes: what he said, or the cardio minutes when the session was only cardio. */
export const totalMinutes = (d) => d.durationMin || (d.type === "cardio" ? d.cardio.reduce((a, c) => a + c.minutes, 0) : 0);

/** The important gaps, most important first: [{ key: "what" | "duration" | "sets" | "weight", names? }]. */
export function missingOf(d) {
  const out = [];
  const lifts = d.exercises;
  if (!lifts.length && !d.cardio.length && !d.sport && !d.title) out.push({ key: "what" });
  if (!totalMinutes(d) && !(d.type === "cardio" && d.cardio.some((c) => c.minutes))) out.push({ key: "duration" });
  const noSets = lifts.filter((e) => !e.sets || !e.reps);
  if (noSets.length) out.push({ key: "sets", names: noSets.map((e) => e.name), withWeight: noSets.every((e) => !e.weight && !isBodyweight(e.name)) });
  const noWeight = lifts.filter((e) => e.sets && e.reps && !e.weight && !isBodyweight(e.name));
  if (noWeight.length) out.push({ key: "weight", names: noWeight.map((e) => e.name) });
  return out;
}

const the = (names) => { const n = names.slice(0, 3); return `the ${n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`}`; };
const BIT = {
  what: () => "what did you do (lifts, a run, a sport)",
  duration: () => "roughly how long was it",
  sets: (m) => `what were ${m.withWeight ? "the sets, reps and weight" : "the sets and reps"} on ${the(m.names)}`,
  weight: (m) => `what weight on ${the(m.names)}`,
};

/** One short question covering the two most important gaps ("Nice. Roughly how long was it, and what weight on the squats?"). */
export function questionFor(missing, { second = false } = {}) {
  const bits = missing.slice(0, 2).map((m) => BIT[m.key](m));
  if (!bits.length) return "";
  const text = bits.join(", and ");
  return second ? `Got it. And ${text}?` : `Nice. ${text.charAt(0).toUpperCase()}${text.slice(1)}?`;
}

/** What a skipped gap is called in the "skipped" note. */
export const skippedLabel = (m) => ({ what: "what you did", duration: "how long", sets: `sets and reps for ${m.names?.join(", ")}`, weight: `weight for ${m.names?.join(", ")}` }[m.key]);

const lbl = (n) => String(n).replace(/\.0$/, "");
const liftLine = (e) => `${e.name} ${e.sets && e.reps ? `${e.sets}x${e.reps}` : e.sets ? `${e.sets} sets` : e.reps ? `${e.reps} reps` : ""}${e.weight ? ` at ${lbl(e.weight)}${e.unit === "kg" ? "kg" : ""}` : ""}`.trim();
const cardioLine = (c) => {
  const what = c.machine && c.activity !== c.machine ? `${c.activity} (${c.machine})` : c.activity;
  const bits = [c.distance ? `${lbl(c.distance)} ${c.distanceUnit || "mi"}` : "", c.minutes ? `${lbl(c.minutes)} min` : ""].filter(Boolean);
  return bits.length === 2 ? `${bits[0]} ${what}, ${bits[1]}` : bits.length ? `${bits[0]} ${what}` : what;
};
export const titleOf = (d) => d.title || d.sport || (d.type === "cardio" && d.cardio[0] ? d.cardio[0].activity : "workout");

/** "legs, 55 min, squats 4x6 at 185, RDL 3x8 at 135, leg press 3x12": the compact line. */
export function summaryOf(d) {
  const mins = totalMinutes(d);
  const one = d.type === "cardio" && d.cardio.length === 1;
  const cardio = d.cardio.map((c) => cardioLine(one && !c.minutes ? { ...c, minutes: mins } : c));   // a whole-session time on a single run is that run's time
  const lead = one && !d.title ? [] : [titleOf(d)];
  const parts = [...lead, ...(mins && !one ? [`${lbl(mins)} min`] : []), ...d.exercises.map(liftLine), ...cardio];
  return parts.join(", ");
}
