import { fromCalendarEvents } from "./sources/calendar.mjs";
import { fromWaitingStore } from "./sources/waiting.mjs";
import { fromFocusHistory } from "./sources/focus.mjs";

/**
 * Collect attention items from all configured sources.
 *
 * @param {{ now: number, readers?: object }} options
 * @returns {{ items: object[], outages: { source: string, message: string }[] }}
 */
export async function collectAttention({ now, readers = {} }) {
  const items = [];
  const outages = [];

  // Calendar
  if (typeof readers.calendar === "function") {
    try {
      const events = await readers.calendar();
      const result = fromCalendarEvents(events, { now });
      items.push(...result.items);
    } catch (err) {
      outages.push({ source: "calendar", message: err.message.slice(0, 200) });
    }
  }

  // Waiting
  if (typeof readers.waiting === "function") {
    try {
      const store = await readers.waiting();
      const result = fromWaitingStore(store, { now });
      items.push(...result);
    } catch (err) {
      outages.push({ source: "waiting", message: err.message.slice(0, 200) });
    }
  }

  // Focus history
  if (typeof readers.focusHistory === "function") {
    try {
      const rows = await readers.focusHistory();
      const result = fromFocusHistory(rows, { now });
      items.push(...result);
    } catch (err) {
      outages.push({ source: "focus", message: err.message.slice(0, 200) });
    }
  }

  // Sort: observedAt descending, then id ascending
  items.sort((a, b) => {
    if (b.observedAt !== a.observedAt) return b.observedAt - a.observedAt;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  return { items, outages };
}
