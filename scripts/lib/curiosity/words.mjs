// What ORION says when it is curious: templates in code, his casual register, no model (spec 3.4.2, 4.3).
import { spokenClock } from "../reach/morning.mjs";
import { rankTodo } from "../reach/gap.mjs";

const strip = (t) => String(t).replace(/ — .*$/, "");
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/** "till 4", "till 4:30": how a time is said in a question. */
export const tillClock = (minute) => `till ${spokenClock(minute)}`;
/** "2-4", "5:30-6": a window as it reads in the review. */
export const rangeWords = (from, to) => `${spokenClock(from)}-${spokenClock(to)}`;

/** The best open to-do to offer: not booked, not waiting, due soon first (rankTodo). */
export function topTodo(todos, today) {
  const compare = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; };
  const open = (todos ?? []).filter((t) => !t.booked && !t.waiting);
  return [...open].sort((a, b) => compare(rankTodo(a, today), rankTodo(b, today)))[0] ?? null;
}

export const words = {
  homeGap: ({ until, todo }) => `${until == null ? "Nothing else planned today" : `Nothing planned ${tillClock(until)}`} - what are you up to? ${todo ? `I could put ${todo.title} there.` : "Want me to put something there?"}`,
  awayGap: ({ place }) => (place ? `At ${place}? I'll log it.` : "What are you up to? I'll log it."),
  unknownPlace: () => "Where are you at? I'll log it.",
  savePlace: () => "You've been here a while - want me to save this spot? What is it?",
  fillBlank: ({ from, to }) => `Quick one for tonight's review - what was ${spokenClock(from)} to ${spokenClock(to)}? Gym, library, nothing?`,
  notStarted: ({ title, start }) => `${cap(strip(title))} was down for ${spokenClock(start)} - not started yet. What's up?`,
  offPlan: ({ title }) => `You're out - is ${strip(title)} still happening, or did plans change? I'll update the calendar.`,
};
