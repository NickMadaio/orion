// "Done early" (2026-10-20): the one button that tells ORION he finished what is under way, whatever it is.
// This file decides WHAT is current and which to-do it is, and runs the side effects around the calendar change
// (tick the to-do off, close its check-in loops, end its focus session). The calendar change itself is
// early.mjs / orion-reschedule, so the day rules, the scheduler and the undo journal stay the one existing set.
import { spawnSync } from "node:child_process";
import { earlyContext } from "./early.mjs";
import { normTitle, todoKey } from "./todo-match.mjs";

/** Kinds that are an activity, not work with a to-do behind it: ended now and marked done, no to-do lookup. */
const ACTIVITY_KINDS = new Set(["gym", "rest", "meal", "sleep"]);
const wordsOf = (t) => normTitle(t).split(" ").filter((w) => w.length >= 2);

/**
 * What is happening now on today's plan.
 * @returns { kind: "class", block, context } | { kind: "task" | "activity", block } | { kind: "none" }
 */
export function findCurrent(blocks, { now, commuteMinutes = 45, only = null }) {
  // `only`: a hint from an older button. "block" never ends a class (a check-in's Done during class is about its own block);
  // "class" only acts on a class.
  const ctx = earlyContext(blocks, { now, commuteMinutes });
  if (only === "class" && ctx.kind !== "after-class") return { kind: "none" };
  if (only !== "block" && ctx.kind === "after-class") return { kind: "class", block: blocks.find((b) => b.id === ctx.classId), context: ctx };
  // Movable (or pinned: his stated time, ORION's block) and really under way; never one already logged as done.
  const block = blocks.filter((b) => (b.fixed === false || b.pinned) && !b.logged && b.start <= now && now < b.end)
    .sort((a, b) => b.start - a.start)[0];
  if (!block) return { kind: "none" };
  return { kind: ACTIVITY_KINDS.has(block.kind) ? "activity" : "task", block };
}

/** The legacy `--check` shape the Mac app and the phone decode (kind: after-class | block | none), plus what kind of block. */
export function checkContext(current) {
  if (current.kind === "class") return current.context;
  if (current.kind === "none") return { kind: "none" };
  return { kind: "block", id: current.block.id, title: current.block.title, blockKind: current.kind };
}

/** The to-do tag a block carries (`todo-<key>`), or null. */
export const linkOf = (block) => (block.tags ?? []).find((t) => /^todo-[a-z0-9]{1,14}$/.test(t))?.slice(5) ?? null;

/**
 * The open to-do this block is. The block's own link first; else ONLY an exact (normalised) title match.
 * Anything looser ("Problem set 3" vs "Problem set 4", "Study for macro quiz" vs "Macro quiz") ticks nothing:
 * the to-dos it could be come back as `ambiguous` so he can be told.
 * @returns { todo } | { ambiguous: [todo…] } | { none: true, linked?: true }
 */
export function matchTodo(reminders, block) {
  const key = linkOf(block);
  if (key) {
    const linked = reminders.find((r) => todoKey(r.identifier) === key);
    return linked ? { todo: linked, by: "link" } : { none: true, linked: true };
  }
  const exact = reminders.filter((r) => normTitle(r.title) === normTitle(block.title));
  if (exact.length === 1) return { todo: exact[0], by: "title" };
  if (exact.length > 1) return { ambiguous: exact };
  const mine = normTitle(block.title).split(" ").filter(Boolean);
  const similar = reminders.filter((r) => {
    const theirs = normTitle(r.title).split(" ").filter(Boolean);
    const [short, long] = mine.length <= theirs.length ? [mine, theirs] : [theirs, mine];
    const shared = short.filter((w) => long.includes(w)).length;
    return short.length >= 2 && shared >= short.length - 1 && shared >= 1;
  });
  return similar.length ? { ambiguous: similar } : { none: true };
}

/** Does the block's activity read as the focus session's task ("Finish resume" / "finish the resume")? Whole words, one inside the other. */
export const sameThing = (a, b) => {
  const x = wordsOf(a), y = wordsOf(b);
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length > 0 && short.every((w) => long.includes(w));
};

const run = (bin, argv, extraEnv = {}) => {
  try {
    const r = spawnSync(process.execPath, [bin, ...argv], { encoding: "utf8", timeout: 20000, env: { ...process.env, ...extraEnv } });
    return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
  } catch (error) { return { code: 1, out: String(error.message) }; }
};

