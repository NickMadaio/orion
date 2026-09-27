export const ATTENTION_SOURCES = ["calendar", "waiting", "focus", "standing", "automation", "manual"];
export const ATTENTION_SIGNALS = ["urgency", "actionability", "novelty", "confidence", "importance", "interruptibility"];

const ID_RE = /^[a-z0-9][a-z0-9:._-]{1,95}$/;
const KIND_RE = /^[a-z_]{1,40}$/;

function isSafePositiveInteger(value) {
  return Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

export function validateAttentionItem(value) {
  const errors = [];

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["item: must be an object"] };
  }

  const keys = Object.keys(value);

  // id
  if (!ID_RE.test(value.id)) {
    errors.push("id: must match /^[a-z0-9][a-z0-9:._-]{1,95}$/");
  }

  // source
  if (!ATTENTION_SOURCES.includes(value.source)) {
    errors.push("source: must be one of " + ATTENTION_SOURCES.join(", "));
  }

  // kind
  if (!KIND_RE.test(value.kind)) {
    errors.push("kind: must match /^[a-z_]{1,40}$/");
  }

  // title
  const titleVal = value.title;
  if (typeof titleVal !== "string" || titleVal.trim().length < 1 || titleVal.trim().length > 200) {
    errors.push("title: must be 1-200 characters");
  }

  // detail
  const detailVal = value.detail;
  if (typeof detailVal !== "string" || detailVal.length > 1000) {
    errors.push("detail: must be a string of at most 1000 characters");
  }

  // observedAt
  if (!isSafePositiveInteger(value.observedAt)) {
    errors.push("observedAt: must be a safe integer >= 0");
  }

  // dueAt
  if (value.dueAt !== null && !isSafePositiveInteger(value.dueAt)) {
    errors.push("dueAt: must be null or a safe integer >= 0");
  }

  // expiresAt
  if (value.expiresAt !== null && !isSafePositiveInteger(value.expiresAt)) {
    errors.push("expiresAt: must be null or a safe integer >= 0");
  }

  // dedupKey
  const dedupVal = value.dedupKey;
  if (typeof dedupVal !== "string" || dedupVal.length < 1 || dedupVal.length > 120) {
    errors.push("dedupKey: must be 1-120 characters");
  }

  // signals
  const sig = value.signals;
  if (sig === null || typeof sig !== "object" || Array.isArray(sig)) {
    errors.push("signals: must be an object with exactly six keys");
  } else {
    const sigKeys = Object.keys(sig).sort();
    const expectedKeys = [...ATTENTION_SIGNALS].sort();
    if (JSON.stringify(sigKeys) !== JSON.stringify(expectedKeys)) {
      errors.push("signals: must have exactly the six signal keys");
    } else {
      for (const key of ATTENTION_SIGNALS) {
        const v = sig[key];
        if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1)) {
          errors.push(`signals.${key}: must be null or a finite number in [0,1]`);
        }
      }
    }
  }

  // extra keys
  const allowedKeys = ["id", "source", "kind", "title", "detail", "observedAt", "dueAt", "expiresAt", "dedupKey", "signals"];
  for (const k of keys) {
    if (!allowedKeys.includes(k)) {
      errors.push(`${k}: unknown field`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function normalizeAttentionItem(value) {
  // Deep-ish copy to avoid mutation
  const signals = value.signals;
  const newSignals = {};
  for (const key of ATTENTION_SIGNALS) {
    if (signals[key] === null) {
      newSignals[key] = null;
    } else {
      let v = signals[key];
      // Clamp finite numbers into [0,1]
      if (typeof v === "number" && Number.isFinite(v)) {
        v = Math.max(0, Math.min(1, v));
      }
      newSignals[key] = v;
    }
  }

  const normalized = {
    id: value.id,
    source: value.source,
    kind: value.kind,
    title: typeof value.title === "string" ? value.title.trim() : value.title,
    detail: (typeof value.detail === "string") ? value.detail.trim() : "",
    observedAt: value.observedAt,
    dueAt: value.dueAt,
    expiresAt: value.expiresAt,
    dedupKey: value.dedupKey,
    signals: newSignals,
  };

  const result = validateAttentionItem(normalized);
  if (!result.ok) {
    throw new TypeError("invalid attention item");
  }

  return normalized;
}
