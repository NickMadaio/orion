/**
 * Compute delay of a single record, wrapped into -720..720.
 * Returns null if actualStart is null/undefined.
 */
export function delayOf(record) {
  const { plannedStart, actualStart } = record;
  if (actualStart == null) return null;

  let diff = actualStart - plannedStart;
  // Wrap into -720..720
  while (diff > 720) diff -= 1440;
  while (diff < -720) diff += 1440;
  return diff;
}

/**
 * Compute median of an array of numbers.
 * Median of even count = mean of middle two, then rounded to integer.
 */
function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return Math.round(sorted[mid]);
  } else {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
}

/**
 * Compute on-time rate: share of started records with delay <= 5.
 * Rounded to 2 decimals. Null if no started records.
 */
function onTimeRate(delays) {
  if (delays.length === 0) return null;
  const onTime = delays.filter(d => d <= 5).length;
  return Math.round((onTime / delays.length) * 100) / 100;
}

/**
 * Compute a Stat object from an array of delay values (nulls already filtered for started).
 * @param {number[]} delays - delays for started records
 * @param {number} skipped - count of skipped records
 * @param {number} minSamples
 */
function computeStat(delays, skipped, minSamples) {
  const samples = delays.length + skipped;
  const started = delays.length;
  return {
    samples,
    started,
    skipped,
    medianDelay: median(delays),
    onTimeRate: onTimeRate(delays),
    confident: samples >= minSamples,
  };
}

/**
 * Determine band from plannedStart minute.
 */
function getBand(plannedStart) {
  if (plannedStart >= 300 && plannedStart <= 719) return "morning";
  if (plannedStart >= 720 && plannedStart <= 1019) return "afternoon";
  if (plannedStart >= 1020 && plannedStart <= 1319) return "evening";
  return "night";
}

/**
 * Main analysis function.
 */
export function lateness(records, { minSamples = 3 } = {}) {
  if (!Array.isArray(records)) {
    throw new TypeError("records must be an array");
  }

  // Filter valid records: must have plannedStart and kind
  const valid = records.filter(r => r.plannedStart != null && r.kind != null);

  // Compute delays for all valid records
  const withDelays = valid.map(r => ({
    ...r,
    delay: delayOf(r),
    started: r.actualStart != null,
  }));

  // Overall stat
  const overallDelays = withDelays.filter(r => r.started).map(r => r.delay);
  const overallSkipped = withDelays.filter(r => !r.started).length;
  const overall = computeStat(overallDelays, overallSkipped, minSamples);

  // By kind
  const byKindMap = {};
  for (const r of withDelays) {
    if (!byKindMap[r.kind]) byKindMap[r.kind] = { delays: [], skipped: 0 };
    if (r.started) {
      byKindMap[r.kind].delays.push(r.delay);
    } else {
      byKindMap[r.kind].skipped++;
    }
  }
  const byKind = {};
  for (const [kind, data] of Object.entries(byKindMap)) {
    byKind[kind] = computeStat(data.delays, data.skipped, minSamples);
  }

  // By weekday
  const byWeekdayMap = {};
  for (const r of withDelays) {
    const key = String(r.weekday);
    if (!byWeekdayMap[key]) byWeekdayMap[key] = { delays: [], skipped: 0 };
    if (r.started) {
      byWeekdayMap[key].delays.push(r.delay);
    } else {
      byWeekdayMap[key].skipped++;
    }
  }
  const byWeekday = {};
  for (const [key, data] of Object.entries(byWeekdayMap)) {
    byWeekday[key] = computeStat(data.delays, data.skipped, minSamples);
  }

  // By band
  const bands = ["morning", "afternoon", "evening", "night"];
  const byBandMap = {};
  for (const b of bands) byBandMap[b] = { delays: [], skipped: 0 };
  for (const r of withDelays) {
    const band = getBand(r.plannedStart);
    if (r.started) {
      byBandMap[band].delays.push(r.delay);
    } else {
      byBandMap[band].skipped++;
    }
  }
  const byBand = {};
  for (const b of bands) {
    byBand[b] = computeStat(byBandMap[b].delays, byBandMap[b].skipped, minSamples);
  }

  // Trend: compare median of most recent minSamples started vs previous minSamples started
  // Sort by 'at' ascending (ISO string compare), do not mutate input
  const startedRecords = withDelays.filter(r => r.started);
  let trend = null;
  if (startedRecords.length >= 2 * minSamples) {
    const sortedByAt = [...startedRecords].sort((a, b) => a.at.localeCompare(b.at));
    const older = sortedByAt.slice(0, minSamples).map(r => r.delay);
    const newer = sortedByAt.slice(minSamples, 2 * minSamples).map(r => r.delay);
    const olderMed = median(older);
    const newerMed = median(newer);
    const diff = newerMed - olderMed;
    if (diff >= 10) trend = "worse";
    else if (diff <= -10) trend = "better";
    else trend = "steady";
  }

  // Sentence construction
  const sentence = buildSentence(overall, byKind, minSamples, trend);

  return { overall, byKind, byWeekday, byBand, trend, sentence };
}

/**
 * Build the one-sentence summary for Nick.
 */
function buildSentence(overall, byKind, minSamples, trend) {
  if (!overall.confident) {
    const n = overall.samples;
    const singular = n === 1 ? "check-in" : "check-ins";
    return `Only ${n} ${singular} so far — I'll know your pattern after ${minSamples}.`;
  }

  // Lead with overall median
  const med = overall.medianDelay;
  let lead;
  if (Math.abs(med) <= 5) {
    lead = "You usually start on time";
  } else if (med <= -10) {
    const absMed = Math.round(Math.abs(med) / 5) * 5;
    lead = `You usually start about ${absMed} min early`;
  } else {
    // Round to nearest 5
    const rounded = Math.round(med / 5) * 5;
    lead = `You usually start about ${rounded} min late`;
  }

  // Find worst confident kind whose median is >= 15 min later than overall
  let worstClause = "";
  let worstKind = null;
  let worstMed = med;
  for (const [kind, stat] of Object.entries(byKind)) {
    if (!stat.confident) continue;
    if (stat.medianDelay == null) continue;
    if (stat.medianDelay >= med + 15 && stat.medianDelay > worstMed) {
      worstMed = stat.medianDelay;
      worstKind = kind;
    }
  }
  if (worstKind != null) {
    const roundedWorst = Math.round(worstMed / 5) * 5;
    worstClause = `, worst with ${worstKind} (about ${roundedWorst} min)`;
  }

  // Trend suffix
  let trendSuffix = "";
  if (trend === "better") trendSuffix = " — getting better.";
  else if (trend === "worse") trendSuffix = " — slipping lately.";
  else trendSuffix = ".";

  return lead + worstClause + trendSuffix;
}
