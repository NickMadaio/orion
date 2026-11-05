const WATER = /\b(?:water|bottles?|hydrat\w*|drank|drink|drinking|h2o)\b/i;
const FOOD = /\b(?:ate|eat|eaten|eating|had|have|lunch|dinner|breakfast|snack|meal|food|kcal|calories?|protein|burger|pizza|sandwich|pasta|rice|chicken|coffee|tea|juice|shake|bar|fries|salad|wrap)\b|\d/i;
export function guardIntake(decision, message) {
    if (decision.move !== "tool" || decision.tool !== "log_intake")
        return decision;
    const what = String(decision.args?.what ?? "").toLowerCase();
    const ok = what === "water" ? WATER.test(message) : what === "food" ? FOOD.test(message) : false;
    if (ok)
        return decision;
    return { move: "escalate", tier: "standard", fallback: "log_intake not named in the message", ...(decision.ms !== undefined ? { ms: decision.ms } : {}) };
}
