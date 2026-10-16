// Which calendar events orion-standing may announce on Discord (2026-10-16 audit, finding 11).
// It built an `urgent(...)` for EVERY event in the next 2 h, including ORION's own movable blocks
// ("Heads up 11:20 AM - finish resume. Starts in 1h 15m. Wrap up what you are on.") and again "Starts in 18m".
// Now: fixed things only (a class, or an appointment with a place and a time), never a block ORION made,
// and never one already announced under the shared class-<start> key.
import { classify, isSocial } from "../life/live-day.mjs";

export const eventKey = (title, at) => `${String(title).trim()}|${at.getTime()}`;

/**
 * @param event { at: Date, title }
 * @param orionKeys Set of eventKey(...) for events ORION booked itself
 * @param announced (key) => owner | null
 */
export function imminentWorthSaying(event, { orionKeys = new Set(), announced = () => null } = {}) {
  if (orionKeys.has(eventKey(event.title, event.at))) return false;
  const fixed = classify(event.title) === "class" || isSocial(event.title);
  if (!fixed) return false;
  const minute = event.at.getHours() * 60 + event.at.getMinutes();
  return !announced(`class-${minute}`);
}
