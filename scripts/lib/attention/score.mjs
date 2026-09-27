export const DEFAULT_WEIGHTS = {
  urgency: 0.3,
  importance: 0.2,
  actionability: 0.15,
  confidence: 0.15,
  novelty: 0.1,
  interruptibility: 0.1,
};

const SIGNAL_KEYS = Object.keys(DEFAULT_WEIGHTS);

export function scoreAttentionItem(item, weights = DEFAULT_WEIGHTS) {
  const signals = item?.signals;
  if (!signals || typeof signals !== "object" || Array.isArray(signals)) {
    return {
      score: null,
      known: [],
      unknown: [...SIGNAL_KEYS],
    };
  }

  const known = [];
  const unknown = [];

  for (const key of SIGNAL_KEYS) {
    const val = signals[key];
    if (typeof val === "number" && Number.isFinite(val)) {
      known.push(key);
    } else {
      unknown.push(key);
    }
  }

  if (known.length < 3) {
    return { score: null, known, unknown };
  }

  const weightSum = known.reduce((sum, k) => sum + weights[k], 0);

  if (weightSum === 0) {
    return { score: null, known, unknown };
  }

  const weightedSum = known.reduce(
    (sum, k) => sum + weights[k] * signals[k],
    0
  );

  const rawScore = weightedSum / weightSum;
  const score = Math.round(rawScore * 10000) / 10000;

  return { score, known, unknown };
}
