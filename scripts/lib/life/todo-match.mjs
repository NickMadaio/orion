// Which open to-do does a phrase mean? One rule for every caller (orion-tasks done, "Done early").
// Exact title first (case and punctuation aside); else the to-dos that have ALL of his words. Two or more is
// a question for him, never a guess. Two-letter words count ("ds lab" is not "cs lab").
const FILLER = new Set(["the", "one", "thing", "that", "this", "task", "todo", "and", "off", "for", "with"]);
const words = (t) => String(t).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 2);
const hasAll = (said, title) => said.length > 0 && said.every((w) => words(title).includes(w));
export const normTitle = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** @returns the open to-dos `wanted` can mean: [] (none), [one], or several (ambiguous). */
export function todoMatches(list, wanted) {
  const said = words(wanted).filter((w) => !FILLER.has(w));
  const exact = list.filter((t) => normTitle(t.title) === normTitle(wanted));
  return exact.length ? exact : list.filter((t) => hasAll(said, t.title));
}

/** A short, calendar-safe key for a reminder identifier: the tag `todo-<key>` links a block to its to-do (tags allow a-z0-9_-, 20 chars). */
export const todoKey = (identifier) => String(identifier ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 14);
export const todoTag = (identifier) => (todoKey(identifier) ? `todo-${todoKey(identifier)}` : null);
