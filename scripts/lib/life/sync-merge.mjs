// Merge event logs deterministically: both devices reach the same order (life-sync-merge).
import { validateEvent } from "./sync-event.mjs";

const order = (a, b) => a.at - b.at || (a.device < b.device ? -1 : a.device > b.device ? 1 : 0) || a.clock - b.clock;

export function mergeLogs(...logs) {
  const byId = new Map();
  for (const event of logs.flat()) {
    if (!validateEvent(event).ok) continue;
    const seen = byId.get(event.id);
    if (!seen || JSON.stringify(event) < JSON.stringify(seen)) byId.set(event.id, event);
  }
  return [...byId.values()].sort(order);
}

export function since(log, cursor) {
  return mergeLogs(log).filter((e) => e.clock > (cursor?.[e.device] ?? 0));
}
