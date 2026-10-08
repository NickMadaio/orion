// Inference settings per model for the V3 evaluation (handoff §3.1, §7.2).
// Sampling presets come from the model cards; `think` is translated to what
// each model accepts: Qwen is on/off only (measured 2026-10-08: "low"/"high"
// are identical to on), gpt-oss has low/medium/high and no off, Llama has none.
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)

const QWEN35_OFF = { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0, presence_penalty: 1.5, repeat_penalty: 1 };
const QWEN35_ON = { temperature: 1.0, top_p: 0.95, top_k: 20, min_p: 0, presence_penalty: 1.5, repeat_penalty: 1 };
const QWEN36_ON = { ...QWEN35_ON, presence_penalty: 0 };
const QWEN2B_OFF = { temperature: 1.0, top_p: 1.0, top_k: 20, min_p: 0, presence_penalty: 2.0, repeat_penalty: 1 };
const LLAMA = { temperature: 0.6, top_p: 0.9 };

export function familyOf(model) {
  if (/^qwen3\.5:2b/.test(model)) return "qwen35-2b";
  if (/^qwen3\.5/.test(model)) return "qwen35";
  if (/^qwen3\.6/.test(model)) return "qwen36";
  if (/^gpt-oss/.test(model)) return "gpt-oss";
  if (/^llama/.test(model)) return "llama";
  return "other";
}

/** The model card's sampling for a model with thinking on or off ({} = Ollama's defaults). */
export function cardPreset(model, thinking) {
  switch (familyOf(model)) {
    case "qwen35-2b": return thinking ? QWEN35_ON : QWEN2B_OFF;
    case "qwen35": return thinking ? QWEN35_ON : QWEN35_OFF;
    case "qwen36": return thinking ? QWEN36_ON : QWEN35_OFF;
    case "llama": return LLAMA;
    default: return {};
  }
}

/** Requested "off|low|medium|high" → Ollama's `think` value, plus what was actually applied. */
export function thinkFor(model, level = "off") {
  const fam = familyOf(model);
  if (fam === "llama" || fam === "other") return { think: undefined, applied: "none" };
  if (fam === "gpt-oss") { const v = level === "off" ? "low" : level; return { think: v, applied: v }; }
  return { think: level !== "off", applied: level !== "off" ? "on" : "off" };
}

/**
 * Options for one configuration: temp "card" uses the card preset; a number overrides temperature only.
 * Returns { think, applied, options }.
 */
export function configure(model, { think = "off", temp = "card", ctx = 16384 } = {}) {
  const t = thinkFor(model, think);
  const base = cardPreset(model, t.applied === "on" || ["low", "medium", "high"].includes(t.applied));
  const options = { ...base, ...(temp === "card" ? {} : { temperature: Number(temp) }), num_ctx: ctx };
  return { ...t, options };
}
