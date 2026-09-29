// Is this a real reason, a changed plan, or avoidance? (life-deferral)
const PAUSES = [
  [["eat", "eating", "hungry", "starving", "food", "lunch", "dinner"], 25],
  [["shower"], 20],
  [["bathroom", "toilet"], 5],
  [["call", "phone call"], 15],
  [["laundry"], 10],
];
const CHANGES = ["friend", "friends", "invited", "hang out", "class ran late", "running late", "sick", "ill", "headache",
                 "exhausted", "can't keep eyes open", "cant keep eyes open", "emergency"];
const AVOID = ["in a bit", "later", "5 more minutes", "five more minutes", "one more video", "not now", "tomorrow"];
const has = (text, phrase) => new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\']/g, "\\$&")}\\b`, "i").test(text);

export function classifyDeferral(text, context = {}) {
  const deferrals = context.deferralsToday ?? 0;
  const confidence = Math.round(Math.max(0.2, 0.8 - (deferrals >= 2 ? 0.2 : 0)) * 100) / 100;
  const t = String(text ?? "");
  for (const phrase of CHANGES) if (has(t, phrase)) return { kind: "change", minutes: 0, confidence };
  for (const phrase of AVOID) if (has(t, phrase)) return { kind: "avoidance", minutes: 15, confidence };
  for (const [words, minutes] of PAUSES) {
    if (words.some((w) => has(t, w))) {
      if ((context.minutesAvoided ?? 0) >= 60 && deferrals >= 2) return { kind: "avoidance", minutes: 15, confidence };
      return { kind: "pause", minutes, confidence };
    }
  }
  return { kind: "unclear", minutes: 10, confidence: 0.3 };
}
