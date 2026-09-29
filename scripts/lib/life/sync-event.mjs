// The change events phone and Mac exchange when either works offline (life-sync-event).
export const EVENT_KINDS = Object.freeze(["capture.add", "reminder.add", "reminder.complete", "reminder.update",
  "tracking.log", "plan.change", "note.append"]);
const DEVICE_RE = /^[a-z0-9-]{1,40}$/;

export function validateEvent(value) {
  const errors = [];
  if (!value || typeof value !== "object") return { ok: false, errors: ["event"] };
  if (typeof value.device !== "string" || !DEVICE_RE.test(value.device)) errors.push("device");
  if (!Number.isSafeInteger(value.clock) || value.clock < 1) errors.push("clock");
  if (!EVENT_KINDS.includes(value.kind)) errors.push("kind");
  if (!Number.isSafeInteger(value.at) || value.at < 0) errors.push("at");
  const plain = value.payload && typeof value.payload === "object" && !Array.isArray(value.payload);
  if (!plain) errors.push("payload");
  else if (Buffer.byteLength(JSON.stringify(value.payload), "utf8") > 8000) errors.push("payload");
  if (!errors.includes("device") && !errors.includes("clock") && value.id !== `${value.device}:${value.clock}`) errors.push("id");
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function makeEvent({ device, clock, kind, payload, at }) {
  const event = { id: `${device}:${clock}`, device, clock, kind, at, payload };
  const check = validateEvent(event);
  if (!check.ok) throw new TypeError(`invalid event: ${check.errors.join(", ")}`);
  return event;
}
