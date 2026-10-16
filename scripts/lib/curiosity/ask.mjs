// The one ask contract (spec C4), shared by the sender and both readers (OutreachContext.swift on the Mac, orion-remote on the phone,
// schedule-flow.ts in the plugin): { askId, type, kind, title?, blockId?, window: { date, start, end }, place }.
//   type  what the loop asked (home-gap, away-gap, unknown-place, save-place, fill-blank, mismatch): its own bookkeeping.
//   kind  what a reader needs: "blank" (what were you doing in this window), "mismatch" (a planned block, by TITLE and id),
//         "save-place" (a question about a place, not a time).
const BLANK = new Set(["blank", "home-gap", "away-gap", "unknown-place", "fill-blank"]);

export const askKind = (type) => (BLANK.has(type) ? "blank" : type === "mismatch" || type === "off-plan" || type === "not-started" ? "mismatch" : String(type ?? "ask"));

/** `ask` as sent to orion-reach, with `kind` filled in; the block title is the caller's (a block id alone means nothing to a reader). */
export const withKind = (ask) => (ask && typeof ask === "object" ? { ...ask, kind: ask.kind ?? askKind(ask.type) } : ask);

/** A window bound as HH:MM: minutes since midnight or text, "now" for none. */
export function clock(value) {
  if (typeof value === "string" && value) return value;
  if (Number.isFinite(value)) return `${String(Math.floor(value / 60) % 24).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  return null;
}
