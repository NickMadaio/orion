import { readFile, writeFile, rename, mkdir, access } from "node:fs/promises";
import { dirname } from "node:path";

/** @returns {{ version: 1, items: [] }} */
export function emptyQueue() {
  return { version: 1, items: [] };
}

/**
 * Load the attention queue from a JSON file.
 * ENOENT → emptyQueue(). Invalid content → throw. Other fs errors rethrow.
 */
export async function loadAttentionQueue(file) {
  try {
    const data = await readFile(file, "utf8");
    const parsed = JSON.parse(data);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.items)
    ) {
      throw new Error("attention queue unreadable");
    }
    return parsed;
  } catch (err) {
    if (err.code === "ENOENT") {
      return emptyQueue();
    }
    if (err instanceof SyntaxError || err.message === "attention queue unreadable") {
      throw new Error("attention queue unreadable");
    }
    throw err;
  }
}

/**
 * Save the attention queue atomically: write to temp file then rename.
 * Directory is created with mode 0o700; file written with mode 0o600.
 */
export async function saveAttentionQueue(file, queue) {
  const dir = dirname(file);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const content = JSON.stringify(queue, null, 2) + "\n";
  await writeFile(tmp, content, { mode: 0o600 });
  await rename(tmp, file);
}

/**
 * Add items to the queue. Replaces open/snoozed entries with same dedupKey,
 * preserving their state and surfaced count. Appends new entries as open.
 * Returns a NEW queue; input is never mutated.
 */
export function addToQueue(queue, items, _now) {
  const newItems = queue.items.map((e) => ({ ...e }));

  for (const item of items) {
    const existingIdx = newItems.findIndex(
      (e) => e.dedupKey === item.dedupKey && (e.state === "open" || e.state === "snoozed")
    );

    if (existingIdx !== -1) {
      const existing = newItems[existingIdx];
      newItems[existingIdx] = {
        ...item,
        state: existing.state,
        surfaced: existing.surfaced,
        ackedAt: null,
        snoozedUntil: existing.snoozedUntil,
      };
    } else {
      newItems.push({
        ...item,
        state: "open",
        surfaced: 0,
        ackedAt: null,
        snoozedUntil: null,
      });
    }
  }

  return { ...queue, items: newItems };
}

/**
 * Acknowledge an item by id. Returns a NEW queue.
 */
export function ackQueueItem(queue, id, now) {
  const idx = queue.items.findIndex((e) => e.id === id);
  if (idx === -1) {
    throw new Error(`no attention item ${id}`);
  }

  const newItems = queue.items.map((e) => ({ ...e }));
  newItems[idx] = { ...newItems[idx], state: "acked", ackedAt: now };

  return { ...queue, items: newItems };
}

/**
 * Snooze an item by id until a given timestamp. Returns a NEW queue.
 */
export function snoozeQueueItem(queue, id, until) {
  const idx = queue.items.findIndex((e) => e.id === id);
  if (idx === -1) {
    throw new Error(`no attention item ${id}`);
  }

  const newItems = queue.items.map((e) => ({ ...e }));
  newItems[idx] = { ...newItems[idx], state: "snoozed", snoozedUntil: until };

  return { ...queue, items: newItems };
}

/**
 * Prune expired and old acknowledged entries. Returns a NEW queue.
 */
export function pruneQueue(queue, now) {
  const weekMs = 7 * 86_400_000;
  const pruned = queue.items.filter((e) => {
    if (e.expiresAt !== null && e.expiresAt <= now) {
      return false;
    }
    if (e.state === "acked" && e.ackedAt !== null && e.ackedAt <= now - weekMs) {
      return false;
    }
    return true;
  });

  return { ...queue, items: pruned };
}

/**
 * Return open items: state "open", plus "snoozed" whose snoozedUntil <= now.
 * Excludes expired entries. Returns a NEW array (not mutating queue).
 */
export function openItems(queue, now) {
  return queue.items.filter((e) => {
    if (e.expiresAt !== null && e.expiresAt <= now) {
      return false;
    }
    if (e.state === "open") {
      return true;
    }
    if (e.state === "snoozed" && e.snoozedUntil !== null && e.snoozedUntil <= now) {
      return true;
    }
    return false;
  });
}
