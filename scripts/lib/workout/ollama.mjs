// One call to the resident local model for a workout description (orion-workout-log), through Ollama's HTTP API with structured output.
// Same model, context and URL seam as the food estimate (lib/local-model.mjs, ORION_OLLAMA_URL), so it never reloads or evicts the resident 9b.
// Resolves { ok, content, ms } or { ok: false, error, ms }; never throws.
import { residentOptions } from "../local-model.mjs";
import { OLLAMA_URL } from "../food/ollama.mjs";
import { WORKOUT_JSON_SCHEMA } from "./schema.mjs";

export const TIMEOUT_MS = 40_000;

const SYSTEM = [
  "You turn a workout Nick described out loud into JSON. Use ONLY what he said. An unknown number is 0, an unknown text is an empty string. Never invent sets, reps, weights, minutes or distances.",
  "A lift: 'bench 3x8 at 135' is sets 3, reps 8, weight 135. 'incline db 3x10 w 50s' is incline dumbbell press, sets 3, reps 10, weight 50. Unit is lb unless he said kg.",
  "Time on a run, bike or machine goes in cardio (minutes, machine, distance). durationMin is the whole session only if he gave a total.",
  "type: strength (lifting), cardio (run, bike, stairmaster, swim), sport, or mixed. title: the split or focus he named (push, legs, upper) in lowercase. day: 'yesterday' only if he said so. startTime: HH:MM only if he gave a clock time. effort: 1 to 10 only if he gave one.",
  "Reply with the JSON object only.",
].join("\n");

const userPrompt = ({ text, prior, today }) => prior
  ? `Today is ${today}. So far you had: ${JSON.stringify(prior)}\nHe just added: "${text}"\nReturn the full updated workout with what he added filled in.`
  : `Today is ${today}. He said: "${text}"`;

export async function askModel({ text, prior, today }, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS, url = OLLAMA_URL(), now = Date.now } = {}) {
  const started = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const body = { ...residentOptions({ temperature: 0.1 }), stream: false, format: WORKOUT_JSON_SCHEMA,
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userPrompt({ text, prior, today }) }] };
  try {
    const res = await fetchImpl(`${url}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
    if (!res.ok) return { ok: false, error: `the local model answered ${res.status}`, ms: now() - started };
    const content = (await res.json())?.message?.content;
    if (typeof content !== "string" || !content.trim()) return { ok: false, error: "the local model gave an empty answer", ms: now() - started };
    return { ok: true, content, ms: now() - started };
  } catch (error) {
    const aborted = error?.name === "AbortError" || controller.signal.aborted;
    return { ok: false, error: aborted ? `the local model took longer than ${Math.round(timeoutMs / 1000)} s` : "the local model isn't reachable (is Ollama running?)", ms: now() - started };
  } finally { clearTimeout(timer); }
}
