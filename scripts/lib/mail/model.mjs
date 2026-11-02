// The local model's second opinion, for borderline mail only (wave 14, 2026-11-02).
//
// qwen3.5:4b, loaded the way the front desk and the watchdog's warm-up load it (same tag, same num_ctx, so a call never reloads it),
// with Ollama's JSON mode and a hard timeout. The answer must be exactly {"important": true|false, "why": "..."}; anything else, a
// timeout, or Ollama being down is "no opinion", and the caller falls back to the rules. The model sees headers and the snippet only.

export const MAIL_MODEL = "qwen3.5:4b-q4_K_M";
export const MAIL_MODEL_CTX = 16384;
export const MAIL_MODEL_TIMEOUT_MS = 15_000;
export const OLLAMA_URL = "http://127.0.0.1:11434";

/** The question. His own rules are listed so the model leans the way he does. */
export function mailPrompt(item, { prefs, reasons = [] } = {}) {
  const taught = (prefs?.rules ?? []).slice(-12).map((r) => `${r.action === "mute" ? "not important" : "important"}: ${r.kind} ${r.value}`);
  return [
    "You screen email for Nick, a university student (Northeastern University London). Decide if this email is worth a quiet heads-up:",
    "something from a real person that needs him, a class, deadline, interview, appointment, money or account security matter.",
    "NOT worth it: newsletters, promotions, receipts, social media, automated notices, mass mailings.",
    taught.length ? `What he has told you: ${taught.join("; ")}.` : "",
    `From: ${item.fromName ? `${item.fromName} ` : ""}<${item.fromAddress}>`,
    `Subject: ${item.subject.slice(0, 160)}`,
    `Preview: ${item.snippet.slice(0, 240)}`,
    reasons.length ? `Rule signals: ${reasons.join(", ")}.` : "",
    'Answer with JSON only: {"important": true or false, "why": "<at most 8 words>"}',
  ].filter(Boolean).join("\n");
}

/** {"important": bool, "why": string} from the model's text, or null when it is not exactly that shape. */
export function parseMailAnswer(text) {
  let value;
  try { value = JSON.parse(String(text ?? "").trim()); } catch { return null; }
  if (!value || typeof value !== "object" || typeof value.important !== "boolean") return null;
  return { important: value.important, why: typeof value.why === "string" ? value.why.slice(0, 80) : "" };
}

/**
 * Ask the model. Returns { important, why } or null (no opinion). Never throws.
 * fetchImpl and url are seams for tests (a fake Ollama).
 */
export async function askModel(item, { prefs, reasons, fetchImpl = fetch, url = OLLAMA_URL, timeoutMs = MAIL_MODEL_TIMEOUT_MS, onUsage = () => {} } = {}) {
  try {
    const response = await fetchImpl(`${url}/api/generate`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: MAIL_MODEL, prompt: mailPrompt(item, { prefs, reasons }), stream: false, think: false, format: "json",
        keep_alive: "24h", options: { temperature: 0, num_ctx: MAIL_MODEL_CTX, num_predict: 60 } }),
    });
    if (!response.ok) return null;
    const body = await response.json();
    onUsage({ model: MAIL_MODEL, input: body.prompt_eval_count ?? 0, output: body.eval_count ?? 0 });
    return parseMailAnswer(body.response);
  } catch {
    return null;
  }
}