/** Close every open check-in / not-started loop about these titles. Best effort: a missing loop is not a failure. */
export function closeLoops(titles, { checkinBin }) {
  let closed = 0;
  for (const title of new Set(titles.filter(Boolean))) {
    const r = run(checkinBin, ["close", title]);
    closed += Number(/^Closed (\d+)/.exec(r.out)?.[1] ?? 0);
  }
  return closed;
}

/** End the focus session if it is running on this task: finished as completed (the app's own `finish`). Returns the task or null. */
export function endFocusSession(titles, { sessionBin }) {
  const status = run(sessionBin, ["status", "--json"]);
  let reply; try { reply = JSON.parse(status.out); } catch { return null; }
  if (!reply?.ok || !["running", "paused", "waiting-for-return"].includes(reply.status) || !reply.task) return null;
  if (!titles.filter(Boolean).some((t) => sameThing(t, reply.task))) return null;
  const done = run(sessionBin, ["finish"]);
  return done.code === 0 ? reply.task : null;
}

const clock12 = (m) => { const h = Math.floor(m / 60) % 24; return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
export { clock12 };

/** The first thing still ahead (not the finished block, not a break he is being given): { title, start } | null. */
export function nextItem(day, { now, skip = [] }) {
  const ahead = day.filter((b) => b.start >= now && !b.logged && !skip.includes(b.id)).sort((a, b) => a.start - b.start)[0];
  return ahead ? { title: ahead.title, start: ahead.start } : null;
}

/**
 * The one short line he reads.
 * @param o { kind, title, ticked: todo title|null, tickFailed, ambiguous: [titles]|null, focusEnded, breakMinutes, next, nothingNext }
 */
export function summaryLine(o) {
  const parts = [];
  const head = o.ambiguous ? `Nice — ${o.title} is done, but I didn't check anything off: it could be ${o.ambiguous.map((t) => `"${t}"`).join(" or ")}.`
    : o.tickFailed ? `${o.title} is done, but I couldn't check off the to-do.`
    : o.ticked ? `Nice — ${o.title} is done and checked off.`
    : `Nice — ${o.title} is done.`;
  parts.push(head);
  if (o.focusEnded) parts.push("Focus session wrapped up.");
  const tail = o.next ? `${o.breakMinutes ? `${o.breakMinutes}-min break, then ` : "Next: "}${o.next.title} at ${clock12(o.next.start)}.`
    : o.breakMinutes ? `${o.breakMinutes}-min break, and nothing else is planned today.` : "Nothing else is planned today.";
  parts.push(tail);
  return parts.join(" ");
}

/** The line when nothing is under way: never an error, and the next item is offered. */
export function nothingLine(next) {
  return next ? `Nothing is on right now. Next up: ${next.title} at ${clock12(next.start)} — want to start it early?`
    : "Nothing is on right now, and nothing else is planned today.";
}

/** The line after leaving a class. */
export function classLine({ title, now, freeFrom, next }) {
  const trip = freeFrom > now ? `${freeFrom - now} min reserved to get home` : "staying on campus for your next class";
  return `Out of ${title} at ${clock12(now)} — ${trip}.${next ? ` Next: ${next.title} at ${clock12(next.start)}.` : ""}`;
}

/**
 * The block a check-in follows, and whether it can be ended now. A Done from a check-in acts on THAT block only.
 * Found by the block id the loop recorded, else the exact title (and its recorded start); two matches is no match.
 * @returns { kind: "gone" } | { kind: "ambiguous" } | { kind: "not-now", block } | the findCurrent shape for that block.
 */
export function findOwn(blocks, checkin, { now, commuteMinutes = 45 }) {
  const window = checkin.blockWindow;
  const sameDay = (b) => !window?.date || !b.date || b.date === window.date;
  let hits = blocks.filter((b) => sameDay(b) && checkin.block && b.id === checkin.block);
  if (!hits.length) {
    hits = blocks.filter((b) => sameDay(b) && normTitle(b.title) === normTitle(checkin.what) && (!Number.isFinite(window?.start) || b.start === window.start));
  }
  if (!hits.length) return { kind: "gone" };
  if (hits.length > 1) return { kind: "ambiguous" };
  const [block] = hits;
  if (!(block.start <= now && now < block.end) || block.logged) return { kind: "not-now", block };
  const ctx = earlyContext(blocks, { now, commuteMinutes });
  if (ctx.kind === "after-class" && ctx.classId === block.id) return { kind: "class", block, context: ctx };
  if (!(block.fixed === false || block.pinned)) return { kind: "not-now", block };
  return { kind: ACTIVITY_KINDS.has(block.kind) ? "activity" : "task", block };
}
