/*
 A desk "log_intake" move has to be about what he said (w20 R3, live gate #24).
 "yeah log it", answering ORION's own food question, came back from the 4B front desk as log_intake {what: water, amount: 1}: the worker then
 logged the food AND a bottle of water nobody asked for. A water log needs a water word in his message; food logs need a food or drink word
 or an amount. Anything else is escalated, so the worker sees the real conversation (the food it asked about) and not the desk's guess.
*/
import type { Decision } from "./front-desk.js";

const WATER = /\b(?:water|bottles?|hydrat\w*|drank|drink|drinking|h2o)\b/i;
const FOOD = /\b(?:ate|eat|eaten|eating|had|have|lunch|dinner|breakfast|snack|meal|food|kcal|calories?|protein|burger|pizza|sandwich|pasta|rice|chicken|coffee|tea|juice|shake|bar|fries|salad|wrap)\b|\d/i;

export function guardIntake(decision: Decision, message: string): Decision {
  if (decision.move !== "tool" || decision.tool !== "log_intake") return decision;
  const what = String(decision.args?.what ?? "").toLowerCase();
  const ok = what === "water" ? WATER.test(message) : what === "food" ? FOOD.test(message) : false;
  if (ok) return decision;
  return { move: "escalate", tier: "standard", fallback: "log_intake not named in the message", ...(decision.ms !== undefined ? { ms: decision.ms } : {}) };
}
