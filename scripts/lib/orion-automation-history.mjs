import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export const HISTORY_STATUSES = ["succeeded", "failed", "refused", "outcome_unknown"];
export const HISTORY_DELIVERIES = [
  "not_requested",
  "withheld",
  "delivered",
  "not_delivered",
  "unknown",
  "not_attempted",
];

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
const REASON_RE = /^[a-z_]{1,64}$/;

export function isHistoryEntry(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  const expected = ["v", "at", "name", "status", "reason", "delivery", "recordedAt"];
  if (keys.length !== expected.length || !expected.every((k) => Object.hasOwn(value, k))) return false;
  if (value.v !== 1) return false;
  if (!Number.isSafeInteger(value.at) || value.at < 0) return false;
  if (typeof value.name !== "string" || !NAME_RE.test(value.name)) return false;
  if (!HISTORY_STATUSES.includes(value.status)) return false;
  if (value.reason !== null && (typeof value.reason !== "string" || !REASON_RE.test(value.reason))) return false;
  if (value.delivery !== null && !HISTORY_DELIVERIES.includes(value.delivery)) return false;
  if (!Number.isSafeInteger(value.recordedAt) || value.recordedAt < 0) return false;
  return true;
}

function validateEntry(entry) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError("invalid history entry");
  const keys = Object.keys(entry);
  const allowed = ["at", "name", "status", "reason", "delivery"];
  if (keys.length !== allowed.length || !allowed.every((k) => Object.hasOwn(entry, k))) throw new TypeError("invalid history entry");
  if (!Number.isSafeInteger(entry.at) || entry.at < 0) throw new TypeError("invalid history entry");
  if (typeof entry.name !== "string" || !NAME_RE.test(entry.name)) throw new TypeError("invalid history entry");
  if (!HISTORY_STATUSES.includes(entry.status)) throw new TypeError("invalid history entry");
  if (entry.reason !== null && (typeof entry.reason !== "string" || !REASON_RE.test(entry.reason))) throw new TypeError("invalid history entry");
  if (entry.delivery !== null && !HISTORY_DELIVERIES.includes(entry.delivery)) throw new TypeError("invalid history entry");
}

export async function appendAutomationHistory(file, entry, opts = {}) {
  const now = opts.now ?? Date.now;
  validateEntry(entry);
  const lineObj = {
    v: 1,
    at: entry.at,
    name: entry.name,
    status: entry.status,
    reason: entry.reason,
    delivery: entry.delivery,
    recordedAt: now(),
  };
  const line = JSON.stringify(lineObj) + "\n";
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await appendFile(file, line, { mode: 0o600, flag: "a" });
  return { recorded: true };
}

export async function readAutomationHistory(file, opts = {}) {
  const since = opts.since ?? 0;
  const until = opts.until ?? Number.MAX_SAFE_INTEGER;
  let content;
  try {
    content = await readFile(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { entries: [], skipped: 0 };
    throw err;
  }
  const lines = content.split("\n");
  let skipped = 0;
  const validEntries = [];
  for (const raw of lines) {
    if (raw.length === 0) continue;
    if (raw.length > 4096) {
      skipped++;
      continue;
    }
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      skipped++;
      continue;
    }
    if (!isHistoryEntry(obj)) {
      skipped++;
      continue;
    }
    validEntries.push(obj);
  }
  const filtered = validEntries.filter((e) => e.at >= since && e.at < until);
  const sorted = [...filtered].sort((a, b) => a.at - b.at);
  return { entries: sorted, skipped };
}

