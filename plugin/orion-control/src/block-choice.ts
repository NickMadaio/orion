/*
 The block a form step picked must be the block his words name (live audit 2026-11-05 T1: "lets reschedule my day, starting with CS Lab at
 12:30" moved "DS Lab 05"; the 9B had a reminder about DS Lab 05 in its context and chose it). Only extend / put / add went through the
 name resolver (block-names.ts); every other verb took whatever block the form said.
 Here every step that acts on a block (move, resize, extend, drop, skip, swap, rename, displace) is checked against his words, with the
 same matcher (nameLevel: 3 the exact title, 2 its words, 1 a code's generic words):
   - his words name a block exactly (a title he said whole) and the step picked another: the exact one wins;
   - his phrase is part of a longer one that names a different block ("lab" inside "cs lab" names New CS Lab, not DS Lab 05): the step is not
     run, and he is asked which, with the candidates named;
   - his words name nothing the step picked, while they do name another block: asked, never guessed.
 A message that names no block at all ("push everything", "move it") is not checked. Pure.
*/
import { nameLevel, norm } from "./block-names.js";
import type { Day, DayBlock, Intent } from "./schedule-flow.js";

const STOP = new Set(["move", "moved", "moving", "push", "pushed", "shift", "put", "reschedule", "reschedul", "swap", "replace", "rename", "change", "make", "drop", "skip", "cancel", "remove", "delete", "extend", "resize", "with", "to", "at", "on", "in", "of", "up", "for", "from", "and", "then", "also", "the", "my", "a", "an",
  "lets", "let", "us", "please", "pls", "can", "you", "could", "would", "i", "starting", "start", "first", "day", "today", "tomorrow", "tonight", "now", "rest", "after", "before", "it", "its", "this", "that", "them", "everything", "all", "out", "into", "instead", "as", "is", "are", "be", "by", "so", "but", "not", "no", "just", "ok", "okay", "actually", "orion", "schedule", "plan", "block", "session", "time", "back", "later", "earlier", "around", "one", "about", "mins", "min", "minutes", "hour", "hours", "pm", "am", "than", "also", "same", "both", "other", "over", "off"]);
const ACTS = new Set<Intent["do"]>(["move", "resize", "extend", "drop", "skip", "swap"]);

const POSITIONAL = /\b(?:after|before|next|first|last|earliest|latest|following|whatever|whichever|other|rest)\b/i;
type Mention = { level: number; words: string[]; n: number };

/** The phrases of his message: runs of words that are not filler, verbs or bare numbers (a clock time breaks a run). */
export function phrases(message: string): string[][] {
  const tokens = norm(message.replace(/\d{1,2}:\d{2}/g, " | ")).replace(/\|/g, " | ").split(" ").filter(Boolean);
  const runs: string[][] = []; let cur: string[] = [];
  for (const t of tokens) { if (t === "|" || STOP.has(t) || (/^\d+$/.test(t) && cur.length === 0) || /^(?:am|pm)$/.test(t)) { if (cur.length) runs.push(cur); cur = []; if (/^\d+$/.test(t) || t === "|") continue; } else cur.push(t); }
  if (cur.length) runs.push(cur);
  const out: string[][] = [];
  for (const run of runs) for (let i = 0; i < run.length; i += 1) for (let n = 1; n <= Math.min(4, run.length - i); n += 1) out.push(run.slice(i, i + n));
  return out;
}

/** The best phrase of his that names this block: the highest level, then the longest. */
export function mentionOf(grams: string[][], block: DayBlock): Mention | undefined {
  let best: Mention | undefined;
  for (const g of grams) {
    const level = nameLevel(g.join(" "), block.title);
    if (level > 0 && (!best || level > best.level || (level === best.level && g.length > best.n))) best = { level, words: g, n: g.length };
  }
  return best;
}
const contains = (outer: string[], inner: string[]): boolean => outer.length > inner.length && outer.some((_, i) => inner.every((w, j) => outer[i + j] === w));
const label = (b: DayBlock): string => `${b.title.replace(/\s+[—–-].*$/, "")} (${span(b)})`;
const clock = (t: string): string => { const [h, m] = t.split(":").map(Number); return `${((h ?? 0) + 11) % 12 + 1}:${String(m ?? 0).padStart(2, "0")} ${(h ?? 0) < 12 ? "AM" : "PM"}`; };
const span = (b: DayBlock): string => `${clock(b.start)}–${clock(b.end)}`;
const blockOf = (ref: string | undefined, day: Day): DayBlock | undefined => {
  if (!ref) return undefined;
  if (/^B\d+$/.test(ref)) return day.blocks[Number(ref.slice(1)) - 1];
  return day.blocks.find((b) => norm(b.title) === norm(ref));
};
const idOf = (b: DayBlock, day: Day): string => `B${day.blocks.indexOf(b) + 1}`;

export type Reconciled = { steps: Intent[] } | { ask: string };

/** The steps with each block pick matched to his words, or the question to ask when they cannot be matched. */
export function reconcileNamed(message: string, steps: readonly Intent[], day: Day): Reconciled {
  const grams = phrases(message);
  if (!grams.length) return { steps: [...steps] };
  const blocks = day.blocks.filter((b) => b.kind !== "commute");
  const mentions = new Map<DayBlock, Mention>();
  for (const b of blocks) { const m = mentionOf(grams, b); if (m) mentions.set(b, m); }
  if (!mentions.size) return { steps: [...steps] };
  const out: Intent[] = [];
  for (const step of steps) {
    if (!ACTS.has(step.do)) { out.push(step); continue; }
    let next = step;
    for (const field of (step.do === "swap" ? ["what", "with"] : ["what"]) as Array<"what" | "with">) {
      const picked = blockOf(step[field], day);
      if (!picked || !blocks.includes(picked)) continue;
      const mine = mentions.get(picked);
      // 1. he said a title whole and the step picked another one: the whole title wins
      const exact = blocks.filter((b) => b !== picked && mentions.get(b)?.level === 3 && (!mine || mine.level < 3 || contains(mentions.get(b)!.words, mine.words)));
      if (exact.length === 1) { next = { ...next, [field]: idOf(exact[0]!, day) }; continue; }
      // 2. his phrase is part of a longer one that names another block: asked
      if (mine) {
        const longer = blocks.filter((b) => b !== picked && mentions.get(b) && contains(mentions.get(b)!.words, mine.words));
        if (longer.length) {
          const top = Math.max(...longer.map((b) => mentions.get(b)!.n));
          const named = longer.filter((b) => mentions.get(b)!.n === top);
          return { ask: `You said "${mentions.get(named[0]!)!.words.join(" ")}", which fits ${named.map(label).join(" or ")}, not ${picked.title.replace(/\s+[—–-].*$/, "")}. I haven't changed anything. Which one do you mean?` };
        }
        continue;
      }
      // 3. his words name other blocks and not the one picked (unless he pointed by position: "whatever is after lab")
      if (!mine && !POSITIONAL.test(message)) {
        const named = [...mentions.keys()];
        return { ask: `You named ${named.slice(0, 3).map(label).join(" or ")}, but I'd picked ${picked.title.replace(/\s+[—–-].*$/, "")}. I haven't changed anything. Which one do you mean?` };
      }
    }
    out.push(next);
  }
  return { steps: out };
}
