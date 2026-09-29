/**
 * @param {Array<{id: string, title: string, kind: string, date: string, start: number, end: number, fixed: boolean, source: string}>} blocks
 * @param {{sideProjectMinutes?: number, gymDays?: number[], gymMinutes?: number, restMinutes?: number, weekday?: number} | null | undefined} config
 * @returns {{met: string[], missing: Array<{need: string, minutes: number}>}}
 */
export function dailyNeeds(blocks, config) {
  const cfg = Object.assign(
    { sideProjectMinutes: 60, gymDays: [1, 3, 5], gymMinutes: 60, restMinutes: 30, weekday: 1 },
    config || {}
  );

  // Sum minutes by kind
  const sums = {};
  for (const b of blocks) {
    if (!sums[b.kind]) sums[b.kind] = 0;
    sums[b.kind] += b.end - b.start;
  }

  const met = [];
  const missing = [];

  // 1. side_project
  const spTotal = sums.side_project || 0;
  if (spTotal >= cfg.sideProjectMinutes) {
    met.push("side_project");
  } else {
    missing.push({ need: "side_project", minutes: cfg.sideProjectMinutes - spTotal });
  }

  // 2. gym (only on gym days)
  if (cfg.gymDays.includes(cfg.weekday)) {
    const gymTotal = sums.gym || 0;
    if (gymTotal >= cfg.gymMinutes) {
      met.push("gym");
    } else {
      missing.push({ need: "gym", minutes: cfg.gymMinutes - gymTotal });
    }
  }

  // 3. rest
  const restTotal = sums.rest || 0;
  if (restTotal >= cfg.restMinutes) {
    met.push("rest");
  } else {
    missing.push({ need: "rest", minutes: cfg.restMinutes - restTotal });
  }

  // 4. meals (at least 2 meal blocks)
  const mealBlocks = blocks.filter((b) => b.kind === "meal");
  if (mealBlocks.length >= 2) {
    met.push("meals");
  } else {
    const shortMeals = 2 - mealBlocks.length;
    missing.push({ need: "meals", minutes: shortMeals * 30 });
  }

  return { met, missing };
}
