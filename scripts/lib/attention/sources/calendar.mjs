import { createHash } from "node:crypto";

/**
 * @param {unknown} events
 * @param {{ now: number, horizonMinutes?: number }} options
 * @returns {{ items: object[], skipped: number }}
 */
export function fromCalendarEvents(events, { now, horizonMinutes = 90 }) {
  if (!Array.isArray(events)) {
    throw new TypeError("events must be an array");
  }

  const items = [];
  let skipped = 0;

  const windowStart = now - 5 * 60_000;
  const windowEnd = now + horizonMinutes * 60_000;

  for (const event of events) {
    // Must be an object with a readable start
    if (typeof event !== "object" || event === null) {
      skipped += 1;
      continue;
    }

    const rawStart = event.start ?? event.startDate;
    const startMs = Date.parse(rawStart);

    if (Number.isNaN(startMs)) {
      skipped += 1;
      continue;
    }

    // Skip all-day events silently
    if (event.isAllDay === true || event.allDay === true) {
      continue;
    }

    // Skip outside window silently
    if (startMs < windowStart || startMs > windowEnd) {
      continue;
    }

    // Build stable key
    let key;
    if (typeof event.identifier === "string" && event.identifier.length > 0) {
      key = event.identifier;
    } else {
      const title = typeof event.title === "string" ? event.title.trim() : "";
      const hashInput = `${title}|${startMs}`;
      const hex = createHash("sha256").update(hashInput).digest("hex");
      key = hex.slice(0, 12);
    }

    // Sanitize key: lowercase, replace non-allowed chars with "-"
    const safeKey = key
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "-");

    const id = `calendar:${safeKey}`;
    const dedupKey = id;

    // Title construction
    let eventTitle = typeof event.title === "string" ? event.title.trim() : "";
    if (eventTitle.length === 0) {
      eventTitle = "Untitled event";
    }

    const minutes = Math.max(0, Math.round((startMs - now) / 60_000));
    let title;
    if (minutes === 0) {
      title = `${eventTitle} starts now`;
    } else {
      title = `${eventTitle} starts in ${minutes} min`;
    }

    // Cut to 200 chars
    if (title.length > 200) {
      title = title.slice(0, 200);
    }

    // Urgency signal
    let urgency;
    if (minutes <= 10) {
      urgency = 0.95;
    } else if (minutes <= 30) {
      urgency = 0.8;
    } else {
      urgency = 0.6;
    }

    const item = {
      id,
      source: "calendar",
      kind: "starting_soon",
      title,
      detail: "",
      observedAt: now,
      dueAt: startMs,
      expiresAt: startMs + 15 * 60_000,
      dedupKey,
      signals: {
        urgency,
        actionability: 0.7,
        novelty: null,
        confidence: 0.9,
        importance: null,
        interruptibility: null,
      },
    };

    items.push(item);
  }

  return { items, skipped };
}
