// One call to the local vision model through Ollama's HTTP API (orion-food-estimate). Photos go as base64 in the
// message's `images`; the answer is held to ESTIMATE_JSON_SCHEMA with structured output. The resident 9b is used at its
// resident context (local-model.mjs), so the call never reloads it or evicts it; the 27b is never loaded from here.
import { readFileSync, statSync } from "node:fs";
import { residentOptions } from "../local-model.mjs";
import { ESTIMATE_JSON_SCHEMA } from "./schema.mjs";
import { SYSTEM, userPrompt } from "./prompt.mjs";

export const OLLAMA_URL = () => process.env.ORION_OLLAMA_URL || "http://127.0.0.1:11434";
export const TEXT_TIMEOUT_MS = 45_000;
export const IMAGE_TIMEOUT_MS = 120_000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const IMAGE_EXT = /\.(jpe?g|png|heic|webp|gif)$/i;

/** Photos as base64, refusing anything that is not a modest image file. Throws a plain sentence. */
export function readImages(paths, read = readFileSync, stat = statSync) {
  return paths.map((p) => {
    if (!IMAGE_EXT.test(p)) throw new Error(`${p} is not a photo I can read (jpg, png, heic, webp)`);
    let size;
    try { size = stat(p).size; } catch { throw new Error(`I can't find the photo at ${p}`); }
    if (size > MAX_IMAGE_BYTES) throw new Error(`the photo at ${p} is too big (over 12 MB)`);
    return read(p).toString("base64");
  });
}

/**
 Asks the model. Resolves { ok: true, content, ms } or { ok: false, error, ms } (never throws): a timeout, Ollama
 not running and a bad HTTP status are each one plain sentence.
*/
export async function askModel({ text, images = [], correction, previous }, { fetchImpl = fetch, timeoutMs, url = OLLAMA_URL(), now = Date.now } = {}) {
  const started = now();
  const limit = timeoutMs ?? (images.length ? IMAGE_TIMEOUT_MS : TEXT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limit);
  const body = {
    ...residentOptions({ temperature: 0.1 }), stream: false, format: ESTIMATE_JSON_SCHEMA,
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userPrompt({ text, imageCount: images.length, correction, previous }), ...(images.length ? { images } : {}) }],
  };
  try {
    const res = await fetchImpl(`${url}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
    if (!res.ok) return { ok: false, error: `the local model answered ${res.status}`, ms: now() - started };
    const json = await res.json();
    const content = json?.message?.content;
    if (typeof content !== "string" || !content.trim()) return { ok: false, error: "the local model gave an empty answer", ms: now() - started };
    return { ok: true, content, ms: now() - started };
  } catch (error) {
    const aborted = error?.name === "AbortError" || controller.signal.aborted;
    return { ok: false, error: aborted ? `the local model took longer than ${Math.round(limit / 1000)} s` : "the local model isn't reachable (is Ollama running?)", ms: now() - started };
  } finally { clearTimeout(timer); }
}
