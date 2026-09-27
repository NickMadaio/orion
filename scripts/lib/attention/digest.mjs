/**
 * Produce a plain-text digest of a Today feed.
 *
 * @param {{ interrupt: Array<{title: string}>, today: Array<{title: string}>, outages: string[], note: string | null }} feed
 * @param {{ max?: number }} [options]
 * @returns {string}
 */
export function attentionDigest(feed, options = {}) {
  const { max = 5 } = options;

  const lines = [];

  // Now section
  if (feed.interrupt.length > 0) {
    lines.push("Now:");
    const shown = feed.interrupt.slice(0, max);
    for (const row of shown) {
      lines.push(`- ${row.title}`);
    }
    if (feed.interrupt.length > max) {
      lines.push(`…and ${feed.interrupt.length - max} more`);
    }
  }

  // Later today section
  if (feed.today.length > 0) {
    lines.push("Later today:");
    const shown = feed.today.slice(0, max);
    for (const row of shown) {
      lines.push(`- ${row.title}`);
    }
    if (feed.today.length > max) {
      lines.push(`…and ${feed.today.length - max} more`);
    }
  }

  // Outage note or quiet message
  if (lines.length === 0) {
    if (feed.outages.length === 0) {
      return "Nothing needs you.";
    } else {
      return `Nothing to show, but ${feed.note}`;
    }
  }

  // If there are outages, append the note as the last line
  if (feed.outages.length > 0) {
    lines.push(feed.note);
  }

  return lines.join("\n");
}
