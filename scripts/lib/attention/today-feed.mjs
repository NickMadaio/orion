import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir, writeFile, rename, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

/** Path to the Today feed file. Exported for reference; tests never read it. */
export const TODAY_FEED = join(homedir(), ".openclaw/orion-controlled/attention-today.json");

/**
 * Build a versioned Today feed document from ranked attention items.
 *
 * @param {{ now: object[], later: object[], dropped: object[] }} ranked — output of rankAttention
 * @param {{ now: number, outages?: string[] }} options — fixed clock and any unreadable sources
 * @returns {{ version: number, generatedAt: string, interrupt: object[], today: object[], outages: string[], note: string | null }}
 */
export function buildTodayFeed(ranked, { now, outages: given = [] }) {
  // Source names only: collectAttention's { source, message } objects are
  // reduced to their source, so no error text or path reaches the feed.
  const outages = [...new Set(given.map((o) => (typeof o === "string" ? o : o?.source)).filter(Boolean))];
  const hasOutages = outages.length > 0;
  const interrupt = ranked.now;
  const today = ranked.later;
  const isEmpty = interrupt.length === 0 && today.length === 0;

  let note = null;
  if (hasOutages) {
    note = `Could not read: ${outages.join(", ")}. Missing sources are unknown, not quiet.`;
  } else if (isEmpty) {
    note = "Nothing needs you.";
  }

  return {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    interrupt,
    today,
    outages,
    note,
  };
}

/**
 * Write the feed document atomically with private permissions.
 *
 * Creates parent directories (mode 0o700), writes to a temp file in the same
 * directory, sets mode 0o600, then renames into place.
 *
 * @param {string} file — absolute path for the feed JSON
 * @param {{ version: number, generatedAt: string, interrupt: object[], today: object[], outages: string[], note: string | null }} feed
 */
export async function writeTodayFeed(file, feed) {
  const dir = file.slice(0, file.lastIndexOf("/"));
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const tmp = join(dir, `.attention-today-${randomUUID()}.tmp`);
  const data = JSON.stringify(feed, null, 2) + "\n";

  await writeFile(tmp, data, { mode: 0o600 });
  await rename(tmp, file);
}
