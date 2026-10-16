// Which local model answers what (2026-10-16). One resident model, `qwen3.5:9b`, stays loaded for everything small
// (front desk, standing-check polish, focus judge); the big one, gpt-oss:20b, is only loaded for heavy offline work and
// is unloaded right after (keep_alive 0) so it never evicts the resident one while Nick is working.
import { readAwareness } from "./awareness/state.mjs";
import { seamFacts } from "./reach/facts.mjs";

export const RESIDENT_MODEL = "qwen3.5:9b";
export const HEAVY_MODEL = "gpt-oss:20b";

/** The Ollama fields that keep the resident model loaded, with the context it is loaded at (a different num_ctx reloads it). */
export const residentOptions = (options = {}) => ({
  model: RESIDENT_MODEL, think: false, keep_alive: "24h", options: { ...options, num_ctx: 32768 },
});

/** The heavy model, unloaded as soon as it answers. */
export const heavyOptions = (options = {}) => ({ model: HEAVY_MODEL, keep_alive: 0, options });

/**
 * True when loading the heavy model will not get in Nick's way: he is away from the Mac (idle 5+ min, locked, display
 * asleep) or it is the small hours. Unknown is not "away" by day.
 */
export function nickIsAway({ now = new Date(), dir, env = process.env } = {}) {
  const hour = now.getHours();
  if (hour < 6) return true;
  const given = seamFacts(env);
  if (given) return given.locked === true || given.displayAsleep === true || Number(given.idleSeconds) >= 300;
  const mac = readAwareness({ ...(dir ? { dir } : {}), now }).mac;
  return ["idle", "locked", "asleep"].includes(mac.state);
}
