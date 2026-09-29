// What Nick's real days look like next to his plans (life-patterns).
const median = (values) => {
  if (values.length < 3) return null;
  const s = [...values].sort((a, b) => a - b); const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export function learnPatterns(history) {
  const byKind = {};
  const wakes = []; const sleeps = [];
  for (const h of history) {
    if (h.kind === "wake") { wakes.push(h.minute); continue; }
    if (h.kind === "sleep" && h.minute !== undefined) { sleeps.push(h.minute < 720 ? h.minute + 1440 : h.minute); continue; }
    const k = (byKind[h.kind] ??= { planned: 0, happened: 0, delays: [] });
    k.planned += 1;
    if (h.actualStart !== null && h.actualStart !== undefined) { k.happened += 1; k.delays.push(h.actualStart - h.plannedStart); }
  }
  const out = {};
  for (const [kind, k] of Object.entries(byKind)) {
    const s = [...k.delays].sort((a, b) => a - b); const mid = Math.floor(s.length / 2);
    out[kind] = { planned: k.planned, happened: k.happened, rate: Math.round((k.happened / k.planned) * 100) / 100,
                  medianDelay: s.length === 0 ? null : s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2 };
  }
  const sleepMedian = median(sleeps);
  return { byKind: out, wake: { median: median(wakes), samples: wakes.length },
           sleep: { median: sleepMedian === null ? null : sleepMedian % 1440, samples: sleeps.length } };
}
