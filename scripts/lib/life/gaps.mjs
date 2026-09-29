/**
 * Find free intervals between blocks inside a waking window.
 *
 * @param {object[]} blocks - Array of block objects.
 * @param {{ start: number, end: number }} window - The waking window in minutes.
 * @param {{ buffer?: number, minimum?: number }=} options - Optional configuration.
 * @returns {{ start: number, end: number }[]} Sorted, non-overlapping free gaps.
 */
export function freeGaps(blocks, window, options = {}) {
  const buffer = options.buffer ?? 0;
  const minimum = options.minimum ?? 15;

  // 1. Filter blocks that overlap with the window at all
  const relevantBlocks = blocks.filter(
    (b) => b.start < window.end && b.end > window.start
  );

  if (relevantBlocks.length === 0) {
    return [{ start: window.start, end: window.end }];
  }

  // 2. Clip blocks to the window and apply buffer for fixed blocks
  const processedBlocks = relevantBlocks.map((b) => {
    let start = Math.max(b.start, window.start);
    let end = Math.min(b.end, window.end);

    if (b.fixed && buffer > 0) {
      start = Math.max(start - buffer, window.start);
      end = Math.min(end + buffer, window.end);
    }

    return { start, end };
  });

  // 3. Merge overlapping blocks
  processedBlocks.sort((a, b) => a.start - b.start || a.end - b.end);

  const merged = [processedBlocks[0]];
  for (let i = 1; i < processedBlocks.length; i++) {
    const current = processedBlocks[i];
    const last = merged[merged.length - 1];

    if (current.start <= last.end) {
      // Overlap or adjacent, merge them
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push(current);
    }
  }

  // 4. Compute gaps between merged blocks within the window
  const gaps = [];

  if (merged[0].start > window.start) {
    gaps.push({ start: window.start, end: merged[0].start });
  }

  for (let i = 1; i < merged.length; i++) {
    const gapStart = merged[i - 1].end;
    const gapEnd = merged[i].start;
    if (gapEnd > gapStart) {
      gaps.push({ start: gapStart, end: gapEnd });
    }
  }

  if (merged[merged.length - 1].end < window.end) {
    gaps.push({ start: merged[merged.length - 1].end, end: window.end });
  }

  // 5. Drop gaps shorter than minimum
  return gaps.filter((g) => g.end - g.start >= minimum);
}
